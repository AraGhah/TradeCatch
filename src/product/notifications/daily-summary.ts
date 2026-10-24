import { zonedParts } from "@/product/sms-automation/window";

/** Local hour (in the recipient's chosen time zone) from which the summary is due. */
export const DAILY_SUMMARY_HOUR = 18;

/** Fallback when a stored time zone is not a valid IANA name. */
const FALLBACK_ZONE = "America/Toronto";

export function usableTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return FALLBACK_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_ZONE;
  }
}

/** Calendar date at `at` in `timeZone`, e.g. "2026-10-21". Names the summary once per day. */
export function localDateKey(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function isSummaryDue(at: Date, timeZone: string): boolean {
  return zonedParts(at, timeZone).hour >= DAILY_SUMMARY_HOUR;
}

/**
 * The instant the local calendar day containing `at` began. Resolved from the
 * zone's own offset at that moment, so days with a daylight-saving change are
 * 23 or 25 hours long instead of being off by one.
 */
export function startOfLocalDay(at: Date, timeZone: string): Date {
  const p = zonedParts(at, timeZone);
  const wallMidnight = Date.UTC(p.year, p.month - 1, p.day);
  let guess = wallMidnight;
  for (let i = 0; i < 3; i++) {
    const z = zonedParts(new Date(guess), timeZone);
    const wall = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute);
    const next = guess - (wall - wallMidnight);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}
