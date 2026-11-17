import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createCalcomClient } from "../../src/product/scheduling/calcom/client";
import { createCalcomPort } from "../../src/product/scheduling/calcom/provider";
import type { StoredCalcomConnection } from "../../src/product/scheduling/calcom/types";
import {
  createSchedulingService,
  type CalendarPort,
} from "../../src/product/scheduling/service";
import { createMemorySchedulingStore } from "../../src/product/scheduling/store";
import { createFakeCalcom } from "./support/fake-calcom";

const ORG = "org_calcom";
const NOW = new Date("2026-11-16T12:00:00Z");
const SLOT_A = "2026-11-18T15:00:00.000Z";
const SLOT_B = "2026-11-18T17:00:00.000Z";
const SLOT_C = "2026-11-19T15:00:00.000Z";

const caller = {
  customerName: "Jean Tremblay",
  customerPhoneE164: "+15145559876",
  serviceAddress: "123 Rue Principale, Laval, QC H7N 1A1",
};

async function setup(options: { connected?: boolean; now?: () => Date } = {}) {
  const store = createMemorySchedulingStore();
  const fake = createFakeCalcom({ slots: [SLOT_A, SLOT_B, SLOT_C] });
  const connection: StoredCalcomConnection = {
    organizationId: ORG,
    status: options.connected === false ? "disconnected" : "connected",
    eventTypes: [{ eventTypeId: 11 }],
    fallbackAttendeeEmail: "owner@example.com",
    language: "en",
    updatedAt: NOW.toISOString(),
  };
  const port: CalendarPort = createCalcomPort({
    connection,
    client: createCalcomClient({
      apiKey: "cal_test_0123456789abcdef",
      fetchImpl: fake.fetch,
      env: {},
    }),
  });
  const scheduled: { appointmentId: string; startAt: string }[] = [];
  const notified: { kind: string; refId: string }[] = [];
  const cancelled: { appointmentId: string; reason: string }[] = [];
  const service = createSchedulingService({
    store,
    now: options.now ?? (() => NOW),
    calendar: async () => port,
    async scheduleNotices(input) {
      scheduled.push({ appointmentId: input.appointmentId, startAt: input.startAt });
    },
    async cancelNotices(_org, appointmentId, reason) {
      cancelled.push({ appointmentId, reason });
    },
    async notify(input) {
      notified.push({ kind: input.kind, refId: input.refId });
    },
  });
  const rules = await service.ensure(ORG);
  rules.calendarMode = "calcom";
  await store.saveRules(rules);
  const book = (startAt: string, key: string, extra: Record<string, unknown> = {}) =>
    service.book({
      organizationId: ORG,
      startAt,
      source: "ai_receptionist",
      idempotencyKey: key,
      requestIfUnavailable: false,
      ...caller,
      ...extra,
    });
  return { store, fake, service, port, book, scheduled, notified, cancelled };
}

describe("Cal.com as the scheduling provider", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-auth-secret-0123456789"; // secret-scan: allow
  });

  it("offers only the times Cal.com says are free", async () => {
    const { service } = await setup();
    const { slots } = await service.availability({ organizationId: ORG });
    assert.deepEqual(
      slots.map((s) => s.startAt),
      [SLOT_A, SLOT_B, SLOT_C],
    );
  });

  it("offers nothing when Cal.com cannot be asked (never an unverified time)", async () => {
    const { service, fake } = await setup();
    fake.state.slots = "error";
    assert.deepEqual((await service.availability({ organizationId: ORG })).slots, []);
  });

  it("offers nothing and confirms nothing when Cal.com is not connected", async () => {
    const { service, fake, book } = await setup({ connected: false });
    assert.deepEqual((await service.availability({ organizationId: ORG })).slots, []);
    const result = await book(SLOT_A, "k-disconnected");
    assert.equal(result.confirmed, false);
    assert.equal(result.reason, "calendar_unavailable");
    assert.equal(result.appointment?.calendarEventId, undefined);
    assert.equal(fake.count("POST", "/bookings"), 0, "nothing was sent to Cal.com");
    assert.notEqual(result.appointment?.status, "confirmed");
  });

  it("confirms only after Cal.com accepted the booking, and records its id", async () => {
    const { book, fake, scheduled } = await setup();
    const result = await book(SLOT_A, "k-ok");
    assert.equal(result.confirmed, true);
    assert.equal(result.appointment?.status, "confirmed");
    const uid = result.appointment?.calendarEventId;
    assert.match(uid ?? "", /^calcom:bk_\d+$/);
    assert.equal(fake.bookings.get(uid!.slice("calcom:".length))?.status, "accepted");
    assert.equal(scheduled.length, 1, "the customer is told exactly once");
    const sent = fake.requests.find((r) => r.method === "POST" && r.path === "/bookings")!;
    assert.equal(sent.headers["cal-api-version"], "2026-02-25");
    assert.equal(sent.headers.authorization, "Bearer cal_test_0123456789abcdef");
    assert.equal((sent.body?.metadata as Record<string, string>).tc_appointment_id, result.appointment?.id);
  });

  it("a repeated request for the same call and time never books twice", async () => {
    const { book, fake } = await setup();
    const first = await book(SLOT_A, "k-repeat");
    const second = await book(SLOT_A, "k-repeat");
    assert.equal(first.appointment?.id, second.appointment?.id);
    assert.equal(second.confirmed, true);
    assert.equal(fake.count("POST", "/bookings"), 1);
  });

  it("two callers racing for one time: exactly one is confirmed", async () => {
    const { book, fake } = await setup();
    const [a, b] = await Promise.all([book(SLOT_A, "k-race-a"), book(SLOT_A, "k-race-b")]);
    const confirmed = [a, b].filter((r) => r.confirmed);
    const lost = [a, b].filter((r) => !r.confirmed);
    assert.equal(confirmed.length, 1);
    assert.equal(lost.length, 1);
    assert.equal(lost[0].reason, "conflict");
    assert.ok(lost[0].alternatives.every((s) => s.startAt !== SLOT_A));
    assert.equal(
      [...fake.bookings.values()].filter((x) => x.status === "accepted").length,
      1,
    );
  });

  it("Cal.com refusing the time: nothing is confirmed, the hold is released, others are offered", async () => {
    const { book, fake, store } = await setup();
    fake.state.create = "slot_taken";
    const result = await book(SLOT_A, "k-taken");
    assert.equal(result.confirmed, false);
    assert.equal(result.reason, "conflict");
    assert.ok(result.alternatives.length > 0);
    assert.ok(result.alternatives.every((s) => s.startAt !== SLOT_A));
    const rows = await store.listAppointments(ORG);
    assert.ok(rows.every((r) => r.status !== "confirmed" && r.status !== "hold"));
    assert.equal(rows[0].cancelReason, "calendar_slot_taken");
    // The time is free again locally, and is not reported to the contractor as a booking.
    fake.state.create = "ok";
    assert.equal((await book(SLOT_B, "k-after")).confirmed, true);
  });

  for (const mode of ["lost_answer", "timeout_after_create", "never_arrived"] as const) {
    it(`an unknown outcome (${mode}) is never reported as booked, keeps the time held, and is not retried`, async () => {
      const { book, fake, store } = await setup();
      fake.state.create = mode;
      const result = await book(SLOT_A, `k-${mode}`);
      assert.equal(result.confirmed, false);
      assert.equal(result.reason, "calendar_unknown");
      assert.equal(result.appointment?.status, "hold");
      const hold = Date.parse(result.appointment!.holdExpiresAt!);
      assert.ok(hold > NOW.getTime() + 20 * 60_000, "the hold outlives the reconcile interval");
      assert.ok(
        (await store.listEvents(ORG, result.appointment!.id)).some((e) => e.kind === "calendar_unknown"),
      );
      // Calling again with the same key does not ask Cal.com for a second booking.
      await book(SLOT_A, `k-${mode}`);
      assert.equal(fake.count("POST", "/bookings"), 1);
    });
  }

  it("while an outcome is unknown, that time is not offered to anyone else", async () => {
    // "never_arrived": Cal.com still lists the time, so only our own hold hides it.
    const { book, fake, service } = await setup();
    fake.state.create = "never_arrived";
    await book(SLOT_A, "k-held");
    fake.state.create = "ok";
    const { slots } = await service.availability({ organizationId: ORG });
    assert.ok(slots.every((s) => s.startAt !== SLOT_A));
    assert.ok(slots.length > 0);
    const other = await book(SLOT_A, "k-someone-else");
    assert.equal(other.confirmed, false);
    assert.equal(other.reason, "conflict");
  });

  it("a booking waiting for host approval is not a confirmation and is undone", async () => {
    const { book, fake } = await setup();
    fake.state.create = "pending";
    const result = await book(SLOT_A, "k-pending");
    assert.equal(result.confirmed, false);
    assert.equal(result.reason, "calendar_error");
    assert.ok(
      [...fake.bookings.values()].every((b) => b.status === "cancelled"),
      "the pending booking was canceled, not left behind",
    );
  });

  it("a booking at a different time is not a confirmation and is undone", async () => {
    const { book, fake } = await setup();
    fake.state.create = "wrong_time";
    const result = await book(SLOT_A, "k-wrong");
    assert.equal(result.confirmed, false);
    assert.ok([...fake.bookings.values()].every((b) => b.status === "cancelled"));
  });

  it("a refused key never confirms and marks the failure", async () => {
    const { book, fake } = await setup();
    fake.state.keyValid = false;
    const result = await book(SLOT_A, "k-key");
    assert.equal(result.confirmed, false);
    assert.equal(result.appointment?.calendarEventId, undefined);
  });

  it("a booking attempted after the phone deadline has passed is not sent to Cal.com or confirmed", async () => {
    const { book, fake } = await setup();
    const result = await book(SLOT_A, "k-deadline", { deadlineAt: Date.now() - 1 });
    assert.equal(result.confirmed, false);
    assert.equal(result.reason, "booking_timed_out");
    assert.equal(fake.count("POST", "/bookings"), 0);
  });

  describe("moving and canceling", () => {
    it("moving keeps the new Cal.com id, and the old time is released", async () => {
      const { book, service, fake } = await setup();
      const booked = await book(SLOT_A, "k-move");
      const moved = await service.reschedule(ORG, booked.appointment!.id, SLOT_C);
      assert.equal(moved.ok, true);
      assert.equal(moved.appointment?.startAt, SLOT_C);
      assert.notEqual(moved.appointment?.calendarEventId, booked.appointment?.calendarEventId);
      const live = [...fake.bookings.values()].filter((b) => b.status === "accepted");
      assert.equal(live.length, 1);
      assert.equal(`calcom:${live[0].uid}`, moved.appointment?.calendarEventId);
    });

    it("a move Cal.com refuses leaves the appointment where it was", async () => {
      const { book, service, fake } = await setup();
      const booked = await book(SLOT_A, "k-move-taken");
      fake.state.reschedule = "slot_taken";
      const moved = await service.reschedule(ORG, booked.appointment!.id, SLOT_C);
      assert.equal(moved.ok, false);
      assert.equal(moved.reason, "conflict");
      assert.equal(moved.appointment?.startAt, SLOT_A);
    });

    it("a move whose answer was lost is reported as unknown, not as moved", async () => {
      const { book, service, fake } = await setup();
      const booked = await book(SLOT_A, "k-move-lost");
      fake.state.reschedule = "lost_answer";
      const moved = await service.reschedule(ORG, booked.appointment!.id, SLOT_C);
      assert.equal(moved.ok, false);
      assert.equal(moved.reason, "calendar_unknown");
    });

    it("canceling cancels at Cal.com first; failure leaves the appointment alone", async () => {
      const { book, service, fake } = await setup();
      const booked = await book(SLOT_A, "k-cancel");
      fake.state.cancel = "error";
      const failed = await service.cancel(ORG, booked.appointment!.id, "by caller");
      assert.equal(failed.ok, false);
      fake.state.cancel = "ok";
      const done = await service.cancel(ORG, booked.appointment!.id, "by caller");
      assert.equal(done.ok, true);
      assert.ok([...fake.bookings.values()].every((b) => b.status === "cancelled"));
    });

    it("canceling something already canceled at Cal.com counts as done", async () => {
      const { book, service, fake } = await setup();
      const booked = await book(SLOT_A, "k-cancel-twice");
      [...fake.bookings.values()][0].status = "cancelled";
      assert.equal((await service.cancel(ORG, booked.appointment!.id)).ok, true);
    });
  });

  describe("reconciliation", () => {
    it("confirms a booking that Cal.com made but whose answer was lost, and tells the customer", async () => {
      let clock = NOW;
      const t = await setup({ now: () => clock });
      t.fake.state.create = "lost_answer";
      const result = await t.book(SLOT_A, "k-recon");
      assert.equal(result.confirmed, false);
      clock = new Date(NOW.getTime() + 5 * 60_000);
      const summary = await t.service.reconcileProvider(ORG);
      assert.equal(summary.linked, 1);
      const row = await t.store.getAppointment(ORG, result.appointment!.id);
      assert.equal(row?.status, "confirmed");
      assert.match(row?.calendarEventId ?? "", /^calcom:bk_/);
      assert.equal(t.scheduled.filter((s) => s.appointmentId === row!.id).length, 1);
      // Running it again changes nothing and does not notify twice.
      await t.service.reconcileProvider(ORG);
      assert.equal(t.scheduled.filter((s) => s.appointmentId === row!.id).length, 1);
    });

    it("turns a hold Cal.com never saw into a request for the contractor once its time is up", async () => {
      let clock = NOW;
      const t = await setup({ now: () => clock });
      t.fake.state.create = "never_arrived";
      const lost = await t.book(SLOT_B, "k-gone");
      assert.equal(lost.reason, "calendar_unknown");
      // Cal.com never recorded it: the listing has nothing for this hold.
      assert.equal(t.fake.bookings.size, 0);
      clock = new Date(NOW.getTime() + 45 * 60_000);
      const summary = await t.service.reconcileProvider(ORG);
      assert.equal(summary.expiredHolds, 1);
      const rows = await t.store.listAppointments(ORG);
      const original = rows.find((r) => r.id === lost.appointment!.id);
      assert.equal(original?.status, "canceled");
      assert.ok(rows.some((r) => r.status === "pending" && r.appointmentKind === "request"));
    });

    it("leaves a booking that is still in flight alone", async () => {
      const t = await setup();
      t.fake.state.create = "lost_answer";
      await t.book(SLOT_A, "k-inflight");
      const summary = await t.service.reconcileProvider(ORG);
      assert.equal(summary.linked, 0);
      assert.equal(summary.expiredHolds, 0);
    });

    it("cancels a Cal.com booking whose TradeCatch appointment was canceled", async () => {
      let clock = NOW;
      const t = await setup({ now: () => clock });
      const booked = await t.book(SLOT_A, "k-orphan");
      // The cancel reached TradeCatch but not Cal.com.
      const row = (await t.store.getAppointment(ORG, booked.appointment!.id))!;
      row.status = "canceled";
      row.cancelReason = "canceled_by_caller_phone";
      await t.store.saveAppointment(row);
      clock = new Date(NOW.getTime() + 60_000);
      const summary = await t.service.reconcileProvider(ORG);
      assert.equal(summary.orphansCanceled, 1);
      assert.ok([...t.fake.bookings.values()].every((b) => b.status === "cancelled"));
    });

    it("follows the contractor when they move a booking in Cal.com", async () => {
      const t = await setup();
      const booked = await t.book(SLOT_A, "k-moved");
      const uid = booked.appointment!.calendarEventId!.slice("calcom:".length);
      // The contractor reschedules it in Cal.com's own app: a new uid, no TradeCatch metadata.
      const old = t.fake.bookings.get(uid)!;
      old.status = "cancelled";
      const next = t.fake.seed({ start: SLOT_C, rescheduledFromUid: uid });
      old.rescheduledToUid = next.uid;
      const summary = await t.service.reconcileProvider(ORG);
      assert.equal(summary.moved, 1);
      const row = await t.store.getAppointment(ORG, booked.appointment!.id);
      assert.equal(row?.startAt, SLOT_C);
      assert.equal(row?.calendarEventId, `calcom:${next.uid}`);
      assert.ok(t.cancelled.some((c) => c.reason === "rescheduled"));
    });

    it("follows the contractor when they cancel a booking in Cal.com", async () => {
      const t = await setup();
      const booked = await t.book(SLOT_A, "k-cancelled-in-calcom");
      [...t.fake.bookings.values()][0].status = "cancelled";
      const summary = await t.service.reconcileProvider(ORG);
      assert.equal(summary.canceledLocal, 1);
      const row = await t.store.getAppointment(ORG, booked.appointment!.id);
      assert.equal(row?.status, "canceled");
      assert.equal(row?.cancelReason, "canceled_in_calendar");
      assert.ok(t.notified.some((n) => n.kind === "canceled"));
    });

    it("changes nothing when Cal.com's list cannot be read in full", async () => {
      let clock = NOW;
      const t = await setup({ now: () => clock });
      t.fake.state.create = "timeout_after_create";
      const held = await t.book(SLOT_A, "k-listing");
      clock = new Date(NOW.getTime() + 45 * 60_000);
      for (const list of ["error", "more_pages"] as const) {
        t.fake.state.list = list;
        const summary = await t.service.reconcileProvider(ORG);
        assert.equal(summary.ok, false);
        assert.equal((await t.store.getAppointment(ORG, held.appointment!.id))?.status, "hold");
      }
    });
  });
});
