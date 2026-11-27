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
import { toE164 } from "@/lib/phone";
import { isAfterHours } from "@/product/missed-call/call-handling";
import type { Clock } from "@/product/missed-call/types";
import { parsePhoneInput } from "@/product/crm/phone";
import {
  addressesMatch,
  checkServiceAddress,
  stripAccents,
  type AddressCheck,
  type AddressField,
  type AddressInput,
} from "@/product/scheduling/address";
import {
  localDayWindow,
  parseTimePreference,
  pickOffers,
  spokenSlotLabel,
  type ReceptionistScheduler,
} from "./booking";
import { isConflictError, type ReceptionistStore } from "./store";
import type {
  CallIntent,
  CallOutcome,
  CallSession,
  CallSlots,
  CallTurn,
  ConfirmedField,
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
  /**
   * Which voice agent drives these calls. It only names the session
   * (`lk_<id>` or `bl_<id>`) and the booking idempotency key, so a call id
   * from one provider can never collide with, or reach, a call of another.
   */
  channel?: "livekit" | "bland";
};

/** A call id that already belongs to another business's receptionist. */
export class CallTenantMismatchError extends Error {
  constructor() {
    super("Call belongs to a different receptionist");
    this.name = "CallTenantMismatchError";
  }
}

export type DetailField = ConfirmedField;
export type ConfirmedDetails = Partial<Record<DetailField, string>>;

const DETAIL_FIELDS: readonly DetailField[] = [
  "callerName",
  "callbackE164",
  "serviceAddress",
];

/** What the agent is told about an address it tried to save or book with. */
export type AddressFeedback = {
  status: AddressCheck["status"];
  /** The canonical one-line address, when complete. */
  formatted?: string;
  /** Still needed to book. */
  missing?: AddressField[];
  /** Not needed to book; ask if the caller can give it. */
  recommended?: AddressField[];
  problem?: string;
  /** What was understood so far, so the agent only has to add the missing part. */
  understood?: Record<string, string>;
};

function addressFeedback(check: AddressCheck): AddressFeedback {
  if (check.status === "complete") {
    return {
      status: "complete",
      formatted: check.address.formatted,
      ...(check.recommended.length > 0 ? { recommended: check.recommended } : {}),
    };
  }
  if (check.status === "incomplete") {
    const understood: Record<string, string> = {};
    for (const [key, value] of Object.entries(check.partial)) {
      if (typeof value === "string" && key !== "country") understood[key] = value;
    }
    return { status: "incomplete", missing: check.missing, understood };
  }
  return { status: "invalid", problem: check.problem };
}

export type AgentDetails = {
  /** `rejected` when something sent could not be saved; `saved` otherwise. */
  status: "saved" | "rejected";
  /**
   * "yes" only when the call now holds every detail booking needs and nothing
   * sent was refused. `saved` alone is not enough: a request with empty values
   * (a voice platform that had not extracted them yet) saves nothing and is
   * still "saved". A string, because voice platforms compare it as text.
   */
  ready: "yes" | "no";
  confirmed: ConfirmedDetails;
  /** Still needed before booking (human labels, same as `book`). */
  missing: string[];
  rejected: DetailField[];
  address?: AddressFeedback;
};

const MISSING_LABEL: Record<DetailField, string> = {
  callerName: "name",
  callbackE164: "callback number",
  serviceAddress: "service address",
};

/** A later value replaces an earlier one, except what the caller confirmed. */
function mergeSlots(session: CallSession, incoming: CallSlots): CallSlots {
  const merged: CallSlots = { ...session.slots, ...incoming };
  for (const field of session.confirmedFields ?? []) {
    if (session.slots[field] !== undefined) merged[field] = session.slots[field];
  }
  return merged;
}

const EMERGENCY_URGENCY: NonNullable<CallSession["urgency"]> = {
  level: "critical",
  source: "voice_agent",
  requiresHuman: true,
  escalated: true,
};

function confirmedOf(session: CallSession): ConfirmedDetails {
  const out: ConfirmedDetails = {};
  for (const field of session.confirmedFields ?? []) {
    const value = session.slots[field];
    if (value) out[field] = value;
  }
  return out;
}

function plainName(value: string): string {
  return stripAccents(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sameDetail(field: DetailField, a: string, b: string): boolean {
  if (field === "callbackE164") return a === b;
  if (field === "serviceAddress") return addressesMatch(a, b);
  return plainName(a) === plainName(b);
}

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
  | { status: "missing_details"; missing: string[]; address?: AddressFeedback }
  /**
   * The agent supplied a value that disagrees with what the caller already
   * confirmed. Nothing was booked: re-confirm, save the details, book again.
   */
  | { status: "details_conflict"; fields: DetailField[]; confirmed: ConfirmedDetails }
  | { status: "request" | "error"; reason: string };

export type AgentReportInput = {
  callId: string;
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
  const phone = clip(raw.callbackE164, 20);
  if (phone && E164.test(phone)) slots.callbackE164 = phone;
  return slots;
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
  const channel = deps.channel ?? "livekit";
  const keyPrefix = channel === "bland" ? "rcb" : "rca";

  function bookingEnabled(config: ReceptionistConfig): boolean {
    return config.phoneBooking === true && Boolean(deps.scheduler);
  }

  async function ensureSession(
    config: ReceptionistConfig,
    input: {
      callId: string;
      fromE164?: string;
      language: ReceptionistLanguage;
      /** Only a finished call's report knows this: it dates a call the report itself had to create. */
      durationSeconds?: number;
    },
  ): Promise<CallSession> {
    const now = clock.now();
    // The first thing heard of a call is usually a tool call, close to its
    // start. When the first thing is the end-of-call report (no tool ran), the
    // call began `duration` before it: say so rather than dating the call from
    // its hang-up.
    const duration =
      typeof input.durationSeconds === "number" &&
      Number.isFinite(input.durationSeconds) &&
      input.durationSeconds > 0 &&
      input.durationSeconds <= 24 * 3600
        ? Math.round(input.durationSeconds)
        : undefined;
    const at = duration ? new Date(now.getTime() - duration * 1000) : now;
    const draft: CallSession = {
      id: `rcs_${randomUUID()}`,
      // The provider's call id, prefixed by channel: unique per call, never a Twilio SID.
      callSid: `${channel === "bland" ? "bl" : "lk"}_${input.callId}`,
      configId: config.id,
      clientAccountId: config.clientAccountId,
      // The number as the agent sent it ("514-555-9876", "+1 514 555 9876") in
      // E.164; a number that cannot be read is "anonymous", never guessed.
      fromE164: toE164(input.fromE164) ?? "anonymous",
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
      activity: {
        provider: channel === "bland" ? "bland" : "livekit",
        direction: "inbound",
        origin: "agent_report",
        ...(duration ? { startDerived: true as const } : {}),
      },
      startedAt: at.toISOString(),
      updatedAt: now.toISOString(),
      version: 1,
    };
    const { session } = await deps.store.insertSessionIfAbsent(draft);
    if (session.configId !== config.id || session.clientAccountId !== config.clientAccountId) {
      throw new CallTenantMismatchError();
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

  function cleanTranscript(raw: AgentReportInput["transcript"]): CallTurn[] {
    return (raw ?? [])
      .slice(-MAX_TRANSCRIPT_TURNS)
      .map((t) => ({
        at: nowIso(),
        speaker: t.speaker,
        text: clip(t.text, MAX_TURN_CHARS) ?? "",
        brain: t.speaker === "agent" ? ("llm" as const) : undefined,
      }))
      .filter((t) => t.text);
  }

  /**
   * A report that reaches a call already finalized (a delayed webhook, or a
   * retry after the stale-call sweep closed it): the record stays one record
   * and nothing is sent again. It only gains what it lacked, the real duration
   * and the conversation, and never a transcript the retention purge removed.
   */
  async function completeLate(
    session: CallSession,
    input: AgentReportInput,
  ): Promise<CallSession> {
    const turns =
      session.turns.length === 0 && !session.transcriptPurgedAt
        ? cleanTranscript(input.transcript)
        : [];
    const duration =
      session.durationSeconds === undefined &&
      typeof input.durationSeconds === "number" &&
      input.durationSeconds >= 0 &&
      input.durationSeconds <= 24 * 3600
        ? Math.round(input.durationSeconds)
        : undefined;
    if (turns.length === 0 && duration === undefined) return session;
    const updated = await mutate(session.id, (s) => ({
      ...s,
      turns: s.turns.length === 0 && turns.length > 0 ? turns : s.turns,
      callerTurnCount:
        s.turns.length === 0 && turns.length > 0
          ? turns.filter((t) => t.speaker === "caller").length
          : s.callerTurnCount,
      durationSeconds: s.durationSeconds ?? duration,
    }));
    return updated ?? session;
  }

  return {
    async availability(
      config: ReceptionistConfig,
      input: {
        callId: string;
        fromE164?: string;
        language: ReceptionistLanguage;
        preferredTime?: string;
        issue?: string;
        serviceAddress?: string;
        /** Keep this service (moving an existing appointment) instead of guessing from the issue. */
        serviceId?: string;
      },
    ): Promise<AgentAvailability> {
      if (!bookingEnabled(config)) return { ok: false, reason: "booking_disabled" };
      const session = await ensureSession(config, input);
      // Travel time between jobs depends on where this one is: an address the
      // server chose (an existing appointment's) first, else the one the
      // caller already confirmed on this call.
      const knownAddress = input.serviceAddress ?? confirmedOf(session).serviceAddress;

      const now = clock.now();
      // The caller's "tomorrow at 2" is read in the zone the availability (and
      // the dashboard calendar) is defined in, not the profile's own zone.
      const zone = input.preferredTime
        ? ((await withinBudget(
            async () => (await deps.scheduler?.timeZone?.(config)) ?? null,
          )) ?? config.timezone)
        : config.timezone;
      const pref = input.preferredTime
        ? parseTimePreference(input.preferredTime, now, zone)
        : {};
      const day = pref.dateKey ? localDayWindow(pref.dateKey, zone) : null;

      const ask = (extra: { serviceId?: string; from: Date; until?: Date }) =>
        withinBudget(() =>
          deps.scheduler!.listOpenings({
            config,
            issue: clip(input.issue, 300),
            serviceId: extra.serviceId,
            serviceAddress: clip(knownAddress, 300),
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
        fromE164?: string;
        language: ReceptionistLanguage;
        startAt: string;
        serviceId?: string;
        serviceName?: string;
        timezone?: string;
        callerName?: string;
        callbackE164?: string;
        serviceAddress?: string;
        /**
         * Require a complete, canonical address (street number, city,
         * province) instead of any non-empty text. The Bland agent uses it.
         */
        strictAddress?: boolean;
      },
    ): Promise<AgentBooking> {
      if (!bookingEnabled(config)) {
        return { status: "request", reason: "booking_disabled" };
      }
      const session = await ensureSession(config, input);
      const confirmed = confirmedOf(session);
      const supplied = cleanSlots({
        callerName: input.callerName,
        callbackE164: input.callbackE164,
        serviceAddress: input.serviceAddress,
      });
      let addressNote: AddressFeedback | undefined;
      if (input.strictAddress && supplied.serviceAddress) {
        const check = checkServiceAddress({ address: supplied.serviceAddress });
        if (check.status === "complete") {
          supplied.serviceAddress = check.address.formatted;
        } else {
          addressNote = addressFeedback(check);
          delete supplied.serviceAddress;
        }
      }
      // What the caller confirmed wins over a repeat; a disagreement is a
      // question for the caller, never a silent choice between two addresses.
      const conflicts = DETAIL_FIELDS.filter((field) => {
        const known = confirmed[field];
        const given = supplied[field];
        return known !== undefined && given !== undefined && !sameDetail(field, known, given);
      });
      if (conflicts.length > 0) {
        return { status: "details_conflict", fields: conflicts, confirmed };
      }
      const slots: CallSlots = { ...supplied, ...confirmed };
      const missing = (
        [
          ["name", slots.callerName],
          ["callback number", slots.callbackE164],
          ["service address", slots.serviceAddress],
        ] as const
      )
        .filter(([, v]) => !v)
        .map(([k]) => k);
      if (missing.length > 0) {
        return {
          status: "missing_details",
          missing,
          ...(addressNote ? { address: addressNote } : {}),
        };
      }
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
          idempotencyKey: `${keyPrefix}:${input.callId}:${new Date(input.startAt).toISOString()}`,
        }),
      );

      if (reserved?.status === "confirmed") {
        const label = spokenSlotLabel(reserved.startAt, timezone, input.language);
        await mutate(session.id, (s) => ({
          ...s,
          intent: "appointment",
          outcome: "appointment_booked",
          slots: { ...s.slots, ...slots },
          // The appointment now holds these details: the call record must agree with it.
          confirmedFields: [...DETAIL_FIELDS],
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

    /**
     * Records what the caller confirmed (name, callback number, service
     * address). Values are validated and canonicalised here, kept on the call
     * and reused by availability, booking and the final report, so the agent
     * does not have to repeat them correctly each time. Anything that cannot
     * be saved is returned with the reason; nothing is guessed.
     */
    async saveDetails(
      config: ReceptionistConfig,
      input: {
        callId: string;
        fromE164?: string;
        language: ReceptionistLanguage;
        callerName?: string;
        callbackPhone?: string;
        /** Use the number the caller is phoning from as the callback number. */
        useCallerId?: boolean;
        address?: AddressInput;
      },
    ): Promise<AgentDetails> {
      const session = await ensureSession(config, input);
      const updates: CallSlots = {};
      const rejected: DetailField[] = [];

      const name = clip(input.callerName, 80);
      if (name) updates.callerName = name;

      let phone: string | null | undefined;
      if (input.callbackPhone?.trim()) {
        phone = parsePhoneInput(input.callbackPhone.slice(0, 40));
      } else if (input.useCallerId) {
        phone = E164.test(session.fromE164) ? session.fromE164 : null;
      }
      if (phone) updates.callbackE164 = phone;
      else if (phone === null) rejected.push("callbackE164");

      let address: AddressFeedback | undefined;
      const parts = input.address;
      if (parts && Object.values(parts).some((v) => typeof v === "string" && v.trim())) {
        const check = checkServiceAddress(parts);
        address = addressFeedback(check);
        if (check.status === "complete") {
          updates.serviceAddress = check.address.formatted;
          updates.location = check.address.city;
        } else {
          rejected.push("serviceAddress");
        }
      }

      const saved = DETAIL_FIELDS.filter((field) => updates[field] !== undefined);
      const after =
        saved.length === 0
          ? session
          : ((await mutate(session.id, (s) => ({
              ...s,
              slots: { ...s.slots, ...updates },
              confirmedFields: [...new Set([...(s.confirmedFields ?? []), ...saved])],
            }))) ?? session);
      const confirmed = confirmedOf(after);
      const missing = DETAIL_FIELDS.filter((field) => !confirmed[field]);
      return {
        status: rejected.length > 0 ? "rejected" : "saved",
        ready: rejected.length === 0 && missing.length === 0 ? "yes" : "no",
        confirmed,
        missing: missing.map((field) => MISSING_LABEL[field]),
        rejected,
        ...(address ? { address } : {}),
      };
    },

    /**
     * Saves what the agent has learned about the request (the problem, the
     * service, the preferred time, a message) on the call WITHOUT finishing
     * it, so a voice platform that has no memory of its own between tool
     * calls can still hand the team a complete record, and the final report
     * (or the stale-call sweep) has something to summarise even if the
     * platform never sends one. Confirmed details are never replaced.
     */
    async recordSlots(
      config: ReceptionistConfig,
      input: {
        callId: string;
        fromE164?: string;
        language: ReceptionistLanguage;
        intent?: CallIntent;
        slots?: Partial<CallSlots>;
        emergency?: boolean;
      },
    ): Promise<{ recorded: boolean; fields: string[] }> {
      const session = await ensureSession(config, input);
      if (session.finalizedAt) return { recorded: false, fields: [] };
      const slots = cleanSlots(input.slots);
      const updated = await mutate(session.id, (s) => ({
        ...s,
        language: input.language,
        intent: input.intent ?? s.intent,
        slots: mergeSlots(s, slots),
        urgency: input.emergency && !s.urgency ? EMERGENCY_URGENCY : s.urgency,
      }));
      return {
        recorded: Boolean(updated),
        fields: Object.keys(slots).filter(
          (key) => !(session.confirmedFields ?? []).includes(key as ConfirmedField),
        ),
      };
    },

    /** The details the caller confirmed on this call (empty when none). */
    async confirmedDetails(
      config: ReceptionistConfig,
      input: { callId: string; fromE164?: string; language: ReceptionistLanguage },
    ): Promise<ConfirmedDetails> {
      return confirmedOf(await ensureSession(config, input));
    },

    /** The finished call becomes a normal receptionist call record and is finalized. */
    async report(
      config: ReceptionistConfig,
      input: AgentReportInput,
    ): Promise<CallSession | null> {
      const session = await ensureSession(config, input);
      if (session.finalizedAt) return completeLate(session, input);

      const slots = cleanSlots(input.slots);
      const transcript = cleanTranscript(input.transcript);

      const updated = await mutate(session.id, (s) => {
        const merged = mergeSlots(s, slots);
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
          urgency: input.emergency && !s.urgency ? EMERGENCY_URGENCY : s.urgency,
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
