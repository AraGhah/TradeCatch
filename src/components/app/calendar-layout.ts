/**
 * Where things go on the appointment calendar. Pure functions: nothing here
 * touches React or the DOM, so the hard parts (the hourly grid, which column a
 * job belongs in, daylight-saving days) are covered by plain unit tests.
 *
 * Every day is the business's own calendar day, in the business's own zone,
 * never the browser's and never UTC.
 *
 * Time on the grid is wall-clock time, so 10:00 is at the same height on a
 * winter day and on a summer day, and a week's columns share one hour axis.
 * A job is placed by the wall-clock time it starts and is as tall as the real
 * time it lasts: a one-hour job is one hour tall even when the clocks change
 * in the middle of it.
 */
import { dateKeyInZone, shiftDayKey } from "./schedule-picker-utils";

export type CalendarView = "day" | "week" | "month";

export type CalendarItem = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
};

/** Opening hours by weekday ("0" is Sunday), the shape the server sends. */
export type OpeningHours = Record<
  string,
  { open: string; close: string } | null
>;

export type PlacedItem<T extends CalendarItem> = {
  item: T;
  /** Wall-clock minutes from midnight at which it starts on this day. */
  startMin: number;
  /** startMin plus the real minutes it lasts on this day (at most 24 * 60). */
  endMin: number;
  /** Which side-by-side column it takes when jobs overlap, from 0. */
  lane: number;
  /** How many side-by-side columns its group of overlapping jobs needs. */
  lanes: number;
};

/** A job this short is still tall enough to read and to click. */
export const MIN_EVENT_PX = 22;
/** For deciding who shares a column: a job counts as at least this long. */
const MIN_LANE_MINUTES = 30;
const DAY_MINUTES = 24 * 60;

/** The Sunday on or before a day: weeks run Sunday to Saturday, as in Canada. */
export function weekStart(dayKey: string): string {
  const weekday = new Date(`${dayKey}T00:00:00Z`).getUTCDay();
  return shiftDayKey(dayKey, -weekday);
}

/** Every cell of a Sunday-first month grid, whole weeks, with the neighbours flagged. */
export function monthDays(month: string): { key: string; inMonth: boolean }[] {
  const [year, mon] = month.split("-").map(Number);
  const y = year ?? 1970;
  const m = mon ?? 1;
  const first = `${month}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${month}-${String(lastDay).padStart(2, "0")}`;
  const start = weekStart(first);
  const end = shiftDayKey(weekStart(last), 6);
  const days: { key: string; inMonth: boolean }[] = [];
  for (let key = start; key <= end; key = shiftDayKey(key, 1)) {
    days.push({ key, inMonth: key.startsWith(`${month}-`) });
  }
  return days;
}

/** The day keys a view shows, from `anchor` (any day inside what is shown). */
export function visibleDays(view: CalendarView, anchor: string): string[] {
  if (view === "day") return [anchor];
  if (view === "week") {
    const start = weekStart(anchor);
    return Array.from({ length: 7 }, (_, i) => shiftDayKey(start, i));
  }
  return monthDays(anchor.slice(0, 7)).map((day) => day.key);
}

/** First and last day a view shows, both included. */
export function visibleRange(
  view: CalendarView,
  anchor: string,
): { from: string; to: string } {
  const days = visibleDays(view, anchor);
  return { from: days[0]!, to: days[days.length - 1]! };
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsAt(at: Date, zone: string): ZonedParts {
  let format = formatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, format);
  }
  const out: Record<string, number> = {};
  for (const part of format.formatToParts(at)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out as unknown as ZonedParts;
}

/** How far the zone is ahead of UTC at an instant, in milliseconds. */
function offsetMs(at: Date, zone: string): number {
  const p = partsAt(at, zone);
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
    Math.floor(at.getTime() / 1000) * 1000
  );
}

/** The instant a business-local day begins (00:00 there). */
export function zonedDayStart(dayKey: string, zone: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  const asUtc = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  // Subtract the offset, then check it again at the result: the offset in
  // force at midnight can differ from the one a few hours either side of a
  // clock change.
  const guess = asUtc - offsetMs(new Date(asUtc), zone);
  return new Date(asUtc - offsetMs(new Date(guess), zone));
}

/**
 * The instants that bound a run of days, for asking the server: from the
 * start of the first day up to (not including) the start of the day after the
 * last. A day is 23 or 25 hours long when the clocks change.
 */
export function rangeToInstants(
  range: { from: string; to: string },
  zone: string,
): { from: string; to: string } {
  return {
    from: zonedDayStart(range.from, zone).toISOString(),
    to: zonedDayStart(shiftDayKey(range.to, 1), zone).toISOString(),
  };
}

/** Wall-clock minutes since local midnight, in the business's zone. */
export function localMinutes(at: string | Date, zone: string): number {
  const p = partsAt(typeof at === "string" ? new Date(at) : at, zone);
  return p.hour * 60 + p.minute;
}

/** The part of a job that falls on one day, or null when it does not touch it. */
function segmentOn(
  item: CalendarItem,
  dayStart: Date,
  dayEnd: Date,
  zone: string,
): { startMin: number; endMin: number } | null {
  const start = Date.parse(item.startAt);
  const end = Date.parse(item.endAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const from = Math.max(start, dayStart.getTime());
  const to = Math.min(end, dayEnd.getTime());
  // A job with no length is on the day it starts.
  const touches =
    end > start
      ? to > from
      : start >= dayStart.getTime() && start < dayEnd.getTime();
  if (!touches) return null;
  const startMin =
    from === dayStart.getTime() ? 0 : localMinutes(new Date(from), zone);
  const lasts = Math.max(0, Math.round((to - from) / 60_000));
  return { startMin, endMin: Math.min(DAY_MINUTES, startMin + lasts) };
}

/**
 * The jobs on one day, placed for the hourly grid. Jobs that overlap share the
 * width side by side; a job that overlaps nothing takes all of it.
 */
export function placeDay<T extends CalendarItem>(
  items: T[],
  dayKey: string,
  zone: string,
): PlacedItem<T>[] {
  const dayStart = zonedDayStart(dayKey, zone);
  const dayEnd = zonedDayStart(shiftDayKey(dayKey, 1), zone);
  const segments: { item: T; startMin: number; endMin: number }[] = [];
  for (const item of items) {
    const segment = segmentOn(item, dayStart, dayEnd, zone);
    if (segment) segments.push({ item, ...segment });
  }
  segments.sort(
    (a, b) =>
      a.startMin - b.startMin ||
      b.endMin - a.endMin ||
      a.item.id.localeCompare(b.item.id),
  );

  const placed: PlacedItem<T>[] = [];
  let group: PlacedItem<T>[] = [];
  let groupEnd = -1;
  const close = () => {
    const lanes = group.reduce((most, entry) => Math.max(most, entry.lane + 1), 1);
    for (const entry of group) entry.lanes = lanes;
    placed.push(...group);
    group = [];
  };
  const laneEnds: number[] = [];
  for (const segment of segments) {
    const shownEnd = Math.max(segment.endMin, segment.startMin + MIN_LANE_MINUTES);
    if (group.length > 0 && segment.startMin >= groupEnd) {
      close();
      laneEnds.length = 0;
    }
    let lane = laneEnds.findIndex((end) => end <= segment.startMin);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = shownEnd;
    group.push({ ...segment, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, shownEnd);
  }
  if (group.length > 0) close();
  return placed;
}

/** Each day's jobs, in time order, for the month cells. A job over midnight is on both days. */
export function eventsByDay<T extends CalendarItem>(
  items: T[],
  days: string[],
  zone: string,
): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  const sorted = [...items].sort(
    (a, b) =>
      Date.parse(a.startAt) - Date.parse(b.startAt) || a.id.localeCompare(b.id),
  );
  for (const day of days) {
    const dayStart = zonedDayStart(day, zone);
    const dayEnd = zonedDayStart(shiftDayKey(day, 1), zone);
    byDay.set(
      day,
      sorted.filter((item) => segmentOn(item, dayStart, dayEnd, zone) !== null),
    );
  }
  return byDay;
}

function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** When the business is open on a day, in minutes from midnight; null when it is closed or unknown. */
export function openRange(
  dayKey: string,
  hours: OpeningHours | undefined,
): { openMin: number; closeMin: number } | null {
  const weekday = new Date(`${dayKey}T00:00:00Z`).getUTCDay();
  const day = hours?.[String(weekday)];
  if (!day) return null;
  const openMin = toMinutes(day.open);
  const closeMin = toMinutes(day.close);
  return closeMin > openMin ? { openMin, closeMin } : null;
}

/**
 * The hours the grid draws: the business's opening hours across the days
 * shown, stretched to hold any job outside them. Never empty, never more than
 * the 24 hours of a day.
 */
export function hourWindow(input: {
  hours: OpeningHours | undefined;
  days: string[];
  placed: PlacedItem<CalendarItem>[];
}): { startHour: number; endHour: number } {
  let start = Infinity;
  let end = -Infinity;
  for (const day of input.days) {
    const open = openRange(day, input.hours);
    if (!open) continue;
    start = Math.min(start, open.openMin);
    end = Math.max(end, open.closeMin);
  }
  if (!Number.isFinite(start)) {
    start = 8 * 60;
    end = 18 * 60;
  }
  for (const entry of input.placed) {
    start = Math.min(start, entry.startMin);
    end = Math.max(end, entry.endMin);
  }
  let startHour = Math.max(0, Math.floor(start / 60));
  let endHour = Math.min(24, Math.ceil(end / 60));
  if (endHour - startHour < 4) {
    endHour = Math.min(24, startHour + 4);
    startHour = Math.max(0, endHour - 4);
  }
  return { startHour, endHour };
}

/** Pixels from the top of the grid and tall, for a placed job. */
export function eventBox(
  placed: { startMin: number; endMin: number },
  windowStartMin: number,
  pxPerHour: number,
): { top: number; height: number } {
  const top = ((placed.startMin - windowStartMin) / 60) * pxPerHour;
  const height = ((placed.endMin - placed.startMin) / 60) * pxPerHour;
  return { top, height: Math.max(MIN_EVENT_PX, height) };
}

/** The business-local day an instant falls on (re-exported so the calendar needs one import). */
export const dayOf = dateKeyInZone;
