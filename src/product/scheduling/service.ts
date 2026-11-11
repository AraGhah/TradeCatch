import { createId } from "@/lib/id";
import {
  defaultDays,
  listSlots,
  localKey,
  localTime,
  rulesProblem,
  slotIsFree,
  usableTimeZone,
} from "./slots";
import { withOrgLock, type SchedulingStore } from "./store";
import type {
  AvailabilityRules,
  BusyBlock,
  CalendarConnectionPublic,
  MonthAvailability,
  ScheduleAppointment,
  ServiceType,
  Slot,
  Technician,
} from "./types";

export class SchedulingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    /** Stable reason the dashboard can translate; the message is for logs. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "SchedulingError";
  }
}

/**
 * Rows the engine writes for its own bookkeeping (the short hold that guards a
 * move or an approval, a booking that timed out before it existed). They are
 * never something the contractor booked, so they are not listed.
 */
const INTERNAL_CANCEL_REASONS = new Set([
  "reschedule_hold",
  "approval_hold",
  "booking_timed_out",
]);

export function isInternalAppointment(
  row: Pick<ScheduleAppointment, "status" | "cancelReason">,
): boolean {
  return (
    row.status === "hold" ||
    (row.status === "canceled" &&
      INTERNAL_CANCEL_REASONS.has(row.cancelReason ?? ""))
  );
}

export type CalendarPort = {
  kind: "simulated" | "google";
  connected: boolean;
  externalCalls: number;
  freeBusy(fromIso: string, untilIso: string): Promise<BusyBlock[]>;
  createEvent(
    appointment: ScheduleAppointment,
  ): Promise<{ id: string } | { error: string }>;
  updateEvent(
    eventId: string,
    appointment: ScheduleAppointment,
  ): Promise<{ ok: true } | { error: string }>;
  deleteEvent(eventId: string): Promise<{ ok: true } | { error: string }>;
};

export type SchedulingDeps = {
  store: SchedulingStore;
  now: () => Date;
  calendar: (organizationId: string) => Promise<CalendarPort>;
  scheduleNotices?: (input: {
    organizationId: string;
    appointmentId: string;
    phoneE164: string;
    customerName?: string;
    serviceName: string;
    appointmentDate: string;
    appointmentTime: string;
    startAt: string;
    simulated: boolean;
    leadId?: string;
  }) => Promise<void>;
  cancelNotices?: (
    organizationId: string,
    appointmentId: string,
    reason: string,
  ) => Promise<void>;
  notify?: (input: {
    organizationId: string;
    title: string;
    reason: string;
    /** What happened, so a request is never announced as a confirmation. */
    kind: "confirmed" | "requested" | "rescheduled" | "canceled";
    refId: string;
    /** What the notice says about the job; without these it reads "—". */
    serviceName?: string;
    serviceAddress?: string;
    /** Local date and time of the appointment, e.g. "2026-11-12 14:30". */
    whenLabel?: string;
  }) => Promise<void>;
  onDisconnected?: (organizationId: string) => Promise<void>;
  linkLead?: (input: {
    organizationId: string;
    phone?: string;
    name?: string;
    service: string;
    address?: string;
    startAt: string;
    simulated: boolean;
  }) => Promise<{ leadId?: string } | void>;
};

export type BookInput = {
  /** Phone webhook deadline; an expired attempt must not become a late booking. */
  deadlineAt?: number;
  organizationId: string;
  serviceId?: string;
  serviceName?: string;
  startAt: string;
  customerName?: string;
  customerPhoneE164?: string;
  customerEmail?: string;
  serviceAddress?: string;
  technicianId?: string;
  leadId?: string;
  source: ScheduleAppointment["bookingSource"];
  idempotencyKey?: string;
  simulated?: boolean;
  /** Practice only: the simulated calendar refuses the event (needs `simulated`). */
  simulateCalendarFailure?: boolean;
  /**
   * When the time is no longer free, record a pending request for the
   * contractor (default). Callers that offer another time on the spot, such as
   * the phone receptionist, pass `false` to get a plain `conflict` back.
   */
  requestIfUnavailable?: boolean;
};

export type BookResult = {
  ok: boolean;
  confirmed: boolean;
  reason?: string;
  appointment?: ScheduleAppointment;
  alternatives: Slot[];
};

const DEFAULT_SERVICES: Omit<ServiceType, "id" | "organizationId">[] = [
  {
    name: "Drain inspection",
    description: "Short inspection visit",
    durationMinutes: 30,
    bookingMode: "automatic",
    eligibleTechnicianIds: [],
    active: true,
  },
  {
    name: "Plumbing consultation",
    description: "Initial consultation, not a repair promise",
    durationMinutes: 60,
    bookingMode: "consultation",
    eligibleTechnicianIds: [],
    active: true,
  },
  {
    name: "Water heater repair",
    description: "On-site repair when the business allows automatic booking",
    durationMinutes: 90,
    bookingMode: "automatic",
    eligibleTechnicianIds: [],
    active: true,
  },
  {
    name: "Emergency plumbing",
    description: "Escalate to the contractor",
    durationMinutes: 60,
    bookingMode: "escalate",
    eligibleTechnicianIds: [],
    active: true,
  },
  {
    name: "Major installation",
    description: "Requires contractor approval",
    durationMinutes: 120,
    bookingMode: "manual_approval",
    eligibleTechnicianIds: [],
    active: true,
  },
];

function localParts(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: usableTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** What an owner notice says about one appointment: the job, where, and when. */
function noticeDetails(
  row: Pick<
    ScheduleAppointment,
    "serviceName" | "serviceAddress" | "startAt" | "timezone"
  >,
  timeZone: string = row.timezone,
) {
  return {
    serviceName: row.serviceName,
    serviceAddress: row.serviceAddress,
    // "2026-11-12, 14:30" -> "2026-11-12 14:30"
    whenLabel: localParts(row.startAt, timeZone).replace(", ", " "),
  };
}

export function createSimulatedCalendar(fail = false): CalendarPort {
  const events = new Map<string, ScheduleAppointment>();
  return {
    kind: "simulated",
    connected: true,
    externalCalls: 0,
    async freeBusy() {
      return [];
    },
    async createEvent(appointment) {
      if (fail) return { error: "calendar_unavailable" };
      const id = `simcal_${appointment.id}`;
      events.set(id, appointment);
      return { id };
    },
    async updateEvent(eventId, appointment) {
      if (fail) return { error: "calendar_unavailable" };
      if (!events.has(eventId) && !eventId.startsWith("simcal_")) {
        return { error: "calendar_unavailable" };
      }
      events.set(eventId, appointment);
      return { ok: true };
    },
    async deleteEvent(eventId) {
      if (fail) return { error: "calendar_unavailable" };
      events.delete(eventId);
      return { ok: true };
    },
  };
}

export function createSchedulingService(deps: SchedulingDeps) {
  // The pending flag is persisted with the confirmed appointment. Downstream
  // queues deduplicate by appointment ID; a failed enqueue must not undo booking.
  async function deliverConfirmation(
    row: ScheduleAppointment,
  ): Promise<boolean> {
    if (row.status !== "confirmed" || !row.confirmationNoticesPending)
      return true;
    try {
      const when = localParts(row.startAt, row.timezone);
      if (row.customerPhoneE164)
        await deps.scheduleNotices?.({
          organizationId: row.organizationId,
          appointmentId: row.id,
          phoneE164: row.customerPhoneE164,
          customerName: row.customerName,
          serviceName: row.serviceName,
          appointmentDate: when.slice(0, 10),
          appointmentTime: when,
          startAt: row.startAt,
          simulated: row.simulated,
          leadId: row.leadId,
        });
      await deps.notify?.({
        organizationId: row.organizationId,
        title: row.customerName || row.serviceName,
        reason: "New appointment confirmed",
        kind: "confirmed",
        refId: row.id,
        ...noticeDetails(row),
      });
      await deps.store.completeConfirmation(
        row.organizationId,
        row.id,
        row.startAt,
      );
      row.confirmationNoticesPending = false;
      return true;
    } catch {
      console.warn("[scheduling] Confirmation enqueue deferred");
      return false;
    }
  }
  async function ensure(organizationId: string): Promise<AvailabilityRules> {
    const existing = await deps.store.getRules(organizationId);
    if (existing) {
      // A zone Intl does not know would throw on every availability request.
      existing.timezone = usableTimeZone(existing.timezone);
      return existing;
    }
    const now = deps.now().toISOString();
    const rules: AvailabilityRules = {
      organizationId,
      timezone: "America/Toronto",
      days: defaultDays(),
      defaultDurationMinutes: 60,
      bufferMinutes: 30,
      travelBufferMinutes: 30,
      minimumNoticeMinutes: 120,
      maxAdvanceDays: 30,
      maxDailyBookings: 8,
      holidays: [],
      calendarMode: "simulated",
      updatedAt: now,
    };
    await deps.store.saveRules(rules);
    for (const service of DEFAULT_SERVICES) {
      await deps.store.saveService({
        ...service,
        id: createId("svc"),
        organizationId,
      });
    }
    await deps.store.saveTechnician({
      id: createId("tech"),
      organizationId,
      name: "On-call technician",
      active: true,
    });
    return rules;
  }

  async function slotsFor(input: {
    organizationId: string;
    service?: ServiceType;
    from: Date;
    until: Date;
    serviceAddress?: string;
    technicianId?: string;
    excludeAppointmentId?: string;
    /** Most slots to return (default 48). A month view asks for them all. */
    limit?: number;
  }): Promise<Slot[]> {
    const limit = input.limit ?? 48;
    const rules = await ensure(input.organizationId);
    const [appointments, externalBusy, technicians] = await Promise.all([
      deps.store.listAppointments(input.organizationId),
      deps.store.listBusy(input.organizationId),
      deps.store.listTechnicians(input.organizationId),
    ]);
    const duration =
      input.service?.durationMinutes ?? rules.defaultDurationMinutes;
    const buffer = input.service?.bufferMinutes ?? rules.bufferMinutes;
    const eligible = technicians.filter((tech) => {
      if (!tech.active) return false;
      if (input.technicianId && tech.id !== input.technicianId) return false;
      if (input.service && input.service.eligibleTechnicianIds.length > 0) {
        return input.service.eligibleTechnicianIds.includes(tech.id);
      }
      return true;
    });
    const people: (Technician | undefined)[] =
      eligible.length > 0 ? eligible : [undefined];
    const slots: Slot[] = [];
    for (const person of people) {
      slots.push(
        ...listSlots({
          rules,
          from: input.from,
          until: input.until,
          durationMinutes: duration,
          bufferMinutes: buffer,
          appointments,
          externalBusy,
          now: deps.now(),
          serviceAddress: input.serviceAddress,
          technicianId: person?.id,
          technicianName: person?.name,
          excludeAppointmentId: input.excludeAppointmentId,
          maxSlots: limit,
        }),
      );
    }
    // One entry per start time: with several technicians the same time was
    // listed once each, which showed duplicates and used up the cap. The first
    // technician free at that time is kept, which is the one `book` assigns.
    const seen = new Set<string>();
    return slots
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
      .filter((slot) => {
        if (seen.has(slot.startAt)) return false;
        seen.add(slot.startAt);
        return true;
      })
      .slice(0, limit);
  }

  async function record(
    appointment: ScheduleAppointment,
    kind: string,
    detail?: string,
  ) {
    await deps.store.addEvent({
      organizationId: appointment.organizationId,
      appointmentId: appointment.id,
      kind,
      detail,
      at: deps.now().toISOString(),
    });
  }

  return {
    ensure,

    async retryPendingConfirmations(limit = 50) {
      const rows = await deps.store.listPendingConfirmations(
        Math.max(1, Math.min(100, limit)),
      );
      let queued = 0;
      for (const row of rows) {
        await withOrgLock(row.organizationId, async () => {
          const current = await deps.store.getAppointment(
            row.organizationId,
            row.id,
          );
          if (
            current?.status === "confirmed" &&
            current.confirmationNoticesPending &&
            (await deliverConfirmation(current))
          )
            queued++;
        });
      }
      return { attempted: rows.length, queued };
    },

    async getRules(organizationId: string) {
      return ensure(organizationId);
    },

    async saveRules(rules: AvailabilityRules) {
      rules.updatedAt = deps.now().toISOString();
      if (!rules.timezone) throw new SchedulingError("Timezone is required.");
      const problem = rulesProblem(rules);
      if (problem)
        throw new SchedulingError("Invalid availability.", 400, problem);
      return deps.store.saveRules(rules);
    },

    async listServices(organizationId: string) {
      await ensure(organizationId);
      return deps.store.listServices(organizationId);
    },

    async saveService(service: ServiceType) {
      if (service.durationMinutes < 15)
        throw new SchedulingError("Duration is too short.");
      const name = service.name.trim();
      if (!name) throw new SchedulingError("A name is required.");
      const key = name.toLowerCase();
      const existing = await deps.store.listServices(service.organizationId);
      const current = existing.find((row) => row.id === service.id);
      // Two services with one name cannot be told apart when booking. A
      // service that already shares its name can still be switched on or off.
      const renamed = !current || current.name.trim().toLowerCase() !== key;
      if (
        renamed &&
        existing.some(
          (row) =>
            row.id !== service.id && row.name.trim().toLowerCase() === key,
        )
      )
        throw new SchedulingError(
          "A service with this name already exists.",
          409,
          "duplicate_name",
        );
      return deps.store.saveService({ ...service, name });
    },

    async listTechnicians(organizationId: string) {
      await ensure(organizationId);
      return deps.store.listTechnicians(organizationId);
    },

    /**
     * Creates or updates a crew member. Callers enforce the plan's calendar
     * allowance (see USAGE_ALLOWANCES.calendars) before calling this with a
     * new id — this layer only validates the record itself.
     */
    async upsertTechnician(input: {
      id?: string;
      organizationId: string;
      name: string;
      serviceArea?: string;
      active?: boolean;
    }): Promise<Technician> {
      const name = input.name.trim();
      if (!name) throw new SchedulingError("A name is required.");
      if (input.id) {
        // saveTechnician's ON CONFLICT targets id alone — verify this id is
        // already this organization's own technician before overwriting it,
        // so a crafted id cannot edit another tenant's crew member.
        const existing = await deps.store.listTechnicians(input.organizationId);
        if (!existing.some((tech) => tech.id === input.id)) {
          throw new SchedulingError("Technician not found.", 404);
        }
      }
      const technician: Technician = {
        id: input.id ?? createId("tech"),
        organizationId: input.organizationId,
        name,
        serviceArea: input.serviceArea?.trim() || undefined,
        active: input.active ?? true,
      };
      return deps.store.saveTechnician(technician);
    },

    async availability(input: {
      organizationId: string;
      serviceId?: string;
      from?: string;
      until?: string;
      serviceAddress?: string;
      technicianId?: string;
    }) {
      const services = await this.listServices(input.organizationId);
      const service = input.serviceId
        ? services.find((row) => row.id === input.serviceId)
        : undefined;
      const from = input.from ? new Date(input.from) : deps.now();
      const until = input.until
        ? new Date(input.until)
        : new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
      const slots = await slotsFor({
        organizationId: input.organizationId,
        service,
        from,
        until,
        serviceAddress: input.serviceAddress,
        technicianId: input.technicianId,
      });
      return { slots, service };
    },

    /**
     * Every free start time in one calendar month, grouped by day in the
     * business's own timezone: what a calendar picker needs. It is the same
     * engine as `availability` and `book` (hours, holidays, existing
     * appointments, buffers, notice, advance limit, Google busy blocks), so a
     * day shown here is a day `book` can actually confirm.
     */
    async availabilityMonth(input: {
      organizationId: string;
      /** "YYYY-MM" in the business timezone; defaults to the current month. */
      month?: string;
      serviceId?: string;
      serviceAddress?: string;
      technicianId?: string;
      excludeAppointmentId?: string;
    }): Promise<MonthAvailability> {
      const rules = await ensure(input.organizationId);
      const tz = rules.timezone || "America/Toronto";
      const now = deps.now();
      const today = localKey(now, tz);
      const month = input.month ?? today.slice(0, 7);
      const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
      if (!match) throw new SchedulingError("Invalid month.");
      const year = Number(match[1]);
      const monthIndex = Number(match[2]) - 1;
      const currentMonths =
        Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1;
      const distance = year * 12 + monthIndex - currentMonths;
      if (distance < -1 || distance > 24)
        throw new SchedulingError("That month is out of range.");

      // Like `availability`: an unknown or since-deactivated service falls back
      // to the business defaults, so an existing appointment can still be moved.
      const services = await deps.store.listServices(input.organizationId);
      const service = input.serviceId
        ? services.find((row) => row.id === input.serviceId)
        : undefined;

      // Timezones run from UTC-12 to UTC+14: pad the range, then keep only
      // the days whose local date is in the requested month.
      const pad = 14 * 60 * 60 * 1000;
      const monthStart = Date.UTC(year, monthIndex, 1) - pad;
      const monthEnd = Date.UTC(year, monthIndex + 1, 1) + pad;
      const slots = await slotsFor({
        organizationId: input.organizationId,
        service,
        from: new Date(Math.max(monthStart, now.getTime())),
        until: new Date(monthEnd),
        serviceAddress: input.serviceAddress,
        technicianId: input.technicianId,
        excludeAppointmentId: input.excludeAppointmentId,
        limit: 10_000,
      });
      const days: MonthAvailability["days"] = {};
      for (const slot of slots) {
        const at = new Date(slot.startAt);
        const day = localKey(at, tz);
        if (!day.startsWith(`${month}-`)) continue;
        (days[day] ??= []).push({
          startAt: slot.startAt,
          time: localTime(at, tz),
        });
      }
      const horizon = new Date(
        now.getTime() + rules.maxAdvanceDays * 24 * 60 * 60 * 1000,
      );
      return {
        timezone: tz,
        month,
        today,
        lastBookableDate: localKey(horizon, tz),
        days,
      };
    },

    async list(
      organizationId: string,
      filter?: { status?: string; technicianId?: string; q?: string },
    ) {
      await ensure(organizationId);
      const rows = await deps.store.listAppointments(organizationId);
      return rows.filter((row) => {
        if (isInternalAppointment(row)) return false;
        if (filter?.status && row.status !== filter.status) return false;
        if (filter?.technicianId && row.technicianId !== filter.technicianId)
          return false;
        if (filter?.q) {
          const hay =
            `${row.customerName ?? ""} ${row.customerPhoneE164 ?? ""} ${row.serviceName}`.toLowerCase();
          if (!hay.includes(filter.q.toLowerCase())) return false;
        }
        return true;
      });
    },

    async get(organizationId: string, id: string) {
      const row = await deps.store.getAppointment(organizationId, id);
      if (!row) throw new SchedulingError("Appointment not found.", 404);
      const history = await deps.store.listEvents(organizationId, id);
      return { appointment: row, history };
    },

    async book(input: BookInput): Promise<BookResult> {
      return withOrgLock(input.organizationId, async () => {
        if (input.deadlineAt && Date.now() >= input.deadlineAt)
          return {
            ok: false,
            confirmed: false,
            reason: "booking_timed_out",
            alternatives: [],
          };
        if (input.idempotencyKey) {
          const existing = await deps.store.findByIdempotency(
            input.organizationId,
            input.idempotencyKey,
          );
          if (existing) {
            await deliverConfirmation(existing);
            return {
              ok: true,
              confirmed: existing.status === "confirmed",
              appointment: existing,
              alternatives: [],
            };
          }
        }
        const rules = await ensure(input.organizationId);
        const services = await deps.store.listServices(input.organizationId);
        const service = input.serviceId
          ? services.find((row) => row.id === input.serviceId && row.active)
          : services.find(
              (row) => row.name === input.serviceName && row.active,
            );
        if (input.serviceId && !service)
          throw new SchedulingError(
            "Unknown service.",
            404,
            services.some((row) => row.id === input.serviceId)
              ? "service_inactive"
              : "service_unknown",
          );
        const chosen = service;
        const duration =
          chosen?.durationMinutes ?? rules.defaultDurationMinutes;
        const buffer = chosen?.bufferMinutes ?? rules.bufferMinutes;
        const start = new Date(input.startAt);
        if (Number.isNaN(start.getTime()))
          throw new SchedulingError("Invalid start time.");
        const end = new Date(start.getTime() + duration * 60_000);
        const windowFrom = new Date(start.getTime() - 60_000);
        const windowUntil = new Date(end.getTime() + 7 * 24 * 60 * 60 * 1000);
        const alternatives = await slotsFor({
          organizationId: input.organizationId,
          service: chosen,
          from: deps.now(),
          until: windowUntil,
          serviceAddress: input.serviceAddress,
          technicianId: input.technicianId,
        });
        const match = slotIsFree(
          await slotsFor({
            organizationId: input.organizationId,
            service: chosen,
            from: windowFrom,
            until: new Date(end.getTime() + 60_000),
            serviceAddress: input.serviceAddress,
            technicianId: input.technicianId,
          }),
          start.toISOString(),
        );

        const needsReview =
          chosen?.bookingMode === "manual_approval" ||
          chosen?.bookingMode === "escalate";
        const calendar = input.simulated
          ? createSimulatedCalendar(Boolean(input.simulateCalendarFailure))
          : await deps.calendar(input.organizationId);
        const calendarBlocksConfirmation =
          !input.simulated &&
          rules.calendarMode === "google" &&
          (!calendar.connected || calendar.kind !== "google");

        if (
          !match &&
          input.requestIfUnavailable === false &&
          !needsReview &&
          !calendarBlocksConfirmation
        ) {
          return {
            ok: false,
            confirmed: false,
            reason: "conflict",
            alternatives: alternatives.slice(0, 6),
          };
        }

        const base: ScheduleAppointment = {
          id: createId("appt"),
          organizationId: input.organizationId,
          customerName: input.customerName,
          customerPhoneE164: input.customerPhoneE164,
          customerEmail: input.customerEmail,
          serviceAddress: input.serviceAddress,
          serviceId: chosen?.id,
          serviceName: chosen?.name ?? input.serviceName ?? "Appointment",
          technicianId: match?.technicianId ?? input.technicianId,
          technicianName: match?.technicianName,
          leadId: input.leadId,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          timezone: rules.timezone,
          status: "pending",
          bookingSource: input.source,
          appointmentKind:
            chosen?.bookingMode === "consultation"
              ? "consultation"
              : needsReview || calendarBlocksConfirmation
                ? "request"
                : "job",
          idempotencyKey: input.idempotencyKey,
          simulated: Boolean(input.simulated),
          createdAt: deps.now().toISOString(),
          updatedAt: deps.now().toISOString(),
        };

        if (calendarBlocksConfirmation) {
          void import("@/product/reliability/hooks").then(({ recordFailure }) =>
            recordFailure({
              organizationId: input.organizationId,
              service: "google_calendar",
              operation: "book_appointment",
              errorCode: "CALENDAR_UNAVAILABLE",
              severity: "medium",
              retryable: true,
              simulated: Boolean(input.simulated),
            }),
          );
        }
        if (!match || needsReview || calendarBlocksConfirmation) {
          const saved = await deps.store.insertIfFree(
            { ...base, status: "pending" },
            0,
          );
          const appointment = saved ?? base;
          if (saved)
            await record(
              appointment,
              "request_recorded",
              needsReview
                ? chosen?.bookingMode
                : calendarBlocksConfirmation
                  ? "calendar_disconnected"
                  : "unavailable",
            );
          await deps.notify?.({
            organizationId: input.organizationId,
            title: appointment.customerName || appointment.serviceName,
            reason: needsReview
              ? "Appointment needs contractor approval"
              : "Appointment request saved for review",
            kind: "requested",
            refId: appointment.id,
            ...noticeDetails(appointment, rules.timezone),
          });
          return {
            ok: Boolean(saved) || needsReview || calendarBlocksConfirmation,
            confirmed: false,
            reason: needsReview
              ? chosen?.bookingMode
              : calendarBlocksConfirmation
                ? "calendar_unavailable"
                : "unavailable",
            appointment: saved ?? undefined,
            alternatives: alternatives.slice(0, 6),
          };
        }

        // Other workers must see a hold, never a confirmation, while the
        // calendar event is still being created.
        if (input.deadlineAt && Date.now() >= input.deadlineAt)
          return {
            ok: false,
            confirmed: false,
            reason: "booking_timed_out",
            alternatives: [],
          };
        const reserved = await deps.store.insertIfFree(
          {
            ...base,
            status: "hold",
            holdExpiresAt: new Date(
              deps.now().getTime() + 5 * 60_000,
            ).toISOString(),
          },
          buffer,
        );
        if (!reserved || (reserved.id !== base.id && reserved.status)) {
          if (reserved && reserved.idempotencyKey === input.idempotencyKey) {
            return {
              ok: true,
              confirmed: reserved.status === "confirmed",
              appointment: reserved,
              alternatives: [],
            };
          }
          return {
            ok: false,
            confirmed: false,
            reason: "conflict",
            alternatives: alternatives.slice(0, 6),
          };
        }
        const created = await calendar.createEvent(reserved);
        if (
          !("error" in created) &&
          input.deadlineAt &&
          Date.now() >= input.deadlineAt
        ) {
          reserved.status = "canceled";
          reserved.cancelReason = "booking_timed_out";
          await deps.store.saveAppointment(reserved);
          await calendar.deleteEvent(created.id);
          return {
            ok: false,
            confirmed: false,
            reason: "booking_timed_out",
            alternatives: [],
          };
        }
        if ("error" in created) {
          reserved.status = "canceled";
          reserved.cancelReason = "calendar_sync_failed";
          reserved.updatedAt = deps.now().toISOString();
          await deps.store.saveAppointment(reserved);
          await record(reserved, "calendar_failed", created.error);
          const request = await deps.store.insertIfFree(
            {
              ...base,
              id: createId("appt"),
              status: "pending",
              appointmentKind: "request",
              idempotencyKey: undefined,
            },
            0,
          );
          return {
            ok: false,
            confirmed: false,
            reason: "calendar_error",
            appointment: request ?? undefined,
            alternatives: alternatives.slice(0, 6),
          };
        }
        reserved.calendarEventId = created.id;
        reserved.status = "confirmed";
        reserved.confirmationNoticesPending = true;
        reserved.holdExpiresAt = undefined;
        reserved.updatedAt = deps.now().toISOString();
        const linked = await deps.linkLead?.({
          organizationId: input.organizationId,
          phone: input.customerPhoneE164,
          name: input.customerName,
          service: reserved.serviceName,
          address: input.serviceAddress,
          startAt: reserved.startAt,
          simulated: reserved.simulated,
        });
        if (linked && "leadId" in linked && linked.leadId)
          reserved.leadId = linked.leadId;
        await deps.store.saveAppointment(reserved);
        await deliverConfirmation(reserved);
        try {
          await record(reserved, "confirmed", created.id);
        } catch {
          console.warn(
            "[scheduling] Confirmed appointment history write failed",
          );
        }
        return {
          ok: true,
          confirmed: true,
          appointment: reserved,
          alternatives: [],
        };
      });
    },

    async reschedule(
      organizationId: string,
      appointmentId: string,
      startAt: string,
    ) {
      return withOrgLock(organizationId, async () => {
        const current = await deps.store.getAppointment(
          organizationId,
          appointmentId,
        );
        if (!current || current.status === "canceled")
          throw new SchedulingError("Appointment not found.", 404);
        if (current.status === "completed")
          throw new SchedulingError(
            "A completed appointment cannot be moved.",
            409,
            "already_completed",
          );
        const rules = await ensure(organizationId);
        const services = await deps.store.listServices(organizationId);
        const service = services.find((row) => row.id === current.serviceId);
        const duration =
          Date.parse(current.endAt) - Date.parse(current.startAt);
        const start = new Date(startAt);
        if (Number.isNaN(start.getTime()))
          throw new SchedulingError("Invalid start time.");
        const end = new Date(start.getTime() + duration);
        const alternatives = await slotsFor({
          organizationId,
          service,
          from: deps.now(),
          until: new Date(deps.now().getTime() + 7 * 24 * 60 * 60 * 1000),
          serviceAddress: current.serviceAddress,
          technicianId: current.technicianId,
          excludeAppointmentId: current.id,
        });
        const match = slotIsFree(
          await slotsFor({
            organizationId,
            service,
            from: new Date(start.getTime() - 60_000),
            until: new Date(end.getTime() + 60_000),
            serviceAddress: current.serviceAddress,
            technicianId: current.technicianId,
            excludeAppointmentId: current.id,
          }),
          start.toISOString(),
        );
        if (!match) {
          return {
            ok: false as const,
            confirmed: false,
            reason: "unavailable",
            alternatives: alternatives.slice(0, 6),
            appointment: current,
          };
        }
        const previous = {
          startAt: current.startAt,
          endAt: current.endAt,
          eventId: current.calendarEventId,
        };
        current.startAt = start.toISOString();
        current.endAt = end.toISOString();
        current.updatedAt = deps.now().toISOString();
        const buffer = service?.bufferMinutes ?? rules.bufferMinutes;
        const reinserted = await deps.store.insertIfFree(
          {
            ...current,
            id: `${current.id}_move`,
            idempotencyKey: undefined,
            status: "hold",
            holdExpiresAt: new Date(
              deps.now().getTime() + 60_000,
            ).toISOString(),
          },
          buffer,
          // Its own current time is not a clash: moving by half an hour is fine.
          current.id,
        );
        if (!reinserted) {
          current.startAt = previous.startAt;
          current.endAt = previous.endAt;
          return {
            ok: false as const,
            confirmed: false,
            reason: "conflict",
            alternatives: alternatives.slice(0, 6),
            appointment: current,
          };
        }
        const calendar = current.simulated
          ? createSimulatedCalendar()
          : await deps.calendar(organizationId);
        if (current.calendarEventId) {
          const updated = await calendar.updateEvent(
            current.calendarEventId,
            current,
          );
          if ("error" in updated) {
            current.startAt = previous.startAt;
            current.endAt = previous.endAt;
            reinserted.status = "canceled";
            reinserted.cancelReason = "reschedule_hold";
            await deps.store.saveAppointment(reinserted);
            await deps.store.saveAppointment(current);
            return {
              ok: false as const,
              confirmed: false,
              reason: "calendar_error",
              alternatives: alternatives.slice(0, 6),
              appointment: current,
            };
          }
        }
        reinserted.status = "canceled";
        reinserted.cancelReason = "reschedule_hold";
        await deps.store.saveAppointment(reinserted);
        await deps.store.saveAppointment(current);
        await record(
          current,
          "rescheduled",
          `${previous.startAt}->${current.startAt}`,
        );
        await deps.notify?.({
          organizationId,
          title: current.customerName || current.serviceName,
          reason: "Appointment rescheduled",
          kind: "rescheduled",
          refId: current.id,
          ...noticeDetails(current, rules.timezone),
        });
        await deps.cancelNotices?.(organizationId, current.id, "rescheduled");
        if (current.customerPhoneE164 && current.status === "confirmed") {
          const when = localParts(current.startAt, rules.timezone);
          await deps.scheduleNotices?.({
            organizationId,
            appointmentId: current.id,
            phoneE164: current.customerPhoneE164,
            customerName: current.customerName,
            serviceName: current.serviceName,
            appointmentDate: when.slice(0, 10),
            appointmentTime: when,
            startAt: current.startAt,
            simulated: current.simulated,
            leadId: current.leadId,
          });
        }
        return {
          ok: true as const,
          confirmed: current.status === "confirmed",
          appointment: current,
          alternatives: [],
        };
      });
    },

    async cancel(
      organizationId: string,
      appointmentId: string,
      reason?: string,
    ) {
      const current = await deps.store.getAppointment(
        organizationId,
        appointmentId,
      );
      if (!current) throw new SchedulingError("Appointment not found.", 404);
      if (current.status === "canceled")
        return { ok: true, appointment: current };
      if (current.calendarEventId) {
        const calendar = current.simulated
          ? createSimulatedCalendar()
          : await deps.calendar(organizationId);
        const removed = await calendar.deleteEvent(current.calendarEventId);
        if ("error" in removed) {
          return {
            ok: false as const,
            reason: "calendar_error",
            appointment: current,
          };
        }
      }
      current.status = "canceled";
      current.cancelReason = reason || "canceled";
      current.updatedAt = deps.now().toISOString();
      await deps.store.saveAppointment(current);
      await record(current, "canceled", current.cancelReason);
      await deps.cancelNotices?.(
        organizationId,
        current.id,
        "appointment_canceled",
      );
      await deps.notify?.({
        organizationId,
        title: current.customerName || current.serviceName,
        reason: "Appointment canceled",
        kind: "canceled",
        refId: current.id,
        ...noticeDetails(current),
      });
      return { ok: true as const, appointment: current };
    },

    /**
     * The contractor accepts a pending request (a manual-approval service, or
     * a request saved while the calendar was unreachable). It becomes a
     * confirmed appointment exactly like a normal booking: the time must still
     * be free, the calendar event is created, and the customer is told.
     * Posted hours and minimum notice are the contractor's own rules for
     * customers, so they do not stop the contractor from saying yes.
     */
    async approve(organizationId: string, appointmentId: string) {
      return withOrgLock(organizationId, async () => {
        const current = await deps.store.getAppointment(
          organizationId,
          appointmentId,
        );
        if (!current || isInternalAppointment(current))
          throw new SchedulingError("Appointment not found.", 404);
        if (current.status === "confirmed")
          return { ok: true as const, confirmed: true, appointment: current };
        if (current.status !== "pending")
          throw new SchedulingError(
            "Only a pending request can be approved.",
            409,
            "not_pending",
          );
        const fail = (reason: string) => ({
          ok: false as const,
          confirmed: false,
          reason,
          appointment: current,
        });
        if (Date.parse(current.startAt) <= deps.now().getTime())
          return fail("past");
        const rules = await ensure(organizationId);
        const services = await deps.store.listServices(organizationId);
        const service = services.find((row) => row.id === current.serviceId);
        const calendar = current.simulated
          ? createSimulatedCalendar()
          : await deps.calendar(organizationId);
        if (
          !current.simulated &&
          rules.calendarMode === "google" &&
          (!calendar.connected || calendar.kind !== "google")
        )
          return fail("calendar_unavailable");
        // The same atomic guard a booking uses: a short hold on the time, so
        // two approvals (or an approval and a booking) cannot both win.
        const hold = await deps.store.insertIfFree(
          {
            ...current,
            id: `${current.id}_approve`,
            idempotencyKey: undefined,
            status: "hold",
            holdExpiresAt: new Date(
              deps.now().getTime() + 60_000,
            ).toISOString(),
          },
          service?.bufferMinutes ?? rules.bufferMinutes,
        );
        if (!hold) return fail("conflict");
        const releaseHold = async () => {
          hold.status = "canceled";
          hold.cancelReason = "approval_hold";
          await deps.store.saveAppointment(hold);
        };
        const created = await calendar.createEvent(current);
        if ("error" in created) {
          await releaseHold();
          await record(current, "calendar_failed", created.error);
          return fail("calendar_error");
        }
        current.calendarEventId = created.id;
        current.status = "confirmed";
        if (current.appointmentKind === "request")
          current.appointmentKind = "job";
        current.confirmationNoticesPending = true;
        current.updatedAt = deps.now().toISOString();
        if (!current.leadId) {
          const linked = await deps.linkLead?.({
            organizationId,
            phone: current.customerPhoneE164,
            name: current.customerName,
            service: current.serviceName,
            address: current.serviceAddress,
            startAt: current.startAt,
            simulated: current.simulated,
          });
          if (linked && "leadId" in linked && linked.leadId)
            current.leadId = linked.leadId;
        }
        await deps.store.saveAppointment(current);
        await releaseHold();
        await deliverConfirmation(current);
        try {
          await record(current, "confirmed", "approved");
        } catch {
          console.warn("[scheduling] Approved appointment history write failed");
        }
        return { ok: true as const, confirmed: true, appointment: current };
      });
    },

    async updateDetails(
      organizationId: string,
      appointmentId: string,
      patch: {
        technicianId?: string;
        customerName?: string;
        serviceAddress?: string;
        status?: "completed";
      },
    ) {
      const current = await deps.store.getAppointment(
        organizationId,
        appointmentId,
      );
      if (!current) throw new SchedulingError("Appointment not found.", 404);
      if (patch.customerName) current.customerName = patch.customerName;
      if (patch.serviceAddress) current.serviceAddress = patch.serviceAddress;
      if (patch.technicianId) {
        const technicians = await deps.store.listTechnicians(organizationId);
        const tech = technicians.find(
          (row) =>
            row.id === patch.technicianId &&
            row.organizationId === organizationId,
        );
        if (!tech) throw new SchedulingError("Unknown technician.", 404);
        current.technicianId = tech.id;
        current.technicianName = tech.name;
      }
      if (patch.status === "completed" && current.status !== "completed") {
        if (current.status !== "confirmed")
          throw new SchedulingError(
            "Only a confirmed appointment can be completed.",
            409,
            "not_confirmed",
          );
        // Finishing a job early in the day is normal; next week's is a slip.
        const rules = await ensure(organizationId);
        if (
          localKey(new Date(current.startAt), rules.timezone) >
          localKey(deps.now(), rules.timezone)
        )
          throw new SchedulingError(
            "This appointment has not started yet.",
            409,
            "not_started",
          );
        current.status = "completed";
        await record(current, "completed");
      }
      current.updatedAt = deps.now().toISOString();
      await deps.store.saveAppointment(current);
      return current;
    },

    async connectionStatus(
      organizationId: string,
    ): Promise<CalendarConnectionPublic> {
      const rules = await ensure(organizationId);
      if (rules.calendarMode !== "google") {
        return { provider: "google", status: "simulated" };
      }
      const row = await deps.store.getConnection(organizationId);
      if (!row) return { provider: "google", status: "disconnected" };
      return {
        provider: "google",
        status: row.status,
        calendarId: row.calendarId,
        calendarSummary: row.calendarSummary,
        accountEmail: row.accountEmail,
        expiresAt: row.expiresAt,
        lastError: row.lastError,
      };
    },

    async disconnect(organizationId: string) {
      const rules = await ensure(organizationId);
      rules.calendarMode = "simulated";
      await deps.store.saveRules(rules);
      await deps.store.saveConnection({
        organizationId,
        provider: "google",
        status: "disconnected",
      });
      await deps.onDisconnected?.(organizationId);
    },

    async selectCalendar(
      organizationId: string,
      calendarId: string,
      summary: string,
    ) {
      const row = await deps.store.getConnection(organizationId);
      if (!row || row.status === "disconnected")
        throw new SchedulingError("Calendar is not connected.", 409);
      row.calendarId = calendarId;
      row.calendarSummary = summary;
      row.status = "connected";
      await deps.store.saveConnection(row);
      const rules = await ensure(organizationId);
      rules.calendarMode = "google";
      await deps.store.saveRules(rules);
      return this.connectionStatus(organizationId);
    },

    async syncBusy(organizationId: string, blocks: BusyBlock[]) {
      await deps.store.replaceBusy(organizationId, blocks);
    },
  };
}

export type SchedulingService = ReturnType<typeof createSchedulingService>;
