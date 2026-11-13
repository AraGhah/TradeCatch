/**
 * Server side of the voice agent's existing-appointment and caller-text tools:
 *
 *   find    → the caller's own upcoming appointments (time, service, technician)
 *   verify  → re-checks one appointment before it is moved or offered new times
 *   move    → a real reschedule through the scheduling service
 *   cancel  → a real cancellation through the scheduling service
 *   text    → one server-written text to the caller's own number
 *
 * Who may see or change an appointment: only a caller dialing from the phone
 * number on that appointment (the carrier's caller ID, which the agent reads
 * from the SIP call and never from the model) who also gives the name on it.
 * Every operation re-checks this on the server, so an appointment id the model
 * invents or hears from a caller is useless on its own. Results never carry the
 * customer's address, phone number or another customer's details.
 *
 * A text goes only to that same caller-ID number, its words are written here
 * from verified business data (never by the model), a suppressed (STOP) number
 * is never texted, and each kind of text is sent at most once per call.
 */

import { createHash } from "node:crypto";
import type { SchedulingService } from "@/product/scheduling/service";
import type { ScheduleAppointment } from "@/product/scheduling/types";
import type { OutboundMessageRecord, OutboundSms } from "@/product/missed-call/types";
import type { Clock } from "@/product/missed-call/types";
import { smsFailureDisposition } from "@/product/missed-call/twilio";
import { pickOffers, spokenSlotLabel, type OpenSlot } from "./booking";
import { formatBusinessHours } from "./system-prompt";
import type { ReceptionistConfig, ReceptionistLanguage } from "./types";

/** Appointments that started this long ago still count (a late technician). */
const RECENT_PAST_MS = 6 * 60 * 60 * 1000;
const MAX_FOUND = 3;
const SCHEDULING_TIMEOUT_MS = 7000;
const E164 = /^\+[1-9]\d{9,14}$/;

const lastTen = (phone: string | undefined) =>
  (phone ?? "").replace(/\D/g, "").slice(-10);

/** Lower-case name words without accents: "Hélène Tremblay" → ["helene", "tremblay"]. */
export function nameWords(name: string | undefined): string[] {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 2);
}

/**
 * The caller is the customer on the appointment: same phone number, and, when
 * the appointment has a name, at least one word of the name they gave matches.
 */
export function callerOwnsAppointment(
  appointment: Pick<ScheduleAppointment, "customerPhoneE164" | "customerName">,
  callerE164: string,
  callerName: string | undefined,
): boolean {
  const phone = lastTen(appointment.customerPhoneE164);
  if (phone.length !== 10 || phone !== lastTen(callerE164)) return false;
  const onFile = nameWords(appointment.customerName);
  if (onFile.length === 0) return true;
  const given = nameWords(callerName);
  return given.some((w) => onFile.includes(w));
}

export type FoundAppointment = {
  appointmentId: string;
  label: string;
  serviceName: string;
  technicianName?: string;
  status: "pending" | "confirmed";
  /** True when the start time has already passed (the technician may be late). */
  started: boolean;
};

export type FindResult =
  | { status: "found"; appointments: FoundAppointment[] }
  | {
      status:
        | "not_found"
        | "name_needed"
        | "caller_unknown"
        | "disabled"
        | "unavailable";
    };

export type MoveResult =
  | { status: "moved"; label: string; startAt: string }
  | { status: "taken"; timezone: string; offers: { startAt: string; label: string }[] }
  | { status: "not_found" | "disabled" | "error" };

export type CancelResult = { status: "canceled" | "not_found" | "disabled" | "error" };

export type TextKind = "business_info" | "appointment";
export type TextResult = {
  /** queued: the provider failed for now and the minute cron retries it; failed: it will not be sent. */
  status: "sent" | "queued" | "failed" | "already_sent" | "opted_out" | "unavailable" | "not_found";
};

/** Where texts come from, and the outbox that makes each one durable and idempotent. */
export type CallerTextPort = {
  /** The business's SMS number, or null when it cannot text. */
  sender(config: ReceptionistConfig): Promise<{ fromE164: string } | null>;
  isSuppressed(config: ReceptionistConfig, phoneE164: string): Promise<boolean>;
  enqueue(message: OutboundMessageRecord): Promise<void>;
  /** The queued row if this request now owns sending it; null if it was already claimed or sent. */
  claim(id: string): Promise<OutboundMessageRecord | null>;
  send(message: OutboundSms): Promise<{ sid: string }>;
  markSent(id: string, providerSid: string): Promise<void>;
  /** Leaves the row for the minute cron to retry. */
  markFailed(id: string, error: string, cause: unknown): Promise<void>;
};

export type AgentAppointmentDeps = {
  scheduling(): Promise<SchedulingService>;
  findOrganizationId(config: ReceptionistConfig): Promise<string | null>;
  texts?: CallerTextPort;
  clock?: Clock;
};

async function withinBudget<T>(task: () => Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SCHEDULING_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    console.error("[receptionist] appointment lookup failed", (err as Error)?.name);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const FR_DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

function frTime(hhmm: string): string {
  const [h, m] = hhmm.split(":");
  const hour = String(Number(h));
  return m && m !== "00" ? `${hour} h ${m}` : `${hour} h`;
}

/** "du lundi au vendredi, de 8 h à 17 h" / "Monday to Friday, 08:00–17:00". */
export function hoursForText(
  hours: { start: string; end: string; days: number[] },
  language: ReceptionistLanguage,
): string {
  if (language === "en") return formatBusinessHours(hours);
  const days = [...new Set(hours.days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (days.length === 0) return "";
  const runs: number[][] = [];
  for (const d of days) {
    const last = runs.at(-1);
    if (last && d === last.at(-1)! + 1) last.push(d);
    else runs.push([d]);
  }
  const label = runs
    .map((run) =>
      run.length === 1
        ? `le ${FR_DAYS[run[0]!]}`
        : run.length === 2
          ? `le ${FR_DAYS[run[0]!]} et le ${FR_DAYS[run[1]!]}`
          : `du ${FR_DAYS[run[0]!]} au ${FR_DAYS[run.at(-1)!]}`,
    )
    .join(", ");
  return `${label}, de ${frTime(hours.start)} à ${frTime(hours.end)}`;
}

const STOP_LINE: Record<ReceptionistLanguage, string> = {
  fr: "Répondez STOP pour ne plus recevoir de textos.",
  en: "Reply STOP to opt out.",
};

/** The business's own details, in the caller's language. Only fields the owner entered. */
export function businessInfoText(
  config: ReceptionistConfig,
  language: ReceptionistLanguage,
): string {
  const fr = language === "fr";
  // French puts a space before the colon.
  const line = (frLabel: string, enLabel: string, value: string) =>
    fr ? `${frLabel} : ${value}` : `${enLabel}: ${value}`;
  const parts = [config.businessName];
  if (config.businessAddress) parts.push(line("Adresse", "Address", config.businessAddress));
  const phone = config.businessPhone || config.phoneNumberE164;
  if (phone) parts.push(line("Tél.", "Phone", phone));
  const hours = hoursForText(config.businessHours, language);
  if (hours) parts.push(line("Heures", "Hours", hours));
  return `${parts.join("\n")}\n${STOP_LINE[language]}`;
}

export function appointmentText(
  config: ReceptionistConfig,
  appointment: Pick<ScheduleAppointment, "serviceName">,
  label: string,
  language: ReceptionistLanguage,
): string {
  const body =
    language === "fr"
      ? `${config.businessName} : votre rendez-vous (${appointment.serviceName}) est prévu ${label}.`
      : `${config.businessName}: your appointment (${appointment.serviceName}) is scheduled for ${label}.`;
  return `${body}\n${STOP_LINE[language]}`;
}

/** A stable outbox id per call and kind of text: a repeated tool call never texts twice. */
export function callerTextId(callId: string, kind: TextKind, appointmentId?: string): string {
  const digest = createHash("sha256")
    .update(`${callId}|${kind}|${appointmentId ?? ""}`)
    .digest("hex")
    .slice(0, 24);
  return `rctext_${digest}`;
}

export function createAgentAppointmentService(deps: AgentAppointmentDeps) {
  const clock = deps.clock ?? { now: () => new Date() };

  function enabled(config: ReceptionistConfig): boolean {
    return config.phoneBooking === true;
  }

  async function organization(config: ReceptionistConfig) {
    const organizationId = await deps.findOrganizationId(config);
    if (!organizationId) return null;
    return { organizationId, scheduling: await deps.scheduling() };
  }

  /** The appointment, only if it is still active and belongs to this caller. */
  async function owned(
    config: ReceptionistConfig,
    input: { callerE164?: string; callerName?: string; appointmentId: string },
  ): Promise<{ appointment: ScheduleAppointment; organizationId: string; scheduling: SchedulingService } | null> {
    if (!input.callerE164 || !E164.test(input.callerE164)) return null;
    const org = await organization(config);
    if (!org) return null;
    let appointment: ScheduleAppointment;
    try {
      ({ appointment } = await org.scheduling.get(org.organizationId, input.appointmentId));
    } catch {
      return null;
    }
    if (appointment.status !== "pending" && appointment.status !== "confirmed") return null;
    if (!callerOwnsAppointment(appointment, input.callerE164, input.callerName)) return null;
    return { appointment, ...org };
  }

  return {
    async find(
      config: ReceptionistConfig,
      input: { callerE164?: string; callerName?: string; language: ReceptionistLanguage },
    ): Promise<FindResult> {
      if (!enabled(config)) return { status: "disabled" };
      if (!input.callerE164 || !E164.test(input.callerE164)) return { status: "caller_unknown" };
      if (nameWords(input.callerName).length === 0) return { status: "name_needed" };
      const rows = await withinBudget(async () => {
        const org = await organization(config);
        if (!org) return undefined;
        return org.scheduling.list(org.organizationId);
      });
      if (rows === null) return { status: "unavailable" };
      if (rows === undefined) return { status: "disabled" };
      const now = clock.now().getTime();
      const appointments = rows
        .filter(
          (a) =>
            (a.status === "pending" || a.status === "confirmed") &&
            Date.parse(a.startAt) >= now - RECENT_PAST_MS &&
            callerOwnsAppointment(a, input.callerE164!, input.callerName),
        )
        .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
        .slice(0, MAX_FOUND)
        .map(
          (a): FoundAppointment => ({
            appointmentId: a.id,
            label: spokenSlotLabel(a.startAt, a.timezone || config.timezone, input.language),
            serviceName: a.serviceName,
            technicianName: a.technicianName?.split(/\s+/)[0] || undefined,
            status: a.status as "pending" | "confirmed",
            started: Date.parse(a.startAt) <= now,
          }),
        );
      return appointments.length > 0
        ? { status: "found", appointments }
        : { status: "not_found" };
    },

    /** What the availability lookup needs to offer new times for this appointment. */
    async forRescheduling(
      config: ReceptionistConfig,
      input: { callerE164?: string; callerName?: string; appointmentId: string },
    ): Promise<{ serviceId?: string; serviceAddress?: string; serviceName: string } | null> {
      if (!enabled(config)) return null;
      const found = await withinBudget(() => owned(config, input));
      if (!found) return null;
      return {
        serviceId: found.appointment.serviceId,
        serviceAddress: found.appointment.serviceAddress,
        serviceName: found.appointment.serviceName,
      };
    },

    async move(
      config: ReceptionistConfig,
      input: {
        callerE164?: string;
        callerName?: string;
        appointmentId: string;
        startAt: string;
        language: ReceptionistLanguage;
      },
    ): Promise<MoveResult> {
      if (!enabled(config)) return { status: "disabled" };
      if (!Number.isFinite(Date.parse(input.startAt))) return { status: "error" };
      const found = await withinBudget(() => owned(config, input));
      if (!found) return { status: "not_found" };
      const timezone = found.appointment.timezone || config.timezone;
      const result = await withinBudget(() =>
        found.scheduling.reschedule(
          found.organizationId,
          found.appointment.id,
          new Date(input.startAt).toISOString(),
        ),
      );
      if (result === null) return { status: "error" };
      if (result.ok) {
        return {
          status: "moved",
          startAt: result.appointment.startAt,
          label: spokenSlotLabel(result.appointment.startAt, timezone, input.language),
        };
      }
      if (result.reason === "unavailable" || result.reason === "conflict") {
        const { picks } = pickOffers(result.alternatives as OpenSlot[], {}, timezone);
        return {
          status: "taken",
          timezone,
          offers: picks.map((p) => ({
            startAt: p.startAt,
            label: spokenSlotLabel(p.startAt, timezone, input.language),
          })),
        };
      }
      return { status: "error" };
    },

    async cancel(
      config: ReceptionistConfig,
      input: { callerE164?: string; callerName?: string; appointmentId: string },
    ): Promise<CancelResult> {
      if (!enabled(config)) return { status: "disabled" };
      const found = await withinBudget(() => owned(config, input));
      if (!found) return { status: "not_found" };
      const result = await withinBudget(() =>
        found.scheduling.cancel(found.organizationId, found.appointment.id, "canceled_by_caller_phone"),
      );
      return result?.ok ? { status: "canceled" } : { status: "error" };
    },

    async text(
      config: ReceptionistConfig,
      input: {
        callId: string;
        callerE164?: string;
        callerName?: string;
        language: ReceptionistLanguage;
        kind: TextKind;
        appointmentId?: string;
      },
    ): Promise<TextResult> {
      const port = deps.texts;
      if (!port || !input.callerE164 || !E164.test(input.callerE164)) {
        return { status: "unavailable" };
      }
      let body: string;
      if (input.kind === "appointment") {
        if (!input.appointmentId || !enabled(config)) return { status: "not_found" };
        const found = await withinBudget(() =>
          owned(config, { ...input, appointmentId: input.appointmentId! }),
        );
        if (!found) return { status: "not_found" };
        const timezone = found.appointment.timezone || config.timezone;
        body = appointmentText(
          config,
          found.appointment,
          spokenSlotLabel(found.appointment.startAt, timezone, input.language),
          input.language,
        );
      } else {
        body = businessInfoText(config, input.language);
      }

      const sender = await port.sender(config);
      if (!sender) return { status: "unavailable" };
      if (await port.isSuppressed(config, input.callerE164)) return { status: "opted_out" };

      const id = callerTextId(input.callId, input.kind, input.appointmentId);
      const at = clock.now().toISOString();
      await port.enqueue({
        id,
        clientAccountId: config.clientAccountId,
        toE164: input.callerE164,
        fromE164: sender.fromE164,
        body,
        detail: `receptionist_caller_${input.kind}`,
        status: "queued",
        attempts: 0,
        createdAt: at,
        updatedAt: at,
      });
      const claimed = await port.claim(id);
      if (!claimed) return { status: "already_sent" };
      try {
        const sent = await port.send({
          toE164: claimed.toE164,
          fromE164: claimed.fromE164,
          body: claimed.body,
          outboxId: id,
        });
        try {
          await port.markSent(id, sent.sid);
        } catch {
          // The provider accepted it: a bookkeeping failure must not send it again.
        }
        return { status: "sent" };
      } catch (err) {
        await port.markFailed(id, (err as Error)?.name || "send_failed", err).catch(() => {});
        return { status: smsFailureDisposition(err) === "retry" ? "queued" : "failed" };
      }
    },
  };
}

export type AgentAppointmentService = ReturnType<typeof createAgentAppointmentService>;
