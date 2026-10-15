/**
 * Simulated calendar for AI receptionist configuration tests.
 * Prevents double-bookings in memory; no real calendar provider is contacted.
 */

export type SimulatedSlot = {
  startIso: string;
  endIso: string;
  service?: string;
  customerName?: string;
};

export type AppointmentBookResult =
  | { ok: true; appointment: SimulatedSlot }
  | { ok: false; reason: "unavailable" | "conflict" | "notice" | "daily_limit" | "calendar_error" };

type OrgCalendar = {
  booked: SimulatedSlot[];
  /** Injected failure for integration-error demos. */
  failNext?: boolean;
};

const calendars = new Map<string, OrgCalendar>();

function getCal(organizationId: string): OrgCalendar {
  let c = calendars.get(organizationId);
  if (!c) {
    c = { booked: [] };
    calendars.set(organizationId, c);
  }
  return c;
}

export function resetSimulatedCalendar(organizationId: string): void {
  calendars.delete(organizationId);
}

export function listSimulatedAppointments(
  organizationId: string,
): SimulatedSlot[] {
  return [...getCal(organizationId).booked];
}

export function setSimulatedCalendarError(
  organizationId: string,
  failNext: boolean,
): void {
  getCal(organizationId).failNext = failNext;
}

function overlaps(a: SimulatedSlot, b: SimulatedSlot): boolean {
  return a.startIso < b.endIso && b.startIso < a.endIso;
}

export function checkSimulatedAvailability(input: {
  organizationId: string;
  startIso: string;
  durationMinutes: number;
  bufferMinutes: number;
  bookingNoticeHours: number;
  maxDailyBookings?: number;
  now?: Date;
}): {
  available: boolean;
  reason?: Exclude<AppointmentBookResult, { ok: true }>["reason"];
} {
  const cal = getCal(input.organizationId);
  if (cal.failNext) {
    return { available: false, reason: "calendar_error" };
  }
  const now = input.now ?? new Date();
  const start = new Date(input.startIso);
  if (Number.isNaN(start.getTime())) {
    return { available: false, reason: "unavailable" };
  }
  const noticeMs = input.bookingNoticeHours * 60 * 60 * 1000;
  if (start.getTime() - now.getTime() < noticeMs) {
    return { available: false, reason: "notice" };
  }
  const end = new Date(
    start.getTime() + input.durationMinutes * 60_000 + input.bufferMinutes * 60_000,
  );
  const candidate: SimulatedSlot = {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
  if (cal.booked.some((b) => overlaps(candidate, b))) {
    return { available: false, reason: "conflict" };
  }
  if (input.maxDailyBookings != null) {
    const day = start.toISOString().slice(0, 10);
    const count = cal.booked.filter((b) => b.startIso.startsWith(day)).length;
    if (count >= input.maxDailyBookings) {
      return { available: false, reason: "daily_limit" };
    }
  }
  return { available: true };
}

export function bookSimulatedAppointment(input: {
  organizationId: string;
  startIso: string;
  durationMinutes: number;
  bufferMinutes: number;
  bookingNoticeHours: number;
  maxDailyBookings?: number;
  service?: string;
  customerName?: string;
  now?: Date;
}): AppointmentBookResult {
  const check = checkSimulatedAvailability(input);
  if (!check.available) {
    return { ok: false, reason: check.reason ?? "unavailable" };
  }
  const cal = getCal(input.organizationId);
  if (cal.failNext) {
    cal.failNext = false;
    return { ok: false, reason: "calendar_error" };
  }
  const start = new Date(input.startIso);
  const end = new Date(start.getTime() + input.durationMinutes * 60_000);
  const appointment: SimulatedSlot = {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    service: input.service,
    customerName: input.customerName,
  };
  cal.booked.push(appointment);
  return { ok: true, appointment };
}

/** Suggest the next open hour slot on a given local day (simple demo helper). */
export function suggestSimulatedSlot(input: {
  organizationId: string;
  dayIso: string;
  hour: number;
  durationMinutes: number;
  bufferMinutes: number;
  bookingNoticeHours: number;
  maxDailyBookings?: number;
  now?: Date;
}): string | null {
  const start = new Date(`${input.dayIso}T${String(input.hour).padStart(2, "0")}:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  const check = checkSimulatedAvailability({
    organizationId: input.organizationId,
    startIso: start.toISOString(),
    durationMinutes: input.durationMinutes,
    bufferMinutes: input.bufferMinutes,
    bookingNoticeHours: input.bookingNoticeHours,
    maxDailyBookings: input.maxDailyBookings,
    now: input.now,
  });
  return check.available ? start.toISOString() : null;
}
