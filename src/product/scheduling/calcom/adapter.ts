import type {
  CalendarPort,
  ProviderSlotQuery,
  ProviderSlotsResult,
} from "../service";
import type { ScheduleAppointment } from "../types";
import {
  cancelBooking,
  createBooking,
  getBooking,
  getSlots,
  listBookings,
  rescheduleBooking,
  type CalcomAuth,
  type CalcomBooking,
  type CalcomFetch,
} from "./client";
import {
  calcomEventId,
  calcomUidFrom,
  type CalcomBookingRecord,
  type CalcomRoute,
} from "./types";

/** How long an unanswered booking request is given to land before it is "gone". */
export const SETTLE_AFTER_MS = 5 * 60_000;

export type CalcomLedger = {
  get(
    organizationId: string,
    appointmentId: string,
  ): Promise<CalcomBookingRecord | null>;
  findByUid(
    organizationId: string,
    uid: string,
  ): Promise<CalcomBookingRecord | null>;
  save(row: CalcomBookingRecord): Promise<void>;
};

export type SettleResult =
  | { state: "confirmed"; uid: string }
  | { state: "gone" }
  | { state: "unknown" };

export type InspectResult =
  | { state: "found"; booking: CalcomBooking }
  | { state: "missing" }
  | { state: "unknown" };

export type CalcomCalendarPort = CalendarPort & {
  kind: "calcom";
  /**
   * Work out what became of a booking request whose outcome was never seen.
   * `adopt` accepts a booking that did succeed (the same appointment is being
   * retried); otherwise a booking nobody confirmed is cancelled.
   */
  settle(
    record: CalcomBookingRecord,
    options: { adopt: boolean },
  ): Promise<SettleResult>;
  /** What Cal.com holds for one booking uid. */
  inspect(uid: string): Promise<InspectResult>;
  /** Cancel a Cal.com booking by uid, following a reschedule to its successor. */
  cancelByUid(uid: string, reason: string): Promise<boolean>;
};

export type CalcomPortDeps = {
  organizationId: string;
  apiKey: string;
  defaultEventTypeId: number;
  routes: CalcomRoute[];
  attendeeEmail?: string;
  /** Specialist calendars are a Receptionist Plus feature. */
  multiCrew: boolean;
  ledger: CalcomLedger;
  now?: () => Date;
  fetchImpl?: CalcomFetch;
  baseUrl?: string;
};

/**
 * Which event type serves a service and a technician. A route that names a
 * technician is ignored when the plan has no specialist calendars.
 */
export function resolveEventType(input: {
  routes: CalcomRoute[];
  defaultEventTypeId: number;
  multiCrew: boolean;
  serviceId?: string;
  technicianId?: string;
}): number {
  const usable = input.multiCrew
    ? input.routes
    : input.routes.filter((route) => !route.technicianId);
  const { serviceId, technicianId } = input;
  const both =
    serviceId && technicianId
      ? usable.find(
          (route) =>
            route.serviceId === serviceId && route.technicianId === technicianId,
        )
      : undefined;
  const tech = technicianId
    ? usable.find(
        (route) => route.technicianId === technicianId && !route.serviceId,
      )
    : undefined;
  const service = serviceId
    ? usable.find(
        (route) => route.serviceId === serviceId && !route.technicianId,
      )
    : undefined;
  return (both ?? tech ?? service)?.eventTypeId ?? input.defaultEventTypeId;
}

function metadataFor(appointment: ScheduleAppointment): Record<string, string> {
  const metadata: Record<string, string> = {
    tcAppointmentId: appointment.id,
    tcOrgId: appointment.organizationId,
    tcSource: "tradecatch",
  };
  if (appointment.serviceName) {
    metadata.tcService = appointment.serviceName.slice(0, 200);
  }
  if (appointment.serviceAddress) {
    metadata.tcAddress = appointment.serviceAddress.slice(0, 400);
  }
  if (appointment.technicianName) {
    metadata.tcTechnician = appointment.technicianName.slice(0, 200);
  }
  return metadata;
}

function failure(result: {
  kind: "rejected" | "ambiguous";
  code: string;
}): string {
  if (result.kind === "ambiguous") return "calendar_unconfirmed";
  return result.code === "slot_unavailable"
    ? "slot_unavailable"
    : "calendar_rejected";
}

export function createCalcomCalendar(deps: CalcomPortDeps): CalcomCalendarPort {
  const clock = deps.now ?? (() => new Date());
  const auth: CalcomAuth = {
    apiKey: deps.apiKey,
    fetchImpl: deps.fetchImpl,
    baseUrl: deps.baseUrl,
  };
  let externalCalls = 0;
  const slotCache = new Map<string, ProviderSlotsResult>();

  const eventTypeFor = (input: {
    serviceId?: string;
    technicianId?: string;
  }) =>
    resolveEventType({
      routes: deps.routes,
      defaultEventTypeId: deps.defaultEventTypeId,
      multiCrew: deps.multiCrew,
      ...input,
    });

  async function mark(
    row: CalcomBookingRecord,
    patch: Partial<CalcomBookingRecord>,
  ) {
    await deps.ledger.save({
      ...row,
      ...patch,
      updatedAt: clock().toISOString(),
    });
  }

  async function cancelByUid(uid: string, reason: string): Promise<boolean> {
    let current = uid;
    for (let hop = 0; hop < 3; hop += 1) {
      externalCalls += 1;
      const cancelled = await cancelBooking(auth, current, reason);
      let booking: CalcomBooking | null = cancelled.ok ? cancelled.data : null;
      if (!booking || booking.status !== "cancelled") {
        // Refused, unreachable, or already cancelled: ask what it is now.
        externalCalls += 1;
        const check = await getBooking(auth, current);
        if (!check.ok) return false;
        booking = check.data;
      }
      if (booking.status === "rejected") return true;
      if (booking.status !== "cancelled") return false;
      // A booking cancelled because it was rescheduled is not the end of
      // the story: the live one is its successor.
      if (!booking.rescheduledToUid) {
        const row = await deps.ledger.findByUid(deps.organizationId, uid);
        if (row && row.state !== "orphan_canceled") {
          await mark(row, { state: "canceled" });
        }
        return true;
      }
      current = booking.rescheduledToUid;
    }
    return false;
  }

  async function settle(
    record: CalcomBookingRecord,
    options: { adopt: boolean },
  ): Promise<SettleResult> {
    externalCalls += 1;
    const list = await listBookings(auth, {
      eventTypeId: record.eventTypeId,
      afterStart: new Date(Date.parse(record.startAt) - 60_000).toISOString(),
    });
    if (!list.ok) return { state: "unknown" };
    const match = list.data.find(
      (booking) =>
        booking.tcAppointmentId === record.appointmentId &&
        booking.tcOrgId === record.organizationId,
    );
    if (!match) {
      const age = clock().getTime() - Date.parse(record.createdAt);
      if (age < SETTLE_AFTER_MS) return { state: "unknown" };
      await mark(record, { state: "failed", errorCode: "not_found" });
      return { state: "gone" };
    }
    if (match.status === "accepted" && options.adopt) {
      await mark(record, {
        state: "confirmed",
        providerUid: match.uid,
        errorCode: undefined,
      });
      return { state: "confirmed", uid: match.uid };
    }
    // Something exists on the contractor's calendar that nobody confirmed.
    const removed = await cancelByUid(
      match.uid,
      "TradeCatch: booking was never confirmed",
    );
    await mark(record, {
      state: removed ? "orphan_canceled" : "unresolved",
      providerUid: match.uid,
      errorCode: removed ? undefined : "orphan_cancel_failed",
    });
    return removed ? { state: "gone" } : { state: "unknown" };
  }

  return {
    kind: "calcom",
    connected: true,
    get externalCalls() {
      return externalCalls;
    },

    // Cal.com owns availability; its own calendars are consulted there.
    async freeBusy() {
      return [];
    },

    async listSlots(query: ProviderSlotQuery): Promise<ProviderSlotsResult> {
      const eventTypeId = eventTypeFor(query);
      const rescheduleUid = calcomUidFrom(query.rescheduleEventId) ?? undefined;
      const key = [
        eventTypeId,
        query.from.toISOString(),
        query.until.toISOString(),
        query.timeZone,
        rescheduleUid ?? "",
      ].join("|");
      const cached = slotCache.get(key);
      if (cached) return cached;
      externalCalls += 1;
      const result = await getSlots(auth, {
        eventTypeId,
        from: query.from,
        until: query.until,
        timeZone: query.timeZone,
        rescheduleUid,
      });
      const mapped: ProviderSlotsResult = result.ok
        ? {
            ok: true,
            starts: result.data.filter(
              (start) =>
                Date.parse(start) >= query.from.getTime() &&
                Date.parse(start) < query.until.getTime(),
            ),
          }
        : { error: "calendar_unavailable" };
      if ("ok" in mapped) slotCache.set(key, mapped);
      return mapped;
    },

    async createEvent(appointment) {
      const eventTypeId = eventTypeFor(appointment);
      const existing = await deps.ledger.get(
        deps.organizationId,
        appointment.id,
      );
      if (existing?.state === "confirmed" && existing.providerUid) {
        return { id: calcomEventId(existing.providerUid) };
      }
      if (
        existing &&
        (existing.state === "creating" || existing.state === "unresolved")
      ) {
        // An earlier request for this same appointment never reported back.
        // Creating again could book it twice.
        const settled = await settle(existing, { adopt: true });
        if (settled.state === "confirmed") {
          return { id: calcomEventId(settled.uid) };
        }
        if (settled.state === "unknown") return { error: "calendar_unconfirmed" };
      }
      const nowIso = clock().toISOString();
      const record: CalcomBookingRecord = {
        organizationId: deps.organizationId,
        appointmentId: appointment.id,
        eventTypeId,
        state: "creating",
        startAt: appointment.startAt,
        attempts: (existing?.attempts ?? 0) + 1,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      // Written before the request: if the answer is lost, this row is what
      // lets reconciliation find and cancel a booking that did go through.
      await deps.ledger.save(record);
      externalCalls += 1;
      const result = await createBooking(auth, {
        eventTypeId,
        startAt: appointment.startAt,
        attendee: {
          name: (appointment.customerName || "TradeCatch caller").slice(0, 100),
          timeZone: appointment.timezone,
          email: appointment.customerEmail || deps.attendeeEmail || undefined,
          phoneNumber: appointment.customerPhoneE164 || undefined,
        },
        metadata: metadataFor(appointment),
      });
      if (!result.ok) {
        await mark(record, {
          state: result.kind === "ambiguous" ? "creating" : "failed",
          errorCode: result.code,
        });
        return { error: failure(result) };
      }
      const booking = result.data;
      const sameStart =
        Date.parse(booking.startAt) === Date.parse(appointment.startAt);
      if (booking.status !== "accepted" || !sameStart) {
        // Pending, rejected or at another time: not the appointment the
        // caller was promised. Take it back and report that it failed.
        const removed = await cancelByUid(
          booking.uid,
          "TradeCatch: booking was not confirmed",
        );
        await mark(record, {
          state: removed ? "canceled" : "unresolved",
          providerUid: booking.uid,
          errorCode:
            booking.status === "accepted"
              ? "start_mismatch"
              : "requires_confirmation",
        });
        return {
          error:
            booking.status === "accepted"
              ? "calendar_start_mismatch"
              : "calendar_requires_confirmation",
        };
      }
      await mark(record, { state: "confirmed", providerUid: booking.uid });
      slotCache.clear();
      return { id: calcomEventId(booking.uid) };
    },

    async updateEvent(eventId, appointment) {
      const uid = calcomUidFrom(eventId);
      if (!uid) return { error: "calendar_error" };
      const row = await deps.ledger.findByUid(deps.organizationId, uid);
      externalCalls += 1;
      const result = await rescheduleBooking(auth, uid, {
        startAt: appointment.startAt,
        reason: "Rescheduled in TradeCatch",
      });
      if (!result.ok) return { error: failure(result) };
      const booking = result.data;
      const sameStart =
        Date.parse(booking.startAt) === Date.parse(appointment.startAt);
      if (booking.status !== "accepted" || !sameStart) {
        if (row) {
          await mark(row, {
            state: "unresolved",
            providerUid: booking.uid,
            errorCode: "reschedule_not_accepted",
          });
        }
        return { error: "calendar_requires_confirmation" };
      }
      if (row) {
        await mark(row, {
          providerUid: booking.uid,
          startAt: booking.startAt,
          errorCode: undefined,
        });
      }
      slotCache.clear();
      // Cal.com gives the moved booking a new uid.
      return { ok: true as const, eventId: calcomEventId(booking.uid) };
    },

    async deleteEvent(eventId) {
      const uid = calcomUidFrom(eventId);
      if (!uid) return { error: "calendar_error" };
      const removed = await cancelByUid(uid, "Canceled in TradeCatch");
      slotCache.clear();
      return removed ? { ok: true as const } : { error: "calendar_error" };
    },

    settle,
    cancelByUid,

    async inspect(uid) {
      externalCalls += 1;
      const result = await getBooking(auth, uid);
      if (result.ok) return { state: "found", booking: result.data };
      if (result.kind === "rejected" && result.code === "not_found") {
        return { state: "missing" };
      }
      return { state: "unknown" };
    },
  };
}
