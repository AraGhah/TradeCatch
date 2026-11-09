/**
 * What the dashboard shows for a finished call: filters, a list row and a detail
 * view, derived from the stored session. Pure functions, so tenant scoping and
 * the notification statuses are testable without a database.
 *
 * Callers must already have restricted `sessions` to the signed-in business
 * (`clientAccountId`); nothing here widens that.
 */

import { localDayWindow } from "./booking";
import { MAX_NOTIFICATION_ATTEMPTS } from "./notification-retry";
import type { CallOutcome, CallSession, NotificationDelivery } from "./types";

export type DeliveryState = "sent" | "failed" | "retrying" | "pending" | "off";

export const OUTCOMES: readonly CallOutcome[] = [
  "message_taken",
  "appointment_requested",
  "appointment_booked",
  "transferred",
  "emergency_transferred",
  "faq_answered",
  "voicemail",
  "caller_hung_up",
  "failed",
];
export const URGENCIES = ["routine", "priority", "critical"] as const;
type Urgency = (typeof URGENCIES)[number];

export type CallFilters = {
  /** Local calendar day (YYYY-MM-DD), inclusive. */
  from?: string;
  to?: string;
  urgency?: Urgency;
  outcome?: CallOutcome;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Validates untrusted query parameters; unknown values are rejected, never ignored. */
export function parseCallFilters(
  params: URLSearchParams,
): { ok: true; filters: CallFilters } | { ok: false; field: string } {
  const filters: CallFilters = {};
  for (const key of ["from", "to"] as const) {
    const value = params.get(key);
    if (!value) continue;
    if (!DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
      return { ok: false, field: key };
    filters[key] = value;
  }
  const urgency = params.get("urgency");
  if (urgency) {
    if (!(URGENCIES as readonly string[]).includes(urgency))
      return { ok: false, field: "urgency" };
    filters.urgency = urgency as Urgency;
  }
  const outcome = params.get("outcome");
  if (outcome) {
    if (!(OUTCOMES as readonly string[]).includes(outcome))
      return { ok: false, field: "outcome" };
    filters.outcome = outcome as CallOutcome;
  }
  return { ok: true, filters };
}

export function filterCalls(
  sessions: CallSession[],
  filters: CallFilters,
  timeZone: string,
): CallSession[] {
  const from = filters.from
    ? localDayWindow(filters.from, timeZone).from.getTime()
    : undefined;
  const until = filters.to
    ? localDayWindow(filters.to, timeZone).until.getTime()
    : undefined;
  return sessions.filter((s) => {
    const at = Date.parse(s.startedAt);
    if (from !== undefined && at < from) return false;
    if (until !== undefined && at >= until) return false;
    if (filters.outcome && s.outcome !== filters.outcome) return false;
    if (filters.urgency && (s.urgency?.level ?? "routine") !== filters.urgency)
      return false;
    return true;
  });
}

/**
 * One state per channel for the whole call:
 *  sent     every recipient got it
 *  retrying a recipient failed transiently and another attempt is still due
 *  failed   a recipient was not reached and will not be retried
 *  pending  the call is not finalized yet
 *  off      nothing was sent on this channel (muted, no recipient, or emergency-only)
 */
export function deliveryState(
  session: CallSession,
  channel: "sms" | "email",
): DeliveryState {
  const all = session.notifications.filter((n) => n.channel === channel);
  if (all.length === 0) return session.finalizedAt ? "off" : "pending";

  const byRecipient = new Map<string, NotificationDelivery[]>();
  for (const n of all)
    byRecipient.set(n.to ?? "", [...(byRecipient.get(n.to ?? "") ?? []), n]);

  let unreached = false;
  let due = false;
  for (const history of byRecipient.values()) {
    if (history.some((n) => n.ok)) continue;
    unreached = true;
    const last = history.reduce((a, b) => (a.at >= b.at ? a : b));
    const attempts = Math.max(...history.map((n) => n.attempt ?? 1));
    if (last.retryable === true && attempts < MAX_NOTIFICATION_ATTEMPTS)
      due = true;
  }
  return !unreached ? "sent" : due ? "retrying" : "failed";
}

export type CallRow = ReturnType<typeof toCallRow>;

export function toCallRow(c: CallSession) {
  return {
    id: c.id,
    callSid: c.callSid,
    simulated: c.callSid.startsWith("sim_") || c.callSid.startsWith("demo_"),
    fromE164: c.fromE164,
    callerName: c.summary?.callerName ?? c.slots.callerName,
    service: c.slots.service ?? c.slots.project,
    language: c.language,
    status: c.status,
    outcome: c.outcome,
    intent: c.intent,
    urgency: c.urgency?.level,
    afterHours: c.afterHours,
    summary: c.summary,
    slots: c.slots,
    transfers: c.transfers,
    appointment: c.summary?.appointment
      ? {
          status: c.summary.appointment.status,
          label: c.summary.appointment.label,
        }
      : undefined,
    durationSeconds: c.durationSeconds,
    startedAt: c.startedAt,
    endedAt: c.endedAt,
    finalizedAt: c.finalizedAt,
    notifications: {
      sms: deliveryState(c, "sms"),
      email: deliveryState(c, "email"),
    },
  };
}

/**
 * The detail view. The transcript is included only while the owner's plan and
 * retention settings allow it and it has not been purged; raw provider detail
 * and unmasked recipients are never exposed.
 */
export function toCallDetail(
  c: CallSession,
  options: { transcriptsEnabled: boolean },
) {
  const transcriptAvailable =
    options.transcriptsEnabled && !c.transcriptPurgedAt && c.turns.length > 0;
  return {
    ...toCallRow(c),
    transcriptPurged: Boolean(c.transcriptPurgedAt),
    transcript: transcriptAvailable
      ? c.turns
          .filter((t) => t.speaker !== "system")
          .map((t) => ({ speaker: t.speaker, text: t.text, at: t.at }))
      : undefined,
    // The raw provider URL is never handed to the browser.
    hasRecording: Boolean(c.recordingUrl),
    deliveries: c.notifications.map((n) => ({
      at: n.at,
      channel: n.channel,
      ok: n.ok,
      to: n.to,
      attempt: n.attempt ?? 1,
      detail: n.ok ? undefined : n.detail,
    })),
  };
}
