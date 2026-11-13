/**
 * Pure helpers for the appointment calendar picker (no React, no I/O).
 *
 * Every date here is a calendar day in the BUSINESS's timezone ("YYYY-MM-DD"),
 * never the browser's: a contractor travelling, or a manager in another
 * province, must see the same days and times the customer is offered.
 */

/** Canadian business: use the Canadian flavour of the two supported languages. */
export function pickerLocale(locale: string): string {
  return locale === "fr" ? "fr-CA" : "en-CA";
}

/** "2026-11" shifted by whole months ("2026-12" + 1 -> "2027-01"). */
export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split("-").map(Number);
  const index = (year ?? 1970) * 12 + ((mon ?? 1) - 1) + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
}

export type MonthCell = { day: number; key: string } | null;

/**
 * The cells of a Sunday-first month grid: leading blanks, then one entry per
 * day. (Canada's convention for both English and French calendars.)
 */
export function monthGrid(month: string): MonthCell[] {
  const [year, mon] = month.split("-").map(Number);
  const y = year ?? 1970;
  const m = mon ?? 1;
  const leading = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: MonthCell[] = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= days; day += 1) {
    cells.push({ day, key: `${month}-${String(day).padStart(2, "0")}` });
  }
  return cells;
}

/** Morning is before noon, local time; everything from noon on is afternoon. */
export function partOfDay(time: string): "morning" | "afternoon" {
  return Number(time.slice(0, 2)) < 12 ? "morning" : "afternoon";
}

/** The business-local calendar day ("YYYY-MM-DD") of an instant. */
export function dateKeyInZone(startAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(startAt));
}

/**
 * One period at the end of a sentence that closes on a time: "…for 9:00 a.m.."
 * reads "…for 9:00 a.m.". An ellipsis is left alone.
 */
export function tidySentence(text: string): string {
  return text.replace(/([^.])\.\.(?!\.)/g, "$1.");
}

/** A day key moved by whole days ("2026-11-30" + 1 -> "2026-12-01"). */
export function shiftDayKey(dateKey: string, delta: number): string {
  const at = new Date(`${dateKey}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + delta);
  return at.toISOString().slice(0, 10);
}

/** "Nov 11" for a business-local day key. */
export function formatShortDayKey(dateKey: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(`${dateKey}T00:00:00Z`));
}

/** Lower case with accents removed, so "cote" finds "Côté". */
export function searchKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** "9:00 a.m." / "09 h 00": the time of day in the business's timezone. */
export function formatSlotTime(
  startAt: string,
  timeZone: string,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(startAt));
}

/** "Wednesday, November 11" for a business-local day key. */
export function formatDayKey(dateKey: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${dateKey}T00:00:00Z`));
}

/** "Wednesday, November 11, 2026" for an instant, in the business's timezone. */
export function formatSlotDate(
  startAt: string,
  timeZone: string,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(startAt));
}

/** "November 2026" for a "YYYY-MM" month. */
export function formatMonth(month: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

/** Short weekday names, Sunday first. */
export function weekdayNames(locale: string): string[] {
  const format = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
  });
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, i) =>
    format.format(new Date(Date.UTC(2023, 0, 1 + i))),
  );
}

/** "EST" / "HNE" when the platform knows it, otherwise the IANA name. */
export function timezoneLabel(timeZone: string, locale: string): string {
  try {
    const part = new Intl.DateTimeFormat(locale, {
      timeZone,
      timeZoneName: "short",
    })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    return part?.value ? `${part.value} (${timeZone})` : timeZone;
  } catch {
    return timeZone;
  }
}
