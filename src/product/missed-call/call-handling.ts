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
