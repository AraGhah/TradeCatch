/**
 * Server side of the LiveKit voice agent's tools (see agents/receptionist).
 *
 * The realtime agent talks to the caller; everything that must be true after
 * the call — a verified appointment, a recorded request, the owner's SMS and
 * email — happens here, behind the same ops-authenticated API as the config:
 *
 *   availability → real openings from the scheduling backend, or a reason why none
 *   book         → a reservation; only `status: "confirmed"` lets the agent say "booked"
 *   report       → the finished call: slots + transcript → the usual summary,
 *                  notifications, lead sync and SMS recovery (the engine's finalizeSession)
 *
 * The call is one `CallSession` keyed by the agent's call id, so a repeated tool
 * call or a repeated report never books or notifies twice.
 */

import { randomUUID } from "@/lib/id";
import { isAfterHours } from "@/product/missed-call/call-handling";
import type { Clock } from "@/product/missed-call/types";
import {
  localDayWindow,
  parseTimePreference,
  pickOffers,
  spokenSlotLabel,
  type ReceptionistScheduler,
} from "./booking";
import {
  addressIsComplete,
  mergeAddress,
  tidyAddress,
  withCity,
} from "./address";
import { isConflictError, type ReceptionistStore } from "./store";
import type {
  CallIntent,
  CallOutcome,
  CallSession,
  CallSlots,
  CallTurn,
  ReceptionistConfig,
  ReceptionistLanguage,
} from "./types";

/** Scheduling calls must answer well inside a live conversation. */
const SCHEDULER_TIMEOUT_MS = 7000;
const MAX_TRANSCRIPT_TURNS = 200;
const MAX_TURN_CHARS = 600;
const MAX_SLOT_CHARS = 600;

export const CALL_ID_PATTERN = /^[A-Za-z0-9_.:-]{6,128}$/;
const E164 = /^\+[1-9]\d{9,14}$/;

/** Which voice platform made the call: it only changes the call record's key prefix. */
export type AgentChannel = "livekit" | "bland";
const CALL_SID_PREFIX: Record<AgentChannel, string> = {
  livekit: "lk",
  bland: "bl",
};

/** A call id that already belongs to another business's receptionist. */
export class CallOwnershipError extends Error {
  constructor() {
    super("Call belongs to a different receptionist");
    this.name = "CallOwnershipError";
  }
}

export type AgentCallDeps = {
  store: ReceptionistStore;
  scheduler?: ReceptionistScheduler;
  /** The engine's finalizeSession: summary, notifications, lead sync, SMS recovery. */
  finalize(sessionId: string): Promise<CallSession | null>;
  /**
   * Alerts the owner that a caller asked for a person and nobody was reached
   * (the existing `transfer_failed` notification). Defaults to the shared hook;
   * best-effort, it never fails the report.
   */
  notifyTransferFailed?(clientAccountId: string, sessionId: string): Promise<void>;
  clock?: Clock;
};

async function defaultNotifyTransferFailed(clientAccountId: string, sessionId: string) {
  const { emitTransferFailed } = await import("@/product/notifications/hooks");
  await emitTransferFailed(clientAccountId, sessionId);
}

export type AgentOffer = { startAt: string; label: string };

export type AgentAvailability =
  | {
      ok: true;
      timezone: string;
      serviceId?: string;
      serviceName: string;
      /** False when nothing matched the wish and these are simply the next openings. */
      matchesRequest: boolean;
      offers: AgentOffer[];
    }
  | {
      ok: false;
      reason: "booking_disabled" | "not_bookable" | "unavailable" | "no_openings";
    };

export type AgentBooking =
  | {
      status: "confirmed";
      appointmentId: string;
      startAt: string;
      label: string;
    }
  | { status: "taken"; offers: AgentOffer[]; timezone: string }
  | { status: "missing_details"; missing: string[] }
  | { status: "request" | "error"; reason: string };

export type AgentReportInput = {
  callId: string;
  channel?: AgentChannel;
  fromE164?: string;
  language: ReceptionistLanguage;
  intent?: CallIntent;
  slots?: Partial<CallSlots>;
  transcript?: { speaker: "agent" | "caller"; text: string }[];
  /** The agent handed the caller to a person (tool call result, not the model's claim). */
  transfer?: {
    targetName?: string;
    completed: boolean;
    /** Only a screened transfer can confirm a person answered; a SIP REFER cannot. */
    answerConfirmed?: boolean;
    mechanism?: "warm" | "blind" | "bridge";
  };
  emergency?: boolean;
  durationSeconds?: number;
  endReason?: "completed" | "caller_hung_up" | "silence" | "error";
};

function clip(value: unknown, max = MAX_SLOT_CHARS): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.replace(/\s+/g, " ").trim().slice(0, max);
  return v || undefined;
}

function validTimeZone(zone: string | undefined, fallback: string): string {
  if (!zone) return fallback;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return fallback;
  }
}

/** Slot values the model supplied, trimmed, bounded and with the phone number validated. */
export function cleanSlots(raw: Partial<CallSlots> | undefined): CallSlots {
  const slots: CallSlots = {};
  if (!raw) return slots;
  const keys = [
    "callerName",
    "serviceAddress",
    "issue",
    "preferredTime",
    "message",
    "service",
    "project",
    "location",
    "email",
  ] as const;
  for (const key of keys) {
    const value = clip(raw[key], key === "callerName" ? 80 : MAX_SLOT_CHARS);
    if (value) slots[key] = value;
  }
  // The address and the city are tidied the same way everywhere they are saved.
  const address = tidyAddress(raw.serviceAddress);
  if (address) slots.serviceAddress = address;
  else delete slots.serviceAddress;
  const phone = clip(raw.callbackE164, 20);
  if (phone && E164.test(phone)) slots.callbackE164 = phone;
  return slots;
}

/**
 * What the call knows after new details arrive. A new value replaces an old
 * one (the caller corrected it), except that a complete street address is
 * never replaced by a vaguer one, such as a city said again later.
 */
export function mergeSlots(existing: CallSlots, incoming: CallSlots): CallSlots {
  const merged: CallSlots = { ...existing, ...incoming };
  const address = mergeAddress(existing.serviceAddress, incoming.serviceAddress);
  if (address) merged.serviceAddress = address;
  return merged;
}

async function withinBudget<T>(task: () => Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SCHEDULER_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    console.error("[receptionist] agent scheduling call failed", err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createAgentCallService(deps: AgentCallDeps) {
  const clock = deps.clock ?? { now: () => new Date() };
  const nowIso = () => clock.now().toISOString();

  function bookingEnabled(config: ReceptionistConfig): boolean {
    return config.phoneBooking === true && Boolean(deps.scheduler);
  }

  async function ensureSession(
    config: ReceptionistConfig,
    input: {
      callId: string;
      channel?: AgentChannel;
      fromE164?: string;
      language: ReceptionistLanguage;
    },
  ): Promise<CallSession> {
    const at = clock.now();
    const draft: CallSession = {
      id: `rcs_${randomUUID()}`,
      // The call id keeps the session unique per call and unrelated to Twilio SIDs.
      callSid: `${CALL_SID_PREFIX[input.channel ?? "livekit"]}_${input.callId}`,
      configId: config.id,
      clientAccountId: config.clientAccountId,
      fromE164:
        input.fromE164 && E164.test(input.fromE164)
          ? input.fromE164
          : "anonymous",
      toE164: config.phoneNumberE164,
      language: input.language,
      status: "in_progress",
      step: "reason",
      afterHours: isAfterHours(config, at),
      slots: {},
      turns: [],
      silenceCount: 0,
      callerTurnCount: 0,
      transfers: [],
      notifications: [],
      startedAt: at.toISOString(),
      updatedAt: at.toISOString(),
      version: 1,
    };
    const { session } = await deps.store.insertSessionIfAbsent(draft);
    if (session.configId !== config.id || session.clientAccountId !== config.clientAccountId) {
      throw new CallOwnershipError();
    }
    return session;
  }

  /** Re-run a change once if another request saved the session first. */
  async function mutate(
    sessionId: string,
    change: (session: CallSession) => CallSession,
  ): Promise<CallSession | null> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await deps.store.getSession(sessionId);
      if (!current) return null;
      try {
        return await deps.store.saveSession({
          ...change(current),
          updatedAt: nowIso(),
        });
      } catch (err) {
        if (!isConflictError(err) || attempt === 3) throw err;
      }
    }
    return null;
  }

  /**
   * Saves details on the call without ever failing the tool that gave them.
   * An earlier issue or preferred time is kept: a model's later one-word
   * paraphrase must not replace what the caller actually said.
   */
  async function remember(sessionId: string, incoming: Partial<CallSlots>) {
    const fresh = cleanSlots(incoming);
    if (Object.keys(fresh).length === 0) return;
    try {
      await mutate(sessionId, (s) => {
        const keepFirst: CallSlots = { ...fresh };
        if (s.slots.issue) delete keepFirst.issue;
        if (s.slots.preferredTime) delete keepFirst.preferredTime;
        return { ...s, slots: mergeSlots(s.slots, keepFirst) };
      });
    } catch (err) {
      console.warn(
        "[receptionist] could not save call details",
        err instanceof Error ? err.name : "unknown",
      );
    }
  }

  return {
    /**
     * Saves details the caller confirmed so far. Safe to repeat; a correction
     * replaces the earlier value, a vaguer address does not replace a complete one.
     */
    async saveDetails(
      config: ReceptionistConfig,
      input: {
        callId: string;
        channel?: AgentChannel;
        fromE164?: string;
        language: ReceptionistLanguage;
        slots?: Partial<CallSlots>;
      },
    ): Promise<{ saved: string[] }> {
      const session = await ensureSession(config, input);
      if (session.finalizedAt) return { saved: [] };
      const fresh = cleanSlots(input.slots);
      if (Object.keys(fresh).length === 0) return { saved: [] };
      await mutate(session.id, (s) => ({
        ...s,
        slots: mergeSlots(s.slots, fresh),
      }));
      return { saved: Object.keys(fresh) };
    },

    async availability(
      config: ReceptionistConfig,
      input: {
        callId: string;
        channel?: AgentChannel;
        fromE164?: string;
        language: ReceptionistLanguage;
        preferredTime?: string;
        issue?: string;
        serviceAddress?: string;
        /** Keep this service (moving an existing appointment) instead of guessing from the issue. */
        serviceId?: string;
        /** Moving an existing appointment: its address is not a detail of a new request. */
        rescheduling?: boolean;
      },
    ): Promise<AgentAvailability> {
      if (!bookingEnabled(config)) return { ok: false, reason: "booking_disabled" };
      const session = await ensureSession(config, input);
      if (!input.rescheduling) {
        // What the caller just told us is kept now, so booking and the final
        // report do not depend on the model repeating it.
        await remember(session.id, {
          serviceAddress: input.serviceAddress,
          preferredTime: input.preferredTime,
          issue: input.issue,
        });
      }

      const now = clock.now();
      const pref = input.preferredTime
        ? parseTimePreference(input.preferredTime, now, config.timezone)
        : {};
      const day = pref.dateKey ? localDayWindow(pref.dateKey, config.timezone) : null;

      const ask = (extra: { serviceId?: string; from: Date; until?: Date }) =>
        withinBudget(() =>
          deps.scheduler!.listOpenings({
            config,
            issue: clip(input.issue, 300),
            serviceId: extra.serviceId,
            serviceAddress: clip(input.serviceAddress, 300),
            language: input.language,
            from: extra.from,
            until: extra.until,
          }),
        );

      let opened = await ask({
        serviceId: input.serviceId,
        from: day && day.from > now ? day.from : now,
        until: day?.until,
      });
      if (!opened) return { ok: false, reason: "unavailable" };
      if (!opened.ok) return { ok: false, reason: opened.reason };

      let { picks, exact } = pickOffers(opened.slots, pref, opened.timezone);
      if (picks.length === 0 && day) {
        // Nothing on the requested day: offer the next openings instead.
        const wider = await ask({ serviceId: opened.service.id, from: now });
        if (!wider) return { ok: false, reason: "unavailable" };
        if (!wider.ok) return { ok: false, reason: wider.reason };
        opened = wider;
        picks = pickOffers(wider.slots, {}, wider.timezone).picks;
        exact = false;
      }
      if (picks.length === 0) return { ok: false, reason: "no_openings" };

      return {
        ok: true,
        timezone: opened.timezone,
        serviceId: opened.service.id,
        serviceName: opened.service.name,
        matchesRequest: exact,
        offers: picks.map((p) => ({
          startAt: p.startAt,
          label: spokenSlotLabel(p.startAt, opened.timezone, input.language),
        })),
      };
    },

    async book(
      config: ReceptionistConfig,
      input: {
        callId: string;
        channel?: AgentChannel;
        fromE164?: string;
        language: ReceptionistLanguage;
        startAt: string;
        serviceId?: string;
        serviceName?: string;
        timezone?: string;
        callerName?: string;
        callbackE164?: string;
        serviceAddress?: string;
      },
    ): Promise<AgentBooking> {
      if (!bookingEnabled(config)) {
        return { status: "request", reason: "booking_disabled" };
      }
      const session = await ensureSession(config, input);
      // Details the caller already confirmed on this call are used when the tool
      // call omits them; what the tool call does say wins (a correction). The
      // number they are calling from is the callback number unless they gave another.
      const known = session.slots;
      const slots = cleanSlots({
        callerName: input.callerName ?? known.callerName,
        callbackE164: input.callbackE164 ?? known.callbackE164 ?? input.fromE164,
        serviceAddress: mergeAddress(
          known.serviceAddress,
          tidyAddress(input.serviceAddress),
        ),
      });
      // The city said on its own is added to the street, so the technician and
      // the calendar get one full address.
      slots.serviceAddress = withCity(slots.serviceAddress, known.location);
      const missing = (
        [
          ["name", slots.callerName],
          ["callback number", slots.callbackE164],
          [
            slots.serviceAddress
              ? "service address (street number and street name)"
              : "service address",
            addressIsComplete(slots.serviceAddress) ? slots.serviceAddress : "",
          ],
        ] as const
      )
        .filter(([, v]) => !v)
        .map(([k]) => k);
      if (missing.length > 0) return { status: "missing_details", missing };
      if (!Number.isFinite(Date.parse(input.startAt))) {
        return { status: "error", reason: "invalid_time" };
      }

      const timezone = validTimeZone(input.timezone, config.timezone);
      const reserved = await withinBudget(() =>
        deps.scheduler!.reserve({
          config,
          serviceId: input.serviceId,
          serviceName: clip(input.serviceName, 120),
          startAt: new Date(input.startAt).toISOString(),
          callerName: slots.callerName,
          callbackE164: slots.callbackE164,
          serviceAddress: slots.serviceAddress,
          language: input.language,
          // A repeated tool call must never book the same time twice.
          idempotencyKey: `rca:${input.callId}:${new Date(input.startAt).toISOString()}`,
        }),
      );

      if (reserved?.status === "confirmed") {
        const label = spokenSlotLabel(reserved.startAt, timezone, input.language);
        await mutate(session.id, (s) => ({
          ...s,
          intent: "appointment",
          outcome: "appointment_booked",
          slots: mergeSlots(s.slots, slots),
          booking: {
            timezone,
            offered: [],
            rounds: 1,
            misses: 0,
            status: "booked",
            appointmentId: reserved.appointmentId,
            startAt: reserved.startAt,
            label,
          },
        }));
        return {
          status: "confirmed",
          appointmentId: reserved.appointmentId,
          startAt: reserved.startAt,
          label,
        };
      }
      if (reserved?.status === "conflict") {
        const { picks } = pickOffers(reserved.alternatives, {}, timezone);
        return {
          status: "taken",
          timezone,
          offers: picks.map((p) => ({
            startAt: p.startAt,
            label: spokenSlotLabel(p.startAt, timezone, input.language),
          })),
        };
      }
      if (reserved === null || reserved.status === "error") {
        return { status: "error", reason: "reserve_failed" };
      }
      return { status: "request", reason: reserved.reason };
    },

    /** The finished call becomes a normal receptionist call record and is finalized. */
    async report(
      config: ReceptionistConfig,
      input: AgentReportInput,
    ): Promise<CallSession | null> {
      const session = await ensureSession(config, input);
      if (session.finalizedAt) return session;

      const slots = cleanSlots(input.slots);
      const transcript: CallTurn[] = (input.transcript ?? [])
        .slice(-MAX_TRANSCRIPT_TURNS)
        .map((t) => ({
          at: nowIso(),
          speaker: t.speaker,
          text: clip(t.text, MAX_TURN_CHARS) ?? "",
          brain: t.speaker === "agent" ? ("llm" as const) : undefined,
        }))
        .filter((t) => t.text);

      const updated = await mutate(session.id, (s) => {
        const merged = mergeSlots(s.slots, slots);
        // A booking recorded by the book tool is the only proof of a booking.
        const booked = s.booking?.status === "booked";
        const transferred = input.transfer?.completed === true;
        const hasRequest = Boolean(merged.issue || merged.message);
        const outcome: CallOutcome = booked
          ? "appointment_booked"
          : transferred
            ? input.emergency
              ? "emergency_transferred"
              : "transferred"
            : hasRequest
              ? merged.preferredTime && (input.intent ?? s.intent) === "appointment"
                ? "appointment_requested"
                : "message_taken"
              : "caller_hung_up";
        return {
          ...s,
          language: input.language,
          intent: input.intent ?? s.intent ?? (hasRequest ? "message" : undefined),
          slots: merged,
          turns: transcript.length > 0 ? transcript : s.turns,
          callerTurnCount: transcript.filter((t) => t.speaker === "caller").length,
          transfers: input.transfer
            ? [
                ...s.transfers,
                {
                  at: nowIso(),
                  targetId: input.emergency ? "emergency" : "agent",
                  targetName: input.transfer.targetName ?? "",
                  phoneE164: "",
                  reason: input.emergency ? "emergency" : "caller_request",
                  status: input.transfer.completed ? "completed" : "failed",
                  answerConfirmed:
                    input.transfer.completed && input.transfer.answerConfirmed === true,
                  ...(input.transfer.mechanism ? { mechanism: input.transfer.mechanism } : {}),
                },
              ]
            : s.transfers,
          urgency:
            input.emergency && !s.urgency
              ? {
                  level: "critical" as const,
                  source: "voice_agent",
                  requiresHuman: true,
                  escalated: true,
                }
              : s.urgency,
          status: input.endReason === "error" ? "failed" : "completed",
          step: "done",
          outcome,
          durationSeconds: input.durationSeconds ?? s.durationSeconds,
          endedAt: nowIso(),
        };
      });
      if (!updated) return null;
      const finalized = await deps.finalize(updated.id);
      if (input.transfer && !input.transfer.completed) {
        // The caller stayed with the agent for a callback: tell the owner now.
        // Keyed by the call, so a repeated report never alerts twice.
        try {
          await (deps.notifyTransferFailed ?? defaultNotifyTransferFailed)(
            config.clientAccountId,
            updated.id,
          );
        } catch (error) {
          console.warn(
            "[receptionist] transfer alert skipped",
            error instanceof Error ? error.message : "unknown",
          );
        }
      }
      return finalized;
    },
  };
}

export type AgentCallService = ReturnType<typeof createAgentCallService>;
