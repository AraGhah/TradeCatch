/**
 * Strict parsing of the instants the scheduling API accepts.
 *
 * `new Date("2026-10-19T10:00")` is read in the SERVER's timezone (UTC on the
 * Worker, local on a laptop), and `new Date("2026-02-31T10:00:00Z")` quietly
 * becomes March 3. Either one would move an appointment without any error, so
 * an instant must say its offset and must be a real calendar moment.
 */

const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/i;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The instant a string names, or null when it is not an ISO 8601 date-time with an explicit offset. */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = INSTANT.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s, offset] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (Number(h) > 23 || Number(mi) > 59 || (s !== undefined && Number(s) > 59)) {
    return null;
  }
  if (offset && offset.toUpperCase() !== "Z") {
    const digits = offset.slice(1).replace(":", "");
    if (Number(digits.slice(0, 2)) > 23 || Number(digits.slice(2)) > 59) {
      return null;
    }
  }
  // Date.parse understands "+0400" only with the colon in some engines.
  const normalized = value
    .trim()
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2")
    .replace(/z$/, "Z");
  const at = new Date(normalized);
  return Number.isNaN(at.getTime()) ? null : at;
}

export type InstantRange = { from: Date; to: Date };

/** Longest window the calendar may ask for in one request (a month view plus padding). */
export const MAX_RANGE_DAYS = 400;

/**
 * A range of instants for a query. `null` means a bound was not an instant, or
 * the range runs backwards, is empty, or is absurdly long.
 */
export function parseRange(from: unknown, to: unknown): InstantRange | null {
  const start = parseInstant(from);
  const end = parseInstant(to);
  if (!start || !end) return null;
  if (end.getTime() <= start.getTime()) return null;
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    return null;
  }
  return { from: start, to: end };
}
