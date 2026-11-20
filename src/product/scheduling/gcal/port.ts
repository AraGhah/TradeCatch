import type { CalendarPort } from "../service";
import type { SchedulingStore } from "../store";
import type { ScheduleAppointment } from "../types";
import type { OpenGoogleFn } from "./open";
import type { GoogleSync } from "./sync";

/** The longest a booking waits for Google before leaving the change queued. */
const INLINE_BUDGET_MS = 3000;

/**
 * The calendar the booking flow sees for a business on Google.
 *
 * Reads never leave TradeCatch: free time comes from the mirror the sync keeps
 * (so a slow or failing Google never slows the phone line, and the owner's
 * event titles are never needed). Writes are recorded first, durably, and then
 * sent once with a short budget. When Google is slow or down the booking still
 * succeeds and the change is retried with backoff until it lands or is shown to
 * the owner as failed: a calendar problem can neither fail a booking nor lose
 * a change.
 */
export function createGoogleSyncPort(input: {
  organizationId: string;
  store: SchedulingStore;
  sync: GoogleSync;
  /**
   * False while the token is refused or the plan no longer includes the
   * calendar. Changes are still recorded (they go out after reconnecting), but
   * nothing is sent now and no new time is vouched for.
   */
  connected?: boolean;
}): CalendarPort {
  const { organizationId, store, sync } = input;
  const live = input.connected ?? true;

  async function sendNow(appointment: ScheduleAppointment) {
    if (!live) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        sync.push({
          organizationId,
          appointmentId: appointment.id,
          limit: 1,
          timeoutMs: INLINE_BUDGET_MS,
          appointment,
        }),
        new Promise((resolve) => {
          timer = setTimeout(resolve, INLINE_BUDGET_MS + 500);
        }),
      ]);
    } catch {
      // The change is already queued; the periodic pass sends it.
    } finally {
      clearTimeout(timer);
    }
  }

  async function appointmentForEvent(eventId: string) {
    const connection = await store.getConnection(organizationId);
    if (connection?.calendarId) {
      const link = await store.findEventLinkByEventId(
        organizationId,
        connection.calendarId,
        eventId,
      );
      if (link) return { id: link.appointmentId, calendarEventId: eventId, simulated: false };
    }
    // Appointments booked before sync existed know only the event id.
    const found = (await store.listAppointments(organizationId)).find(
      (row) => row.calendarEventId === eventId,
    );
    return found
      ? { id: found.id, calendarEventId: eventId, simulated: found.simulated }
      : null;
  }

  return {
    kind: "google",
    connected: live,
    externalCalls: 0,

    async freeBusy(fromIso, untilIso) {
      const state = await store.getSyncState(organizationId);
      // A calendar that has never been read is not a free calendar.
      if (!state?.syncToken) throw new Error("Calendar availability is unknown");
      const from = Date.parse(fromIso);
      const until = Date.parse(untilIso);
      return (await store.listBusy(organizationId)).filter(
        (block) => Date.parse(block.endAt) > from && Date.parse(block.startAt) < until,
      );
    },

    async prepare() {
      if (!live) return { ok: false, stale: true };
      return sync.prepare(organizationId);
    },

    async createEvent(appointment) {
      const link = await sync.enqueue(organizationId, appointment, "create");
      if (!link?.eventId) return { error: "calendar_unavailable" };
      await sendNow({ ...appointment, status: "confirmed" });
      return { id: link.eventId };
    },

    async updateEvent(eventId, appointment) {
      const link = await sync.enqueue(organizationId, appointment, "update");
      if (!link) return { error: "calendar_unavailable" };
      await sendNow({ ...appointment, status: "confirmed" });
      return { ok: true as const, eventId: link.eventId ?? eventId };
    },

    async deleteEvent(eventId) {
      const target = await appointmentForEvent(eventId);
      // Nothing of ours is known for this event: there is nothing to remove.
      if (!target) return { ok: true as const };
      const link = await sync.enqueue(organizationId, target, "delete");
      if (link) {
        const stored = await store.getAppointment(organizationId, target.id);
        if (stored) await sendNow(stored);
      }
      return { ok: true as const };
    },
  };
}

/**
 * The calendar for a business that uses Google. With a token Google refused, or
 * a plan that no longer includes the calendar, the port is not "connected": no
 * new booking is confirmed, but moving or canceling an existing one is still
 * recorded and reaches Google as soon as the owner reconnects. The runtime and
 * the tests both build it here, so they cannot drift apart.
 */
export async function googlePortFor(input: {
  organizationId: string;
  store: SchedulingStore;
  sync: GoogleSync;
  open: OpenGoogleFn;
}): Promise<CalendarPort> {
  const opened = await input.open(input.organizationId);
  return createGoogleSyncPort({
    organizationId: input.organizationId,
    store: input.store,
    sync: input.sync,
    connected: opened.ok,
  });
}

/**
 * A business that has left Google (or never used it) but still holds
 * appointments whose event lived there. TradeCatch no longer manages that
 * event, so moving or canceling the appointment must still work and must not
 * try to reach Google.
 */
export const detachedCalendarPort: CalendarPort = {
  kind: "simulated",
  connected: true,
  externalCalls: 0,
  async freeBusy() {
    return [];
  },
  async createEvent(appointment) {
    return { id: `simcal_${appointment.id}` };
  },
  async updateEvent() {
    return { ok: true };
  },
  async deleteEvent() {
    return { ok: true };
  },
};
