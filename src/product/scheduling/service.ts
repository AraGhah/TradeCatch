import { createId } from "@/lib/id";
import { defaultDays, listSlots, slotIsFree } from "./slots";
import { withOrgLock, type SchedulingStore } from "./store";
import type {
  AvailabilityRules,
  BusyBlock,
  CalendarConnectionPublic,
  ScheduleAppointment,
  ServiceType,
  Slot,
  Technician,
} from "./types";

export class SchedulingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "SchedulingError";
  }
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
    refId: string;
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
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
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
        refId: row.id,
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
    if (existing) return existing;
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
  }): Promise<Slot[]> {
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
        }),
      );
    }
    return slots
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
      .slice(0, 48);
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
      return deps.store.saveRules(rules);
    },

    async listServices(organizationId: string) {
      await ensure(organizationId);
      return deps.store.listServices(organizationId);
    },

    async saveService(service: ServiceType) {
      if (service.durationMinutes < 15)
        throw new SchedulingError("Duration is too short.");
      return deps.store.saveService(service);
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

    async list(
      organizationId: string,
      filter?: { status?: string; technicianId?: string; q?: string },
    ) {
      await ensure(organizationId);
      const rows = await deps.store.listAppointments(organizationId);
      return rows.filter((row) => {
        if (row.status === "hold") return false;
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
          throw new SchedulingError("Unknown service.", 404);
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
          ? createSimulatedCalendar()
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
            refId: appointment.id,
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
        const rules = await ensure(organizationId);
        const services = await deps.store.listServices(organizationId);
        const service = services.find((row) => row.id === current.serviceId);
        const duration =
          Date.parse(current.endAt) - Date.parse(current.startAt);
        const start = new Date(startAt);
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
          refId: current.id,
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
        refId: current.id,
      });
      return { ok: true as const, appointment: current };
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
      if (patch.status === "completed" && current.status === "confirmed") {
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
