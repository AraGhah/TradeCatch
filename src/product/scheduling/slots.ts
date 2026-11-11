import { zonedParts } from "@/product/sms-automation/window";
import type { AvailabilityRules, BusyBlock, ScheduleAppointment, Slot } from "./types";

export function defaultDays(): AvailabilityRules["days"] {
  return {
    "0": null,
    "1": { open: "08:00", close: "18:00" },
    "2": { open: "08:00", close: "18:00" },
    "3": { open: "08:00", close: "18:00" },
    "4": { open: "08:00", close: "18:00" },
    "5": { open: "08:00", close: "18:00" },
    "6": null,
  };
}

export const FALLBACK_TIME_ZONE = "America/Toronto";
const HH_MM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimeZone(timeZone: string | undefined): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

/** A zone that is safe to hand to Intl: a stored bad value must never take the calendar down. */
export function usableTimeZone(timeZone: string | undefined): string {
  return isValidTimeZone(timeZone) ? (timeZone as string) : FALLBACK_TIME_ZONE;
}

/** Open and close are real "HH:MM" times and the day closes after it opens. */
export function validDayHours(
  hours: AvailabilityRules["days"][string] | undefined,
): hours is { open: string; close: string } {
  return Boolean(
    hours &&
      typeof hours.open === "string" &&
      typeof hours.close === "string" &&
      HH_MM.test(hours.open) &&
      HH_MM.test(hours.close) &&
      hours.open < hours.close,
  );
}

export type RulesProblem =
  | "invalid_timezone"
  | "invalid_hours"
  | "invalid_holiday";

/** What is wrong with a set of availability rules, or null when they can be saved. */
export function rulesProblem(
  rules: Pick<AvailabilityRules, "timezone" | "days" | "holidays">,
): RulesProblem | null {
  if (!isValidTimeZone(rules.timezone)) return "invalid_timezone";
  for (const [key, hours] of Object.entries(rules.days)) {
    if (!/^[0-6]$/.test(key)) return "invalid_hours";
    if (hours !== null && !validDayHours(hours)) return "invalid_hours";
  }
  for (const day of rules.holidays) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!match) return "invalid_holiday";
    const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    if (date.toISOString().slice(0, 10) !== day) return "invalid_holiday";
  }
  return null;
}

function parseMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** The calendar day ("YYYY-MM-DD") an instant falls on in the business's own timezone. */
export function localKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The wall-clock time ("HH:MM", 24 h) of an instant in the business's timezone. */
export function localTime(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

const labelFormatters = new Map<string, Intl.DateTimeFormat>();
function labelFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = labelFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    labelFormatters.set(timeZone, fmt);
  }
  return fmt;
}

export function overlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function activeAppointments(rows: ScheduleAppointment[], now: Date): ScheduleAppointment[] {
  return rows.filter((row) => {
    if (row.status === "canceled" || row.status === "completed") return false;
    if (row.status === "hold") {
      return Boolean(row.holdExpiresAt && Date.parse(row.holdExpiresAt) > now.getTime());
    }
    return row.status === "confirmed";
  });
}

export function listSlots(input: {
  rules: AvailabilityRules;
  from: Date;
  until: Date;
  durationMinutes: number;
  bufferMinutes: number;
  appointments: ScheduleAppointment[];
  externalBusy: BusyBlock[];
  now: Date;
  serviceAddress?: string;
  technicianId?: string;
  technicianName?: string;
  excludeAppointmentId?: string;
  /** Stop after this many slots (default 48: enough for "what else is free?"). */
  maxSlots?: number;
}): Slot[] {
  const rules = input.rules;
  const maxSlots = input.maxSlots ?? 48;
  const tz = usableTimeZone(rules.timezone);
  const step = 30;
  const duration = input.durationMinutes;
  const buffer = input.bufferMinutes;
  const travel = rules.travelBufferMinutes;
  const notice = input.now.getTime() + rules.minimumNoticeMinutes * 60_000;
  const horizon = input.now.getTime() + rules.maxAdvanceDays * 24 * 60 * 60 * 1000;
  const occupied = [
    ...activeAppointments(input.appointments, input.now)
      .filter((row) => row.id !== input.excludeAppointmentId)
      .filter((row) => !input.technicianId || !row.technicianId || row.technicianId === input.technicianId)
      .map((row) => ({
        start: Date.parse(row.startAt) - buffer * 60_000,
        end: Date.parse(row.endAt) + buffer * 60_000,
        address: row.serviceAddress,
        day: localKey(new Date(row.startAt), tz),
        counts: row.status !== "hold",
      })),
    ...input.externalBusy.map((block) => ({
      start: Date.parse(block.startAt),
      end: Date.parse(block.endAt),
      address: undefined as string | undefined,
      day: localKey(new Date(block.startAt), tz),
      counts: false,
    })),
  ];
  const slots: Slot[] = [];
  // Start on a whole minute: slot instants must not carry the seconds and
  // milliseconds of whenever the request happened to arrive, or the same
  // opening would have a different `startAt` on every call and could never be
  // matched again when it is booked.
  let cursor = Math.ceil(input.from.getTime() / 60_000) * 60_000;
  for (let i = 0; i < step; i += 1) {
    const parts = zonedParts(new Date(cursor), tz);
    if (parts.minute % step === 0) break;
    cursor += 60_000;
  }
  for (; cursor < input.until.getTime(); cursor += step * 60_000) {
    const start = new Date(cursor);
    const parts = zonedParts(start, tz);
    if (parts.minute % step !== 0) continue;
    const day = localKey(start, tz);
    if (rules.holidays.includes(day)) continue;
    const hours = rules.days[String(parts.weekday)];
    // Hours that are not real times would compare as NaN and open the whole day.
    if (!validDayHours(hours)) continue;
    const minutes = parts.hour * 60 + parts.minute;
    const open = parseMinutes(hours.open);
    const close = parseMinutes(hours.close);
    if (minutes < open || minutes + duration > close) continue;
    if (start.getTime() < notice || start.getTime() > horizon) continue;
    const end = start.getTime() + duration * 60_000;
    let blocked = false;
    for (const block of occupied) {
      let blockStart = block.start;
      let blockEnd = block.end;
      if (
        travel > 0 &&
        input.serviceAddress &&
        block.address &&
        block.address.trim().toLowerCase() !== input.serviceAddress.trim().toLowerCase()
      ) {
        blockStart -= travel * 60_000;
        blockEnd += travel * 60_000;
      }
      if (start.getTime() < blockEnd && blockStart < end) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    if (rules.maxDailyBookings != null) {
      // A day is full when it already holds the maximum number of bookings.
      // Listing several possible start times is not booking them: counting
      // the listed slots cut every day off after its first few hours.
      const count = occupied.filter((block) => block.counts && block.day === day).length;
      if (count >= rules.maxDailyBookings) continue;
    }
    const label = labelFormatter(tz).format(start);
    slots.push({
      startAt: start.toISOString(),
      endAt: new Date(end).toISOString(),
      technicianId: input.technicianId,
      technicianName: input.technicianName,
      localLabel: label,
    });
    if (slots.length >= maxSlots) break;
  }
  return slots;
}

export function slotIsFree(
  slots: Slot[],
  startAt: string,
): Slot | undefined {
  return slots.find((slot) => slot.startAt === new Date(startAt).toISOString());
}
