import type { CallDisposition, ClientAccount, Clock } from "./types";

/** Parse "HH:mm" to minutes from midnight. */
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * After-hours = outside configured businessHours in the client timezone.
 * days: 0=Sunday … 6=Saturday (JS getDay).
 */
export function isAfterHours(
  client: ClientAccount,
  at: Date,
  timeZone = client.timezone,
): boolean {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const day = weekdayMap[weekday] ?? at.getDay();
  const mins = hour * 60 + minute;

  const start = timeToMinutes(client.businessHours.start);
  const end = timeToMinutes(client.businessHours.end);

  if (start === end) {
    // 24h on configured days only
    return !client.businessHours.days.includes(day);
  }

  if (start < end) {
    if (!client.businessHours.days.includes(day)) return true;
    return mins < start || mins >= end;
  }

  // Overnight e.g. Mon 22:00–06:00 → Mon ≥22:00 OR Tue <06:00 (carryover).
  const prevDay = (day + 6) % 7;
  const inHours =
    (client.businessHours.days.includes(day) && mins >= start) ||
    (client.businessHours.days.includes(prevDay) && mins < end);
  return !inHours;
}

/**
 * Classify a completed call from telephony signals.
 * - answered: human picked up (answeredBy human / duration with pickup)
 * - abandoned: rang briefly then caller hung up before voicemail threshold
 * - missed: unanswered (voicemail or no-answer) during business hours
 * - after_hours_missed: unanswered outside business hours
 */
export function classifyCall(input: {
  client: ClientAccount;
  calledAt: Date;
  answered: boolean;
  /** Caller hung up before connect / very short ring */
  abandoned: boolean;
  clock?: Clock;
}): CallDisposition {
  if (input.answered) return "answered";
  if (input.abandoned) return "abandoned";
  if (isAfterHours(input.client, input.calledAt)) return "after_hours_missed";
  return "missed";
}

/** Should Module A start the SMS recovery workflow for this disposition? */
export function shouldStartRecovery(disposition: CallDisposition): boolean {
  return disposition === "missed" || disposition === "after_hours_missed";
}

const ANONYMOUS_CALLER =
  /^(anonymous|restricted|unknown|private|unavailable)$/i;

const NANP_TOLL_FREE = new Set([
  "800",
  "888",
  "877",
  "866",
  "855",
  "844",
  "833",
]);

export type CallerEligibility =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "empty_caller"
        | "anonymous_caller"
        | "caller_too_short"
        | "caller_too_long"
        | "caller_is_own_line"
        | "toll_free_caller";
    };

/**
 * Reject numbers that must never receive automated recovery SMS.
 * Does not attempt landline detection (needs a carrier Lookup API).
 */
export function isEligibleRecoveryCaller(input: {
  callerE164: string;
  smsFromE164?: string;
}): CallerEligibility {
  const raw = input.callerE164.trim();
  if (!raw) return { ok: false, reason: "empty_caller" };
  if (ANONYMOUS_CALLER.test(raw) || ANONYMOUS_CALLER.test(raw.replace(/^\+/, ""))) {
    return { ok: false, reason: "anonymous_caller" };
  }

  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return { ok: false, reason: "caller_too_short" };
  if (digits.length > 15) return { ok: false, reason: "caller_too_long" };

  if (input.smsFromE164) {
    const callerKey = digits.replace(/^1(?=\d{10}$)/, "");
    const fromKey = input.smsFromE164
      .replace(/\D/g, "")
      .replace(/^1(?=\d{10}$)/, "");
    if (callerKey && fromKey && callerKey === fromKey) {
      return { ok: false, reason: "caller_is_own_line" };
    }
  }

  const national =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length === 10 && NANP_TOLL_FREE.has(national.slice(0, 3))) {
    return { ok: false, reason: "toll_free_caller" };
  }

  return { ok: true };
}

export function buildDedupeKey(
  clientAccountId: string,
  callerE164: string,
  windowBucket: number,
): string {
  return `${clientAccountId}:${callerE164}:${windowBucket}`;
}

export function dedupeWindowBucket(at: Date, windowMs: number): number {
  return Math.floor(at.getTime() / windowMs);
}
