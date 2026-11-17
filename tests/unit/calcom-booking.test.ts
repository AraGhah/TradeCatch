import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calcomEventId } from "../../src/product/scheduling/calcom/types";
import {
  createSchedulingService,
  createSimulatedCalendar,
  type CalendarPort,
} from "../../src/product/scheduling/service";
import { createMemorySchedulingStore } from "../../src/product/scheduling/store";
import {
  CALCOM_KEY,
  MONDAY_10,
  MONDAY_11,
  NOW,
  ORG,
  TZ,
  bookInput,
  createHarness,
} from "./helpers/calcom-sim";

const DAY_FROM = "2026-10-19T11:00:00.000Z";
const DAY_UNTIL = "2026-10-19T23:30:00.000Z";

async function confirmedAppointment(h: Awaited<ReturnType<typeof createHarness>>, startAt = MONDAY_10) {
  const booked = await h.service.book(bookInput({ startAt, idempotencyKey: `key-${startAt}` }));
  assert.equal(booked.confirmed, true);
  return booked.appointment!;
}

describe("availability comes from Cal.com, with TradeCatch's rules on top", () => {
  it("offers only times that both Cal.com and the business's own hours allow", async () => {
    const h = await createHarness();
    const { slots } = await h.service.availability({ organizationId: ORG, from: DAY_FROM, until: DAY_UNTIL });
    const starts = slots.map((s) => s.startAt);
    assert.ok(starts.includes(MONDAY_10));
    assert.ok(!starts.includes("2026-10-19T22:00:00.000Z"), "18:00 is offered by Cal.com but is after the business closes");
    for (const start of starts) assert.ok(h.sim.offered.has(start), `${start} is not offered by Cal.com`);

    const sunday = await h.service.availability({
      organizationId: ORG,
      from: "2026-10-18T12:00:00.000Z",
      until: "2026-10-18T23:00:00.000Z",
    });
    assert.deepEqual(sunday.slots, [], "Cal.com offers a Sunday time but the business is closed");
  });

  it("asks Cal.com in the business timezone, with the event type and a bounded window", async () => {
    const h = await createHarness();
    await h.service.availability({ organizationId: ORG, from: DAY_FROM, until: DAY_UNTIL });
    const query = h.sim.requests.find((r) => r.path === "/v2/slots")!.query;
    assert.equal(query.timeZone, TZ);
    assert.equal(query.eventTypeId, "11");
    assert.equal(query.start, DAY_FROM);
    assert.equal(query.end, DAY_UNTIL);
    assert.ok(h.sim.requests.every((r) => !r.url.includes(CALCOM_KEY)), "the key is never in a URL");
    assert.ok(h.sim.requests.every((r) => r.headers.Authorization === `Bearer ${CALCOM_KEY}`));
  });

  it("keeps the exact instant across a daylight-saving change", async () => {
    const h = await createHarness({
      sim: { offered: ["2026-10-30T14:00:00.000Z", "2026-11-02T15:00:00.000Z"] },
    });
    const winter = await h.port().listSlots!({
      from: new Date("2026-11-02T12:00:00.000Z"),
      until: new Date("2026-11-02T23:00:00.000Z"),
      timeZone: TZ,
    });
    // Cal.com answered "10:00-05:00"; the instant is 15:00Z, not 14:00Z.
    assert.deepEqual(winter, { ok: true, starts: ["2026-11-02T15:00:00.000Z"] });
    const summer = await h.port().listSlots!({
      from: new Date("2026-10-30T12:00:00.000Z"),
      until: new Date("2026-10-30T23:00:00.000Z"),
      timeZone: TZ,
    });
    assert.deepEqual(summer, { ok: true, starts: ["2026-10-30T14:00:00.000Z"] });
  });

  it("applies TradeCatch's own appointments even if Cal.com still offers the time", async () => {
    const h = await createHarness({ sim: { blocksOnBooking: false } });
    await confirmedAppointment(h);
    const { slots } = await h.service.availability({ organizationId: ORG, from: DAY_FROM, until: DAY_UNTIL });
    const starts = slots.map((s) => s.startAt);
    assert.ok(!starts.includes(MONDAY_10), "the booked time is gone");
    assert.ok(!starts.includes("2026-10-19T14:30:00.000Z"), "so is the half hour that overlaps it");
  });

  it("offers nothing and says so when Cal.com cannot be reached", async () => {
    const h = await createHarness();
    h.sim.slotsDown = true;
    await assert.rejects(
      h.service.availability({ organizationId: ORG, from: DAY_FROM, until: DAY_UNTIL }),
      (error: { code?: string; status?: number }) =>
        error.code === "calendar_unavailable" && error.status === 503,
    );
  });

  it("offers nothing when the business is on Cal.com but no Cal.com connection can be used", async () => {
    const store = createMemorySchedulingStore();
    const service = createSchedulingService({
      store,
      now: () => NOW,
      calendar: async () => createSimulatedCalendar(),
    });
    await service.setCalendarMode(ORG, "calcom");
    const { slots } = await service.availability({ organizationId: ORG, from: DAY_FROM, until: DAY_UNTIL });
    assert.deepEqual(slots, [], "the simulated calendar is never substituted");
    assert.equal(await service.calendarReady(ORG), false);
  });
});

describe("a booking is confirmed only after Cal.com accepts it", () => {
  it("confirms an accepted booking and links it to the Cal.com booking", async () => {
    const h = await createHarness();
    const appointment = await confirmedAppointment(h);
    assert.equal(appointment.status, "confirmed");
    assert.match(appointment.calendarEventId ?? "", /^calcom:simbk\d+x11$/);
    assert.equal(appointment.simulated, false);

    const [booking] = h.sim.active();
    assert.equal(booking!.start, MONDAY_10);
    assert.equal(booking!.metadata.tcAppointmentId, appointment.id);
    assert.equal(booking!.metadata.tcOrgId, ORG);
    assert.equal(booking!.attendee?.name, "Marie Tremblay");
    assert.equal(booking!.attendee?.timeZone, TZ);
    assert.equal(booking!.attendee?.phoneNumber, "+15145559876");

    const row = await h.store.getCalcomBooking(ORG, appointment.id);
    assert.equal(row?.state, "confirmed");
    assert.equal(calcomEventId(row!.providerUid!), appointment.calendarEventId);
  });

  it("books once when the same request is repeated", async () => {
    const h = await createHarness();
    const first = await h.service.book(bookInput());
    const again = await h.service.book(bookInput());
    assert.equal(first.confirmed, true);
    assert.equal(again.appointment?.id, first.appointment?.id);
    assert.equal(h.sim.count("POST", /^\/v2\/bookings$/), 1, "Cal.com was asked once");
    assert.equal(h.sim.active().length, 1);
  });

  it("does not double-book a time that two callers ask for at once", async () => {
    const h = await createHarness({ sim: { blocksOnBooking: false } });
    const [a, b] = await Promise.all([
      h.service.book(bookInput({ idempotencyKey: "call-a", customerName: "Alice" })),
      h.service.book(bookInput({ idempotencyKey: "call-b", customerName: "Bob", requestIfUnavailable: false })),
    ]);
    assert.deepEqual([a.confirmed, b.confirmed].sort(), [false, true]);
    assert.equal(h.sim.active().length, 1, "one booking in Cal.com");
    const confirmed = (await h.store.listAppointments(ORG)).filter((row) => row.status === "confirmed");
    assert.equal(confirmed.length, 1, "one confirmed appointment in TradeCatch");
  });

  it("refuses a booking Cal.com leaves waiting for the host, and takes it back", async () => {
    const h = await createHarness();
    h.sim.createBehaviours.push("pending");
    const result = await h.service.book(bookInput());
    assert.equal(result.confirmed, false);
    assert.equal(result.reason, "calendar_error");
    assert.equal(result.appointment?.appointmentKind, "request");
    assert.notEqual(result.appointment?.status, "confirmed");
    assert.equal(h.sim.active().length, 0, "the unconfirmed booking was cancelled in Cal.com");
    const row = (await h.store.listCalcomBookings(ORG, ["canceled"], 10))[0];
    assert.equal(row?.errorCode, "requires_confirmation");
    const all = await h.store.listAppointments(ORG);
    assert.equal(all.filter((a) => a.status === "confirmed").length, 0);
  });

  it("refuses a booking Cal.com accepts at another time", async () => {
    const h = await createHarness();
    h.sim.createBehaviours.push("start_shifted");
    const result = await h.service.book(bookInput());
    assert.equal(result.confirmed, false);
    assert.equal(h.sim.active().length, 0);
    const row = (await h.store.listCalcomBookings(ORG, ["canceled"], 10))[0];
    assert.equal(row?.errorCode, "start_mismatch");
  });

  it("leaves a request when the time was taken between the check and the booking", async () => {
    const h = await createHarness();
    h.sim.createBehaviours.push("slot_taken");
    const result = await h.service.book(bookInput());
    assert.equal(result.confirmed, false);
    assert.equal(result.reason, "calendar_error");
    assert.equal(result.appointment?.appointmentKind, "request");
    assert.equal(h.sim.active().length, 0);
  });

  it("gives a phone caller a plain conflict instead of a request when the time was just taken", async () => {
    const h = await createHarness();
    h.sim.createBehaviours.push("slot_taken");
    const result = await h.service.book(bookInput({ requestIfUnavailable: false }));
    assert.equal(result.confirmed, false);
    assert.equal(result.reason, "conflict");
    assert.equal(result.appointment, undefined);
    assert.equal((await h.store.listAppointments(ORG)).filter((a) => a.appointmentKind === "request" && a.status === "pending").length, 0);
  });

  it("never confirms when Cal.com answers with an error", async () => {
    const h = await createHarness();
    h.sim.createBehaviours.push("server_error");
    const result = await h.service.book(bookInput());
    assert.equal(result.confirmed, false);
    assert.equal((await h.store.listAppointments(ORG)).filter((a) => a.status === "confirmed").length, 0);
    const [row] = await h.store.listCalcomBookings(ORG, ["creating"], 10);
    assert.ok(row, "the attempt is on the ledger, waiting to be settled");
    assert.equal(row!.errorCode, "server_error");
  });

  it("never confirms when the request is lost on the way", async () => {
    const h = await createHarness();
    h.sim.createBehaviours.push("lost");
    const result = await h.service.book(bookInput());
    assert.equal(result.confirmed, false);
    assert.equal(h.sim.active().length, 0);
  });

  it("records a request, without asking Cal.com to book, when Cal.com cannot be reached for the check", async () => {
    const h = await createHarness();
    h.sim.slotsDown = true;
    const result = await h.service.book(bookInput());
    assert.equal(result.confirmed, false);
    assert.equal(result.reason, "calendar_unavailable");
    assert.equal(result.appointment?.appointmentKind, "request");
    assert.equal(h.sim.count("POST", /^\/v2\/bookings$/), 0);
    assert.ok(h.notified.some((n) => n.kind === "requested"), "the owner is told it is a request");
  });

  it("never substitutes a simulated appointment when no Cal.com connection can be used", async () => {
    const store = createMemorySchedulingStore();
    const calendars: CalendarPort[] = [];
    const service = createSchedulingService({
      store,
      now: () => NOW,
      calendar: async () => {
        const calendar = createSimulatedCalendar();
        calendars.push(calendar);
        return calendar;
      },
    });
    await service.setCalendarMode(ORG, "calcom");
    const result = await service.book(bookInput());
    assert.equal(result.confirmed, false);
    assert.equal(result.reason, "calendar_unavailable");
    assert.equal(result.appointment?.simulated, false);
    assert.equal(result.appointment?.appointmentKind, "request");
    assert.equal((await store.listAppointments(ORG)).filter((a) => a.status === "confirmed").length, 0);
    assert.ok(calendars.every((calendar) => calendar.externalCalls === 0));
  });

  it("an explicit practice booking is the only simulated one", async () => {
    const h = await createHarness();
    const practice = await h.service.book(bookInput({ simulated: true, source: "simulation", idempotencyKey: "practice" }));
    assert.equal(practice.confirmed, true);
    assert.equal(practice.appointment?.simulated, true);
    assert.equal(h.sim.count("POST", /^\/v2\/bookings$/), 0, "a practice booking never reaches Cal.com");
  });
});

describe("a lost answer is settled, not repeated", () => {
  it("finds the booking Cal.com made and keeps it from becoming a second one", async () => {
    const h = await createHarness();
    h.sim.createBehaviours.push("applied_then_lost");
    const result = await h.service.book(bookInput());
    assert.equal(result.confirmed, false);
    assert.equal(h.sim.active().length, 1, "Cal.com did make the booking");

    // The same appointment is attempted again: it adopts the booking.
    const held = (await h.store.listAppointments(ORG)).find((a) => a.cancelReason === "calendar_sync_failed")!;
    const created = await h.port().createEvent({ ...held, status: "hold" });
    assert.ok("id" in created, JSON.stringify(created));
    assert.equal(h.sim.active().length, 1, "still one booking");
    assert.equal(h.sim.count("POST", /^\/v2\/bookings$/), 1);
  });

  it("cancels the booking nobody confirmed when reconciliation runs", async () => {
    const h = await createHarness();
    const { reconcileCalcomOrganization } = await import("../../src/product/scheduling/calcom/reconcile");
    await h.store.saveCalcomConnection({
      organizationId: ORG,
      status: "connected",
      credentialKind: "api_key",
      defaultEventTypeId: 11,
      routes: [],
      updatedAt: NOW.toISOString(),
    });
    h.sim.createBehaviours.push("applied_then_lost");
    const result = await h.service.book(bookInput());
    assert.equal(result.confirmed, false);
    assert.equal(h.sim.active().length, 1);

    const deps = {
      store: h.store,
      scheduling: h.service,
      portFor: async () => h.port(),
      checkKey: async () => "ok" as const,
      now: () => h.clock.now,
    };
    // Too early: the request may still be on its way back.
    h.advance(30_000);
    await reconcileCalcomOrganization(deps, ORG);
    assert.equal(h.sim.active().length, 1);

    h.advance(60_000);
    const totals = await reconcileCalcomOrganization(deps, ORG);
    assert.equal(totals.orphansCanceled, 1);
    assert.equal(h.sim.active().length, 0, "the contractor's calendar is free again");
    const [row] = await h.store.listCalcomBookings(ORG, ["orphan_canceled"], 10);
    assert.ok(row);
  });

  it("marks an attempt that Cal.com never saw as gone after the settle window, without booking anything", async () => {
    const h = await createHarness();
    const { reconcileCalcomOrganization } = await import("../../src/product/scheduling/calcom/reconcile");
    await h.store.saveCalcomConnection({
      organizationId: ORG,
      status: "connected",
      credentialKind: "api_key",
      defaultEventTypeId: 11,
      routes: [],
      updatedAt: NOW.toISOString(),
    });
    h.sim.createBehaviours.push("server_error");
    await h.service.book(bookInput());
    const deps = {
      store: h.store,
      scheduling: h.service,
      portFor: async () => h.port(),
      checkKey: async () => "ok" as const,
      now: () => h.clock.now,
    };
    h.advance(2 * 60_000);
    await reconcileCalcomOrganization(deps, ORG);
    assert.equal((await h.store.listCalcomBookings(ORG, ["creating"], 10)).length, 1, "still waiting");
    h.advance(5 * 60_000);
    const totals = await reconcileCalcomOrganization(deps, ORG);
    assert.equal(totals.settled, 1);
    assert.equal((await h.store.listCalcomBookings(ORG, ["creating"], 10)).length, 0);
    assert.equal((await h.store.listCalcomBookings(ORG, ["failed"], 10)).length, 1);
    assert.equal(h.sim.active().length, 0);
  });
});

describe("moving and cancelling go through Cal.com", () => {
  it("moves a booking and keeps the new Cal.com id", async () => {
    const h = await createHarness();
    const appointment = await confirmedAppointment(h);
    const oldId = appointment.calendarEventId!;
    const moved = await h.service.reschedule(ORG, appointment.id, MONDAY_11);
    assert.equal(moved.ok, true);
    assert.equal(moved.appointment?.startAt, MONDAY_11);
    assert.notEqual(moved.appointment?.calendarEventId, oldId, "Cal.com gave the moved booking a new id");
    assert.match(moved.appointment?.calendarEventId ?? "", /^calcom:/);

    const active = h.sim.active();
    assert.equal(active.length, 1);
    assert.equal(active[0]!.start, MONDAY_11);
    assert.equal(h.sim.list().find((b) => `calcom:${b.uid}` === oldId)?.status, "cancelled");
    const slotQuery = h.sim.requests.filter((r) => r.path === "/v2/slots").at(-1)!.query;
    assert.equal(slotQuery.bookingUidToReschedule, oldId.slice("calcom:".length), "its own time is not counted as busy");
    assert.ok(h.hints.includes(oldId), "the change was routed by the booking's own provider");
  });

  it("keeps the old time when Cal.com holds the move for the host", async () => {
    const h = await createHarness();
    const appointment = await confirmedAppointment(h);
    h.sim.rescheduleBehaviour = "pending";
    const moved = await h.service.reschedule(ORG, appointment.id, MONDAY_11);
    assert.equal(moved.ok, false);
    assert.equal(moved.reason, "calendar_error");
    const stored = await h.store.getAppointment(ORG, appointment.id);
    assert.equal(stored?.startAt, MONDAY_10, "TradeCatch does not announce a time Cal.com has not accepted");
    const [row] = await h.store.listCalcomBookings(ORG, ["unresolved"], 10);
    assert.equal(row?.errorCode, "reschedule_not_accepted");
  });

  it("refuses to move to a time Cal.com does not offer", async () => {
    const h = await createHarness();
    const appointment = await confirmedAppointment(h);
    const moved = await h.service.reschedule(ORG, appointment.id, "2026-10-19T23:00:00.000Z");
    assert.equal(moved.ok, false);
    assert.equal((await h.store.getAppointment(ORG, appointment.id))?.startAt, MONDAY_10);
    assert.equal(h.sim.count("POST", /reschedule$/), 0);
  });

  it("cancels the booking in Cal.com and only then in TradeCatch", async () => {
    const h = await createHarness();
    const appointment = await confirmedAppointment(h);
    const result = await h.service.cancel(ORG, appointment.id, "caller_request");
    assert.equal(result.ok, true);
    assert.equal(h.sim.active().length, 0);
    assert.equal((await h.store.getAppointment(ORG, appointment.id))?.status, "canceled");
    const calls = h.sim.requests.length;
    const again = await h.service.cancel(ORG, appointment.id);
    assert.equal(again.ok, true);
    assert.equal(h.sim.requests.length, calls, "cancelling twice does nothing more");
  });

  it("treats a booking Cal.com already cancelled as cancelled", async () => {
    const h = await createHarness();
    const appointment = await confirmedAppointment(h);
    h.sim.externalCancel(appointment.calendarEventId!.slice("calcom:".length));
    const result = await h.service.cancel(ORG, appointment.id);
    assert.equal(result.ok, true);
    assert.equal((await h.store.getAppointment(ORG, appointment.id))?.status, "canceled");
  });

  it("does not say it cancelled when Cal.com cannot be reached", async () => {
    const h = await createHarness();
    const appointment = await confirmedAppointment(h);
    h.sim.unreachable = true;
    const result = await h.service.cancel(ORG, appointment.id);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "calendar_error");
    assert.equal((await h.store.getAppointment(ORG, appointment.id))?.status, "confirmed");
  });

  it("follows a booking the contractor already moved in Cal.com and cancels the live one", async () => {
    const h = await createHarness();
    const appointment = await confirmedAppointment(h);
    const uid = appointment.calendarEventId!.slice("calcom:".length);
    const moved = h.sim.externalMove(uid, MONDAY_11);
    const result = await h.service.cancel(ORG, appointment.id);
    assert.equal(result.ok, true);
    assert.equal(h.sim.bookings.get(moved.uid)?.status, "cancelled", "the moved booking, not just the old uid");
    assert.equal(h.sim.active().length, 0);
  });
});
