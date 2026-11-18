import { createId } from "@/lib/id";
import { parseInstant, parseRange } from "./instant";
import {
  defaultDays,
  listSlots,
  localKey,
  localTime,
  isValidTimeZone,
  rulesProblem,
  slotIsFree,
  usableTimeZone,
} from "./slots";
import { withOrgLock, type SchedulingStore } from "./store";
import type {
  AvailabilityRules,
  BusyBlock,
  CalendarConnectionPublic,
  CalendarMode,
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
  // A demo business wiped back to empty: its sample visits are not history.
  "demo_reset",
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

/** What a provider that owns availability (Cal.com) is asked for. */
export type ProviderSlotQuery = {
  from: Date;
  until: Date;
  /** The business timezone: Cal.com answers in it, which settles DST. */
  timeZone: string;
  serviceId?: string;
  technicianId?: string;
  /** The booking being moved, so its own time is not counted as busy. */
  rescheduleEventId?: string;
};

export type ProviderSlotsResult =
  | { ok: true; starts: string[] }
  | { error: string };

export type CalendarPort = {
  kind: "simulated" | "google" | "calcom";
  connected: boolean;
  externalCalls: number;
  freeBusy(fromIso: string, untilIso: string): Promise<BusyBlock[]>;
  /**
   * Providers that decide availability themselves return the start times they
   * would accept. TradeCatch's own rules and bookings are applied on top, so
   * a time is offered only when both agree.
   */
  listSlots?(query: ProviderSlotQuery): Promise<ProviderSlotsResult>;
  createEvent(
    appointment: ScheduleAppointment,
  ): Promise<{ id: string } | { error: string }>;
  updateEvent(
    eventId: string,
    appointment: ScheduleAppointment,
  ): Promise<{ ok: true; eventId?: string } | { error: string }>;
  deleteEvent(eventId: string): Promise<{ ok: true } | { error: string }>;
};

export type SchedulingDeps = {
  store: SchedulingStore;
  now: () => Date;
  /**
   * The business's own IANA timezone (its organization record). It seeds the
   * availability rules the first time they are created, so a Vancouver business
   * is not scheduled in Toronto time until someone finds the setting.
   */
  businessTimeZone?: (organizationId: string) => Promise<string | undefined>;
  /** The availability rules moved to a new zone: the business record follows. */
  businessTimeZoneChanged?: (
    organizationId: string,
    timeZone: string,
  ) => Promise<void>;
  /**
   * `hint.eventId` is the calendar event an operation is about. A booking made
   * with one provider is changed through that provider, whatever the business
   * uses today.
   */
  calendar: (
    organizationId: string,
    hint?: { eventId?: string },
  ) => Promise<CalendarPort>;
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

/**
 * First-time setups in progress, by business. Kept on `globalThis` like the
 * store itself, so it is one map however the modules were bundled.
 */
const settingUp = ((
  globalThis as typeof globalThis & {
    __tradecatchSchedulingSetup?: Map<string, Promise<AvailabilityRules>>;
  }
).__tradecatchSchedulingSetup ??= new Map());

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
  /**
   * A business's first setup: its hours, its default services and its one
   * technician. It must happen once. Every technician is another person who
   * can take the same hour, so a second copy of the default one lets two
   * customers be confirmed for the same time.
   */
  async function seed(organizationId: string): Promise<AvailabilityRules> {
    // Another request may have finished the setup while this one waited.
    const raced = await deps.store.getRules(organizationId);
    if (raced) return raced;
    const now = deps.now().toISOString();
    let seededZone: string | undefined;
    try {
      seededZone = await deps.businessTimeZone?.(organizationId);
    } catch {
      // The organization record is a convenience here: scheduling must work without it.
    }
    const rules: AvailabilityRules = {
      organizationId,
      timezone: usableTimeZone(seededZone),
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
    // The rows have fixed ids, so a second server instance that also found
    // the business empty writes the very same rows instead of adding copies.
    // The rules go last: they are what marks the business as set up, so a
    // setup cut short is simply done again.
    await deps.store.saveTechnician({
      id: `tech_${organizationId}_default`,
      organizationId,
      name: "On-call technician",
      active: true,
    });
    for (const [index, service] of DEFAULT_SERVICES.entries()) {
      await deps.store.saveService({
        ...service,
        id: `svc_${organizationId}_${index + 1}`,
        organizationId,
      });
    }
    await deps.store.saveRules(rules);
    return rules;
  }

  async function ensure(organizationId: string): Promise<AvailabilityRules> {
    const existing = await deps.store.getRules(organizationId);
    if (existing) {
      // A zone Intl does not know would throw on every availability request.
      existing.timezone = usableTimeZone(existing.timezone);
      return existing;
    }
    // The first requests on a new calendar arrive together (the dashboard
    // asks four questions at once, and every request builds its own service
    // object): they share one setup rather than each running their own.
    let setup = settingUp.get(organizationId);
    if (!setup) {
      setup = seed(organizationId).finally(() => {
        settingUp.delete(organizationId);
      });
      settingUp.set(organizationId, setup);
    }
    return structuredClone(await setup);
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
    /** The provider to ask when the business uses Cal.com; fetched if omitted. */
    calendar?: CalendarPort;
    /** Test bookings never reach the contractor's real calendar. */
    simulated?: boolean;
    /** The calendar event of the booking being moved (Cal.com only). */
    rescheduleEventId?: string;
  }): Promise<Slot[]> {
    const limit = input.limit ?? 48;
    const rules = await ensure(input.organizationId);
    const [appointments, externalBusy, technicians] = await Promise.all([
      deps.store.listAppointments(input.organizationId),
      deps.store.listBusy(input.organizationId),
      deps.store.listTechnicians(input.organizationId),
    ]);
    // With Cal.com the contractor's calendar decides which times exist. Without
    // a working connection nothing is offered: a time that cannot be booked is
    // never read out.
    let provider: CalendarPort | undefined;
    if (rules.calendarMode === "calcom" && !input.simulated) {
      provider = input.calendar ?? (await deps.calendar(input.organizationId));
      if (
        provider.kind !== "calcom" ||
        !provider.connected ||
        !provider.listSlots
      ) {
        return [];
      }
    }
    let providerFailed = false;
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
      let allowedStarts: ReadonlySet<string> | undefined;
      if (provider?.listSlots) {
        const offered = await provider.listSlots({
          from: input.from,
          until: input.until,
          timeZone: rules.timezone,
          serviceId: input.service?.id,
          technicianId: person?.id,
          rescheduleEventId: input.rescheduleEventId,
        });
        if (!("ok" in offered)) {
          providerFailed = true;
          continue;
        }
        allowedStarts = new Set(offered.starts);
      }
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
          allowedStarts,
        }),
      );
    }
    if (providerFailed && slots.length === 0) {
      throw new SchedulingError(
        "The calendar could not be reached.",
        503,
        "calendar_unavailable",
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
      const previous = await deps.store.getRules(rules.organizationId);
      const saved = await deps.store.saveRules(rules);
      // The business has one zone: when the hours screen moves it, the
      // business record follows, so reminders and quiet hours agree with the
      // calendar.
      if (previous && previous.timezone !== rules.timezone)
        await deps.businessTimeZoneChanged?.(
          rules.organizationId,
          rules.timezone,
        );
      return saved;
    },

    /**
     * The business changed its own time zone: scheduling follows. Existing
     * appointments keep their UTC instant (so nothing moves in time); only the
     * way the calendar reads and draws them changes. Rules that do not exist
     * yet are seeded from the business when first needed.
     */
    async setTimeZone(organizationId: string, timeZone: string) {
      if (!isValidTimeZone(timeZone))
        throw new SchedulingError(
          "Invalid timezone.",
          400,
          "invalid_timezone",
        );
      const rules = await deps.store.getRules(organizationId);
      if (!rules || rules.timezone === timeZone) return;
      rules.timezone = timeZone;
      rules.updatedAt = deps.now().toISOString();
      await deps.store.saveRules(rules);
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
      const from = input.from ? parseInstant(input.from) : deps.now();
      if (!from)
        throw new SchedulingError("Invalid start time.", 400, "invalid_start");
      const until = input.until
        ? parseInstant(input.until)
        : new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
      if (!until || until.getTime() <= from.getTime())
        throw new SchedulingError("Invalid date range.", 400, "invalid_range");
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
      filter?: {
        status?: string;
        technicianId?: string;
        q?: string;
        /** Only appointments that overlap [from, to): ISO instants with an offset. */
        from?: string;
        to?: string;
      },
    ) {
      await ensure(organizationId);
      let range: { from: number; to: number } | null = null;
      if (filter?.from || filter?.to) {
        const parsed = parseRange(filter.from, filter.to);
        if (!parsed)
          throw new SchedulingError("Invalid date range.", 400, "invalid_range");
        range = { from: parsed.from.getTime(), to: parsed.to.getTime() };
      }
      const rows = await deps.store.listAppointments(organizationId);
      return rows.filter((row) => {
        if (isInternalAppointment(row)) return false;
        if (
          range &&
          !(Date.parse(row.endAt) > range.from && Date.parse(row.startAt) < range.to)
        )
          return false;
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
        const start = parseInstant(input.startAt);
        if (!start)
          throw new SchedulingError("Invalid start time.", 400, "invalid_start");
        const end = new Date(start.getTime() + duration * 60_000);
        const windowFrom = new Date(start.getTime() - 60_000);
        const windowUntil = new Date(end.getTime() + 7 * 24 * 60 * 60 * 1000);
        const calendar = input.simulated
          ? createSimulatedCalendar(Boolean(input.simulateCalendarFailure))
          : await deps.calendar(input.organizationId);
        // A Cal.com outage must not stop a request from being saved, so the
        // two lookups treat "calendar unreachable" as "no times" and remember
        // it: the booking is then recorded as a request, never confirmed.
        let providerDown = false;
        const openSlots = async (
          range: { from: Date; until: Date },
        ): Promise<Slot[]> => {
          try {
            return await slotsFor({
              organizationId: input.organizationId,
              service: chosen,
              from: range.from,
              until: range.until,
              serviceAddress: input.serviceAddress,
              technicianId: input.technicianId,
              calendar,
              simulated: input.simulated,
            });
          } catch (error) {
            if (
              error instanceof SchedulingError &&
              error.code === "calendar_unavailable"
            ) {
              providerDown = true;
              return [];
            }
            throw error;
          }
        };
        const alternatives = await openSlots({
          from: deps.now(),
          until: windowUntil,
        });
        const match = slotIsFree(
          await openSlots({
            from: windowFrom,
            until: new Date(end.getTime() + 60_000),
          }),
          start.toISOString(),
        );

        const needsReview =
          chosen?.bookingMode === "manual_approval" ||
          chosen?.bookingMode === "escalate";
        const calendarBlocksConfirmation =
          !input.simulated &&
          ((rules.calendarMode === "google" &&
            (!calendar.connected || calendar.kind !== "google")) ||
            (rules.calendarMode === "calcom" &&
              (!calendar.connected ||
                calendar.kind !== "calcom" ||
                providerDown)));

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
              service:
                rules.calendarMode === "calcom" ? "calcom" : "google_calendar",
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
          // The key moves to the request saved below. A retry then finds that
          // request instead of this dead hold, so it is never answered with a
          // canceled row dressed up as a success, and never piles up copies.
          reserved.idempotencyKey = undefined;
          reserved.updatedAt = deps.now().toISOString();
          await deps.store.saveAppointment(reserved);
          await record(reserved, "calendar_failed", created.error);
          // Cal.com said the time was taken between our check and the
          // booking. For a caller who is offered another time on the line
          // that is a plain conflict, not a request to leave behind.
          if (
            created.error === "slot_unavailable" &&
            input.requestIfUnavailable === false
          ) {
            return {
              ok: false,
              confirmed: false,
              reason: "conflict",
              alternatives: alternatives.slice(0, 6),
            };
          }
          const request = await deps.store.insertIfFree(
            {
              ...base,
              id: createId("appt"),
              status: "pending",
              appointmentKind: "request",
              idempotencyKey: input.idempotencyKey,
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
        const start = parseInstant(startAt);
        if (!start)
          throw new SchedulingError("Invalid start time.", 400, "invalid_start");
        const end = new Date(start.getTime() + duration);
        const alternatives = await slotsFor({
          organizationId,
          service,
          from: deps.now(),
          until: new Date(deps.now().getTime() + 7 * 24 * 60 * 60 * 1000),
          serviceAddress: current.serviceAddress,
          technicianId: current.technicianId,
          excludeAppointmentId: current.id,
          simulated: current.simulated,
          rescheduleEventId: current.calendarEventId,
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
            simulated: current.simulated,
            rescheduleEventId: current.calendarEventId,
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
          : await deps.calendar(organizationId, {
              eventId: current.calendarEventId,
            });
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
          // Cal.com gives the moved booking a new uid; the old one is dead.
          if (updated.eventId) current.calendarEventId = updated.eventId;
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
      // Under the same lock as a move or an approval: a cancel that lands in
      // the middle of a reschedule must not be overwritten by it.
      return withOrgLock(organizationId, async () => {
      const current = await deps.store.getAppointment(
        organizationId,
        appointmentId,
      );
      if (!current || isInternalAppointment(current))
        throw new SchedulingError("Appointment not found.", 404);
      if (current.status === "canceled")
        return { ok: true, appointment: current };
      if (current.status === "completed")
        throw new SchedulingError(
          "A completed appointment cannot be canceled.",
          409,
          "already_completed",
        );
      if (current.calendarEventId) {
        const calendar = current.simulated
          ? createSimulatedCalendar()
          : await deps.calendar(organizationId, {
              eventId: current.calendarEventId,
            });
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
      });
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
          ((rules.calendarMode === "google" &&
            (!calendar.connected || calendar.kind !== "google")) ||
            (rules.calendarMode === "calcom" &&
              (!calendar.connected || calendar.kind !== "calcom")))
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
        /** A new number, or null to remove it. The caller has already normalized it to E.164. */
        customerPhoneE164?: string | null;
        serviceAddress?: string;
        status?: "completed";
      },
    ) {
      // Serialized with bookings and moves: handing the job to another
      // technician is a booking decision, not a field edit.
      return withOrgLock(organizationId, async () => {
      const current = await deps.store.getAppointment(
        organizationId,
        appointmentId,
      );
      if (!current || isInternalAppointment(current))
        throw new SchedulingError("Appointment not found.", 404);
      const previousPhone = current.customerPhoneE164;
      if (patch.customerName) current.customerName = patch.customerName;
      // An emptied address is a removed address; an emptied name is ignored.
      if (patch.serviceAddress !== undefined)
        current.serviceAddress = patch.serviceAddress.trim() || undefined;
      if (patch.customerPhoneE164 !== undefined)
        current.customerPhoneE164 = patch.customerPhoneE164 || undefined;
      if (patch.technicianId && patch.technicianId !== current.technicianId) {
        const technicians = await deps.store.listTechnicians(organizationId);
        const tech = technicians.find(
          (row) =>
            row.id === patch.technicianId &&
            row.organizationId === organizationId,
        );
        if (!tech) throw new SchedulingError("Unknown technician.", 404);
        if (current.status === "canceled" || current.status === "completed")
          throw new SchedulingError(
            "This appointment can no longer be reassigned.",
            409,
            "not_open",
          );
        if (current.status === "confirmed") {
          // The new technician must be free for the whole job, buffers
          // included: the same atomic guard a booking uses.
          const services = await deps.store.listServices(organizationId);
          const rules = await ensure(organizationId);
          const service = services.find((row) => row.id === current.serviceId);
          const hold = await deps.store.insertIfFree(
            {
              ...current,
              id: `${current.id}_assign`,
              technicianId: tech.id,
              idempotencyKey: undefined,
              status: "hold",
              holdExpiresAt: new Date(deps.now().getTime() + 60_000).toISOString(),
            },
            service?.bufferMinutes ?? rules.bufferMinutes,
            current.id,
          );
          if (!hold)
            throw new SchedulingError(
              "That technician is busy at this time.",
              409,
              "technician_busy",
            );
          hold.status = "canceled";
          hold.cancelReason = "reschedule_hold";
          await deps.store.saveAppointment(hold);
        }
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
      // Reminders go to the number on the record: when it changes, the texts
      // already queued for the old one stop and the new one is queued.
      if (
        current.customerPhoneE164 !== previousPhone &&
        current.status === "confirmed" &&
        Date.parse(current.startAt) > deps.now().getTime()
      ) {
        await deps.cancelNotices?.(organizationId, current.id, "contact_changed");
        if (current.customerPhoneE164) {
          const when = localParts(current.startAt, current.timezone);
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
      }
      return current;
      });
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

    /**
     * Choose which calendar decides availability. The caller has already
     * checked that the business may use that provider.
     */
    async setCalendarMode(organizationId: string, mode: CalendarMode) {
      const rules = await ensure(organizationId);
      if (rules.calendarMode !== mode) {
        rules.calendarMode = mode;
        rules.updatedAt = deps.now().toISOString();
        await deps.store.saveRules(rules);
      }
      return rules;
    },

    /**
     * Whether a business that books through Cal.com can confirm right now.
     * Other calendar modes answer true: their own checks live elsewhere.
     */
    async calendarReady(organizationId: string): Promise<boolean> {
      const rules = await ensure(organizationId);
      if (rules.calendarMode !== "calcom") return true;
      const calendar = await deps.calendar(organizationId);
      return calendar.kind === "calcom" && calendar.connected;
    },

    /**
     * The provider changed a booking behind our back (the contractor moved or
     * cancelled it in Cal.com). TradeCatch follows: the provider's calendar is
     * the one that decides. Nothing is sent to the provider.
     */
    async applyProviderChange(
      organizationId: string,
      appointmentId: string,
      change:
        | { kind: "canceled" }
        | { kind: "moved"; startAt: string; eventId: string },
    ): Promise<{ applied: boolean }> {
      return withOrgLock(organizationId, async () => {
        const current = await deps.store.getAppointment(
          organizationId,
          appointmentId,
        );
        if (!current || current.status !== "confirmed") {
          return { applied: false };
        }
        const rules = await ensure(organizationId);
        if (change.kind === "canceled") {
          current.status = "canceled";
          current.cancelReason = "provider_canceled";
          current.updatedAt = deps.now().toISOString();
          await deps.store.saveAppointment(current);
          await record(current, "provider_canceled");
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
            ...noticeDetails(current, rules.timezone),
          });
          return { applied: true };
        }
        const start = new Date(change.startAt);
        if (Number.isNaN(start.getTime())) return { applied: false };
        const unchanged =
          start.toISOString() === current.startAt &&
          change.eventId === current.calendarEventId;
        if (unchanged) return { applied: false };
        const timeChanged = start.toISOString() !== current.startAt;
        const previousStart = current.startAt;
        const duration =
          Date.parse(current.endAt) - Date.parse(current.startAt);
        current.startAt = start.toISOString();
        current.endAt = new Date(start.getTime() + duration).toISOString();
        current.calendarEventId = change.eventId;
        current.updatedAt = deps.now().toISOString();
        await deps.store.saveAppointment(current);
        if (!timeChanged) {
          await record(current, "provider_relinked", change.eventId);
          return { applied: true };
        }
        await record(
          current,
          "provider_rescheduled",
          `${previousStart}->${current.startAt}`,
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
        if (current.customerPhoneE164) {
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
        return { applied: true };
      });
    },
  };
}

export type SchedulingService = ReturnType<typeof createSchedulingService>;
