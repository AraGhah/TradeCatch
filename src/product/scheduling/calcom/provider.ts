/**
 * Cal.com as a TradeCatch calendar provider (a `CalendarPort`).
 *
 * The rules this port enforces for the booking engine:
 *
 *  - Cal.com owns availability. `openSlots` lists only what Cal.com says is
 *    free, per mapped event type (one event type per specialist calendar).
 *  - A booking is real only when Cal.com answers 2xx with an `accepted`
 *    booking at the requested time. A `pending` booking (the event type wants
 *    host approval), a different time, or an unreadable answer is never a
 *    confirmation.
 *  - A failure says what it proves. Refused (4xx) means nothing was created;
 *    a timeout or 5xx means unknown, which the engine keeps as a hold and
 *    reconciles instead of retrying or reporting.
 *
 * Event ids stored on appointments are `calcom:<uid>`, so the provider that
 * owns an id is never in doubt.
 */

import type {
  CalendarFailure,
  CalendarPort,
  ProviderEvent,
} from "../service";
import {
  createCalcomClient,
  type CalcomClient,
  type CalcomFailure,
} from "./client";
import type { CalcomEventTypeMapping, StoredCalcomConnection } from "./types";

const PREFIX = "calcom:";

export const calcomEventId = (uid: string) => `${PREFIX}${uid}`;
export const calcomUid = (eventId: string): string | null =>
  eventId.startsWith(PREFIX) && eventId.length > PREFIX.length
    ? eventId.slice(PREFIX.length)
    : null;

/**
 * The event types that can serve a request.
 *
 * A service with its own mapping uses only those; otherwise the mappings that
 * name no service (the business's default) are used. A requested specialist
 * narrows to that specialist's event type. Nothing matching means nothing is
 * offered or booked: there is no guessing which calendar to use.
 */
export function candidateEventTypes(
  mappings: CalcomEventTypeMapping[],
  serviceId?: string,
  technicianId?: string,
): CalcomEventTypeMapping[] {
  const forService = serviceId
    ? mappings.filter((m) => m.serviceId === serviceId)
    : [];
  const pool = forService.length > 0 ? forService : mappings.filter((m) => !m.serviceId);
  return technicianId ? pool.filter((m) => m.technicianId === technicianId) : pool;
}

function failure(result: CalcomFailure): CalendarFailure {
  switch (result.kind) {
    case "unknown":
      return { error: "calendar_unknown", unknown: true };
    case "slot_unavailable":
      return { error: "slot_unavailable", slotUnavailable: true };
    default:
      return { error: `calcom_${result.kind}` };
  }
}

export type CalcomPortInput = {
  connection: StoredCalcomConnection;
  client: CalcomClient;
  /** Called when Cal.com refuses the key, so the connection stops being used. */
  onAuthFailure?: () => Promise<void>;
};

export function createCalcomPort(input: CalcomPortInput): CalendarPort {
  const { connection, client } = input;
  let calls = 0;
  const port: CalendarPort = {
    kind: "calcom",
    connected: connection.status === "connected",
    get externalCalls() {
      return calls;
    },
    // Availability comes from Cal.com's own slot list, not a busy mirror.
    async freeBusy() {
      return [];
    },

    async openSlots(query) {
      const candidates = candidateEventTypes(
        connection.eventTypes,
        query.serviceId,
        query.technicianId,
      ).slice(0, 8);
      if (candidates.length === 0) return { error: "no_event_type" };
      calls += candidates.length;
      const results = await Promise.all(
        candidates.map(async (mapping) => ({
          mapping,
          result: await client.slots({
            eventTypeId: mapping.eventTypeId,
            from: query.from,
            until: query.until,
            timeZone: query.timeZone,
            lengthInMinutes: mapping.lengthInMinutes,
          }),
        })),
      );
      const slots: {
        startAt: string;
        endAt: string;
        technicianId?: string;
      }[] = [];
      let answered = 0;
      for (const { mapping, result } of results) {
        if (!result.ok) {
          if (result.kind === "auth") await input.onAuthFailure?.();
          continue;
        }
        answered += 1;
        for (const slot of result.data) {
          slots.push({ ...slot, technicianId: mapping.technicianId });
        }
      }
      // A calendar that could not be asked contributes nothing; if none could,
      // the caller is told nothing can be offered.
      if (answered === 0) return { error: "calcom_unreachable" };
      return { slots };
    },

    async createEvent(appointment, options) {
      const mapping = candidateEventTypes(
        connection.eventTypes,
        appointment.serviceId,
        appointment.technicianId,
      )[0];
      if (!mapping) return { error: "no_event_type" };
      const timeoutMs = options?.deadlineAt
        ? Math.max(1_500, Math.min(5_000, options.deadlineAt - Date.now() - 300))
        : undefined;
      calls += 1;
      const metadata: Record<string, string> = {
        tc_appointment_id: appointment.id,
        tc_source: appointment.bookingSource.slice(0, 100),
        tc_service: appointment.serviceName.slice(0, 200),
      };
      if (appointment.serviceAddress) {
        metadata.tc_address = appointment.serviceAddress.slice(0, 450);
      }
      const result = await client.createBooking(
        {
          eventTypeId: mapping.eventTypeId,
          startAt: appointment.startAt,
          lengthInMinutes: mapping.lengthInMinutes,
          attendee: {
            name: appointment.customerName?.trim() || "Phone caller",
            email:
              appointment.customerEmail || connection.fallbackAttendeeEmail,
            phoneNumber: appointment.customerPhoneE164,
            timeZone: appointment.timezone,
            language: connection.language,
          },
          metadata,
          addressAsLocation:
            mapping.addressAsLocation && appointment.serviceAddress
              ? appointment.serviceAddress
              : undefined,
        },
        { timeoutMs },
      );
      if (!result.ok) {
        if (result.kind === "auth") await input.onAuthFailure?.();
        return failure(result);
      }
      const booking = result.data;
      const wanted = new Date(appointment.startAt).toISOString();
      if (booking.status !== "accepted" || booking.startAt !== wanted) {
        // Not a confirmed booking at the time we asked for. It exists in
        // Cal.com, so undo it rather than leave something nobody tracks.
        const undone = await client.cancel(
          booking.uid,
          "Not confirmed by TradeCatch",
        );
        if (!undone.ok) {
          // We could not undo it: reconcile will find and cancel it.
          return { error: "calcom_unconfirmed", unknown: true };
        }
        return {
          error:
            booking.status === "accepted"
              ? "calcom_time_mismatch"
              : "calcom_requires_confirmation",
        };
      }
      return { id: calcomEventId(booking.uid) };
    },

    async updateEvent(eventId, appointment) {
      const uid = calcomUid(eventId);
      if (!uid) return { error: "calcom_not_a_calcom_event" };
      calls += 1;
      const result = await client.reschedule(
        uid,
        appointment.startAt,
        "Moved by the caller",
      );
      if (!result.ok) {
        if (result.kind === "auth") await input.onAuthFailure?.();
        return failure(result);
      }
      const booking = result.data;
      if (
        booking.status !== "accepted" ||
        booking.startAt !== new Date(appointment.startAt).toISOString()
      ) {
        // Moved, but not into a state we can call confirmed: let reconcile read it.
        return { error: "calcom_unconfirmed", unknown: true };
      }
      // Cal.com issues a new booking uid for the new time.
      return { ok: true, id: calcomEventId(booking.uid) };
    },

    async deleteEvent(eventId) {
      const uid = calcomUid(eventId);
      // Not ours (an appointment from before the switch to Cal.com): nothing
      // to cancel here, and it must not block canceling the appointment.
      if (!uid) return { ok: true };
      calls += 1;
      const result = await client.cancel(uid, "Canceled in TradeCatch");
      if (!result.ok) {
        if (result.kind === "auth") await input.onAuthFailure?.();
        return failure(result);
      }
      return { ok: true };
    },

    async listEvents(query) {
      const ids = [
        ...new Set(connection.eventTypes.map((m) => m.eventTypeId)),
      ];
      if (ids.length === 0) return { error: "no_event_type" };
      calls += 1;
      const listed = await client.listBookings({
        eventTypeIds: ids,
        afterStart: query.from,
        beforeEnd: query.until,
      });
      if (!listed.ok) {
        if (listed.kind === "auth") await input.onAuthFailure?.();
        return { error: `calcom_${listed.kind}` };
      }
      const events: ProviderEvent[] = listed.data.map((booking) => ({
        id: calcomEventId(booking.uid),
        state:
          booking.status === "cancelled" || booking.status === "rejected"
            ? "canceled"
            : "live",
        startAt: booking.startAt,
        endAt: booking.endAt,
        appointmentId: booking.tradecatchId,
        replacesId: booking.rescheduledFromUid
          ? calcomEventId(booking.rescheduledFromUid)
          : undefined,
      }));
      return { events };
    },
  };
  return port;
}

export { createCalcomClient };
