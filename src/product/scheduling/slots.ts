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

function parseMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function localKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
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
}): Slot[] {
  const rules = input.rules;
  const tz = rules.timezone || "America/Toronto";
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
  let cursor = input.from.getTime();
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
    if (!hours) continue;
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
      const count = occupied.filter((block) => block.counts && block.day === day).length;
      const already = slots.filter((slot) => localKey(new Date(slot.startAt), tz) === day).length;
      if (count + already >= rules.maxDailyBookings) continue;
    }
    const label = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(start);
    slots.push({
      startAt: start.toISOString(),
      endAt: new Date(end).toISOString(),
      technicianId: input.technicianId,
      technicianName: input.technicianName,
      localLabel: label,
    });
    if (slots.length >= 48) break;
  }
  return slots;
}

export function slotIsFree(
  slots: Slot[],
  startAt: string,
): Slot | undefined {
  return slots.find((slot) => slot.startAt === new Date(startAt).toISOString());
}
