/**
 * KAN-22 acceptance scenarios SYNC-03 to SYNC-18: Google Calendar two-way
 * synchronization against a fake Google that behaves like the real API (sync
 * tokens, 409 duplicates, 410 gone, revocation, rate limits, outages) and the
 * real scheduling service.
 *
 * The scenarios are written once and run twice: against the in-memory store
 * (gcal-sync.test.ts) and against the real SQL in schema.sql on PGlite
 * (gcal-sync-postgres.test.ts), so the two stores cannot drift apart.
 * SYNC-01, SYNC-02 and the browser-visible parts of SYNC-13, SYNC-16 and
 * SYNC-17 run in Playwright (tests/gcal.spec.ts).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  MAX_ATTEMPTS,
  MAX_STALE_MS,
} from "../../src/product/scheduling/gcal/sync";
import { dayStartUtc } from "../../src/product/scheduling/gcal/events";
import { createGoogleSync } from "../../src/product/scheduling/gcal/sync";
import { listGoogleCalendarsViaOpen } from "./support/gcal-list";
import {
  MONDAY_10,
  MONDAY_10_END,
  MONDAY_13,
  OWNER,
  TUESDAY_10,
  URLS,
  useGoogleEnv,
  type Harness,
  type HarnessOptions,
} from "./support/gcal-harness";

export type MakeHarness = (options?: HarnessOptions) => Promise<Harness>;

/** Registers every scenario; `make` builds a fresh harness over the store under test. */
export function registerSyncScenarios(make: MakeHarness) {
  let restoreEnv: () => void;
  before(() => {
    restoreEnv = useGoogleEnv();
  });
  after(() => restoreEnv());

  const DAY = 24 * 60 * 60_000;
  const MIN = 60_000;

  async function slotsOn(h: Harness, org: string, from: string, until: string) {
    return (await h.service.availability({ organizationId: org, from, until })).slots.map(
      (slot) => slot.startAt,
    );
  }

  describe("SYNC-03 import busy periods from Google", () => {
    it("blocks the owner's busy times, ignores free/declined/informational ones, and keeps nothing private", async () => {
      const h = await make();
      h.google.ownerAdds(OWNER, { start: "2026-10-19T14:00:00Z", end: "2026-10-19T15:00:00Z", summary: "Dentist (private)" });
      h.google.ownerAdds(OWNER, { start: { date: "2026-10-20" }, end: { date: "2026-10-21" }, summary: "Vacation day" });
      // None of these block the owner's time.
      h.google.ownerAdds(OWNER, { start: "2026-10-19T17:00:00Z", end: "2026-10-19T18:00:00Z", transparency: "transparent" });
      h.google.ownerAdds(OWNER, { start: "2026-10-19T18:00:00Z", end: "2026-10-19T19:00:00Z", declined: true });
      h.google.ownerAdds(OWNER, { start: { date: "2026-10-21" }, end: { date: "2026-10-22" }, eventType: "workingLocation" });

      const before = await slotsOn(h, "org_a", "2026-10-19T12:00:00Z", "2026-10-19T22:00:00Z");
      assert.ok(before.includes(MONDAY_10), "free before connecting");
      await h.connect();

      const monday = await slotsOn(h, "org_a", "2026-10-19T12:00:00Z", "2026-10-19T22:00:00Z");
      assert.ok(!monday.includes(MONDAY_10), "the dentist blocks 10:00");
      assert.ok(monday.includes(MONDAY_13), "a time marked free does not block");
      assert.ok(monday.includes("2026-10-19T18:00:00.000Z"), "a declined invitation does not block");
      assert.equal((await slotsOn(h, "org_a", "2026-10-20T12:00:00Z", "2026-10-20T22:00:00Z")).length, 0, "an all-day event blocks the whole day");
      assert.ok((await slotsOn(h, "org_a", "2026-10-21T12:00:00Z", "2026-10-21T22:00:00Z")).length > 0, "a working-location marker does not");

      // Private details never entered TradeCatch: not asked for, not stored.
      const listCalls = h.google.calls.filter((call) => call.path.endsWith("/events") && call.method === "GET");
      assert.ok(listCalls.length > 0);
      for (const call of listCalls) {
        const fields = decodeURIComponent(call.query);
        assert.ok(!/summary|description|location|creator|organizer/.test(fields.replace(/singleEvents|showDeleted/g, "")), `asked only for times: ${fields}`);
      }
      const stored = JSON.stringify([
        await h.store.listMirror("org_a", OWNER),
        await h.store.listBusy("org_a"),
        await h.store.getSyncState("org_a"),
        await h.store.listEventLinks("org_a"),
      ]);
      for (const secret of ["Dentist", "Vacation", "private.example", "Private notes"]) {
        assert.ok(!stored.includes(secret), `${secret} must not be stored`);
      }
    });

    it("follows changes after the first read without reading everything again", async () => {
      const h = await make();
      await h.connect();
      h.google.clearCalls();
      const id = h.google.ownerAdds(OWNER, { start: MONDAY_10, end: MONDAY_10_END, summary: "New" });
      assert.equal((await h.sync.pull("org_a")).status, "ok");
      assert.ok(!(await slotsOn(h, "org_a", "2026-10-19T12:00:00Z", "2026-10-19T22:00:00Z")).includes(MONDAY_10));
      const incremental = h.google.calls.find((c) => c.path.endsWith("/events") && c.method === "GET");
      assert.ok(decodeURIComponent(incremental!.query).includes("syncToken=st-"), "uses the sync token");
      h.google.ownerDeletes(OWNER, id);
      await h.sync.pull("org_a");
      assert.ok((await slotsOn(h, "org_a", "2026-10-19T12:00:00Z", "2026-10-19T22:00:00Z")).includes(MONDAY_10), "a deletion frees the time");
    });

    it("reads every page, and recovers when Google expires the sync token (410)", async () => {
      const h = await make();
      h.google.pageSize = 2;
      for (let i = 0; i < 5; i += 1) {
        h.google.ownerAdds(OWNER, { start: `2026-10-2${i}T14:00:00Z`, end: `2026-10-2${i}T15:00:00Z` });
      }
      await h.connect();
      assert.equal((await h.store.listMirror("org_a", OWNER)).length, 5, "all pages read");
      const state = await h.store.getSyncState("org_a");
      h.google.staleTokens.add(state!.syncToken!);
      h.google.ownerAdds(OWNER, { start: "2026-10-26T14:00:00Z", end: "2026-10-26T15:00:00Z" });
      const outcome = await h.sync.pull("org_a");
      assert.equal(outcome.status, "ok");
      assert.ok(outcome.status === "ok" && outcome.full, "started over from a full read");
      assert.equal((await h.store.listMirror("org_a", OWNER)).length, 6);
    });
  });

  describe("SYNC-04 a confirmed appointment creates a Google event", () => {
    it("creates one event, privately marked, with no customer details by default", async () => {
      const h = await make();
      await h.connect();
      const result = await h.book("org_a", MONDAY_10);
      assert.equal(result.confirmed, true);
      const appointment = result.appointment!;
      const events = h.google.tradecatchEvents(OWNER);
      assert.equal(events.length, 1);
      const event = events[0]!;
      assert.equal(event.id, appointment.calendarEventId, "the appointment knows its event");
      assert.equal(event.start.dateTime, MONDAY_10);
      assert.equal(event.end.dateTime, appointment.endAt);
      assert.equal(event.extendedProperties?.private?.tcAppointmentId, appointment.id);
      const body = JSON.stringify(event);
      for (const personal of ["Alice", "5145550101", "Privée"]) {
        assert.ok(!body.includes(personal), `${personal} must not reach the owner's calendar by default`);
      }
      const link = await h.store.getEventLink("org_a", appointment.id);
      assert.equal(link?.state, "synced");
      assert.equal(link?.pendingOp, null);
      // The create request told Google not to email anyone.
      assert.ok(h.google.calls.some((c) => c.method === "POST" && c.query.includes("sendUpdates=none")));
    });

    it("includes the customer only when the owner chose to", async () => {
      const h = await make();
      await h.connect();
      await h.service.updateCalendarSettings("org_a", { eventDetail: "standard" });
      const result = await h.book("org_a", MONDAY_10);
      const event = h.google.tradecatchEvents(OWNER)[0]!;
      assert.ok(event.summary?.includes("Alice Tremblay"));
      assert.ok(event.description?.includes("+15145550101"));
      assert.equal(result.confirmed, true);
    });

    it("books the same way for the phone receptionist", async () => {
      const h = await make();
      await h.connect();
      const result = await h.book("org_a", MONDAY_10, { source: "ai_receptionist", requestIfUnavailable: false });
      assert.equal(result.confirmed, true);
      assert.equal(h.google.tradecatchEvents(OWNER).length, 1);
    });

    it("never confirms on top of an event the owner just added, even before a notification arrives", async () => {
      const h = await make();
      await h.connect();
      // Added in Google a moment ago: no push, no cron has run yet.
      h.google.ownerAdds(OWNER, { start: MONDAY_10, end: MONDAY_10_END, summary: "Just added" });
      const result = await h.book("org_a", MONDAY_10, { requestIfUnavailable: false });
      assert.equal(result.confirmed, false);
      assert.equal(result.reason, "conflict");
      assert.equal(h.google.tradecatchEvents(OWNER).length, 0);
      assert.ok(result.alternatives.length > 0, "another time is offered");
    });
  });

  describe("SYNC-05 rescheduling updates the same event", () => {
    it("moves the event in place instead of creating another", async () => {
      const h = await make();
      await h.connect();
      const booked = (await h.book("org_a", MONDAY_10)).appointment!;
      const moved = await h.service.reschedule("org_a", booked.id, MONDAY_13);
      assert.equal(moved.ok, true);
      const events = h.google.tradecatchEvents(OWNER);
      assert.equal(events.length, 1, "still one event");
      assert.equal(events[0]!.id, booked.calendarEventId);
      assert.equal(events[0]!.start.dateTime, MONDAY_13);
      const link = await h.store.getEventLink("org_a", booked.id);
      assert.equal(link?.state, "synced");
      assert.equal(link?.syncedStartAt, MONDAY_13);
      assert.equal(h.google.calls.filter((c) => c.method === "POST" && c.path.endsWith("/events")).length, 1, "one create ever");
    });
  });

  describe("SYNC-06 canceling updates or removes the event", () => {
    it("removes the event by default and keeps the appointment canceled", async () => {
      const h = await make();
      await h.connect();
      const booked = (await h.book("org_a", MONDAY_10)).appointment!;
      const canceled = await h.service.cancel("org_a", booked.id, "customer called");
      assert.equal(canceled.ok, true);
      assert.equal(h.google.liveEvents(OWNER).length, 0, "removed from the calendar");
      assert.equal((await h.store.getAppointment("org_a", booked.id))?.status, "canceled");
      assert.ok((await slotsOn(h, "org_a", "2026-10-19T12:00:00Z", "2026-10-19T22:00:00Z")).includes(MONDAY_10), "the time is free again");
    });

    it("marks it canceled and free instead, when the owner prefers to keep a record", async () => {
      const h = await make();
      await h.connect();
      await h.service.updateCalendarSettings("org_a", { cancelPolicy: "mark_canceled" });
      const booked = (await h.book("org_a", MONDAY_10)).appointment!;
      await h.service.cancel("org_a", booked.id, "customer called");
      const event = h.google.liveEvents(OWNER)[0]!;
      assert.ok(event.summary?.startsWith("[Canceled]"));
      assert.equal(event.transparency, "transparent", "a canceled visit does not block the owner's time");
      // And that remaining event never blocks TradeCatch either (it is ours).
      assert.ok((await slotsOn(h, "org_a", "2026-10-19T12:00:00Z", "2026-10-19T22:00:00Z")).includes(MONDAY_10));
    });
  });

  describe("SYNC-07 the owner modifies a TradeCatch event in Google", () => {
    it("keeps the appointment, records the change, blocks the new time and writes nothing back", async () => {
      const h = await make();
      await h.connect();
      const booked = (await h.book("org_a", MONDAY_10)).appointment!;
      h.google.clearCalls();
      h.google.ownerMoves(OWNER, booked.calendarEventId!, "2026-10-19T19:00:00Z", "2026-10-19T20:00:00Z");
      await h.sync.pull("org_a");

      const stored = await h.store.getAppointment("org_a", booked.id);
      assert.equal(stored?.startAt, MONDAY_10, "the appointment did not move");
      assert.equal(stored?.status, "confirmed");
      const link = await h.store.getEventLink("org_a", booked.id);
      assert.equal(link?.state, "external_modified");
      assert.equal(link?.externalStartAt, "2026-10-19T19:00:00.000Z");
      assert.equal(h.writes().length, 0, "TradeCatch never writes the owner's change back");
      const summary = await h.sync.summary("org_a");
      assert.deepEqual(summary.needsAttention.map((item) => [item.appointmentId, item.state]), [[booked.id, "external_modified"]]);
      // The time the owner moved it to is real occupancy.
      assert.ok(!(await slotsOn(h, "org_a", "2026-10-19T12:00:00Z", "2026-10-19T22:00:00Z")).includes("2026-10-19T19:00:00.000Z"));

      // Running the sync again changes nothing and still writes nothing.
      await h.sync.tick();
      await h.sync.tick();
      assert.equal(h.writes().length, 0);
    });

    it("ignores an edit that changes only the title", async () => {
      const h = await make();
      await h.connect();
      const booked = (await h.book("org_a", MONDAY_10)).appointment!;
      h.google.ownerRetitles(OWNER, booked.calendarEventId!, "Owner renamed it");
      await h.sync.pull("org_a");
      assert.equal((await h.store.getEventLink("org_a", booked.id))?.state, "synced");
      assert.equal((await h.sync.summary("org_a")).needsAttention.length, 0);
    });

    it("lets a later TradeCatch reschedule win over the owner's stale edit", async () => {
      const h = await make();
      await h.connect();
      const booked = (await h.book("org_a", MONDAY_10)).appointment!;
      h.google.ownerMoves(OWNER, booked.calendarEventId!, "2026-10-19T19:00:00Z", "2026-10-19T20:00:00Z");
      await h.sync.pull("org_a");
      await h.service.reschedule("org_a", booked.id, MONDAY_13);
      const link = await h.store.getEventLink("org_a", booked.id);
      assert.equal(link?.state, "synced");
      assert.equal(link?.externalStartAt, undefined);
      assert.equal(h.google.tradecatchEvents(OWNER)[0]!.start.dateTime, MONDAY_13);
    });
  });

  describe("SYNC-08 the owner deletes a TradeCatch event in Google", () => {
    it("keeps the appointment, records it, and never recreates the event on its own", async () => {
      const h = await make();
      await h.connect();
      const booked = (await h.book("org_a", MONDAY_10)).appointment!;
      h.google.ownerDeletes(OWNER, booked.calendarEventId!);
      h.google.clearCalls();
      await h.sync.pull("org_a");

      assert.equal((await h.store.getAppointment("org_a", booked.id))?.status, "confirmed", "the appointment is preserved");
      assert.equal((await h.store.getEventLink("org_a", booked.id))?.state, "external_deleted");
      const summary = await h.sync.summary("org_a");
      assert.deepEqual(summary.needsAttention.map((item) => item.state), ["external_deleted"]);
      await h.sync.tick();
      assert.equal(h.writes().length, 0, "no resurrection");
      // Moving the appointment later does not secretly bring the event back either.
      await h.service.reschedule("org_a", booked.id, MONDAY_13);
      assert.equal(h.google.liveEvents(OWNER).length, 0);
      assert.equal(h.writes().length, 0);
      // The time is still held by the appointment.
      assert.ok(!(await slotsOn(h, "org_a", "2026-10-19T12:00:00Z", "2026-10-19T22:00:00Z")).includes(MONDAY_13));
    });

    it("learns of the deletion from Google's own answer when it moves the appointment before it has read the change", async () => {
      const h = await make();
      await h.connect();
      const booked = (await h.book("org_a", MONDAY_10)).appointment!;
      h.google.ownerDeletes(OWNER, booked.calendarEventId!);
      // The read that normally precedes a change fails, so TradeCatch still believes the event exists.
      h.google.failNext(503, {}, {}, 1, "GET");
      h.google.clearCalls();

      const moved = await h.service.reschedule("org_a", booked.id, MONDAY_13);
      assert.equal(moved.ok, true, "the appointment moves regardless of Google");
      assert.equal((await h.store.getAppointment("org_a", booked.id))?.startAt, MONDAY_13);
      assert.ok(h.google.calls.some((c) => c.method === "PATCH"), "it did try to update the event");
      assert.equal((await h.store.getEventLink("org_a", booked.id))?.state, "external_deleted");
      assert.equal(h.google.calls.filter((c) => c.method === "POST" && c.path.endsWith("/events")).length, 0, "no event is created in its place");
      assert.equal(h.google.liveEvents(OWNER).length, 0);
      assert.equal((await h.sync.summary("org_a")).needsAttention.length, 1);
    });

    it("notices a deletion that happened while the full read was the only way to see it", async () => {
      const h = await make();
      await h.connect();
      const booked = (await h.book("org_a", MONDAY_10)).appointment!;
      h.google.ownerDeletes(OWNER, booked.calendarEventId!);
      // Google purged the tombstone: only a full read can tell, by the absence.
      const calendar = h.google.calendar(OWNER);
      calendar.events.delete(booked.calendarEventId!);
      calendar.version += 1;
      const outcome = await h.sync.pull("org_a", { full: true });
      assert.equal(outcome.status, "ok");
      assert.equal((await h.store.getEventLink("org_a", booked.id))?.state, "external_deleted");
    });
  });

  describe("SYNC-09 duplicate notifications and duplicate events", () => {
    it("answers a repeated or older notification without reading again", async () => {
      const h = await make();
      await h.connect();
      const channel = h.google.latestChannel()!;
      const notify = (number: number) =>
        h.sync.receive({ channelId: channel.id, token: channel.token, resourceState: "exists", messageNumber: number });
      h.google.ownerAdds(OWNER, { start: MONDAY_10, end: MONDAY_10_END });
      assert.equal((await notify(7)).status, "synced");
      const reads = h.google.count("GET /calendar/v3/calendars");
      assert.equal((await notify(7)).status, "duplicate");
      assert.equal((await notify(6)).status, "duplicate");
      assert.equal(h.google.count("GET /calendar/v3/calendars"), reads, "no extra reads");
      assert.equal((await h.store.listBusy("org_a")).length, 1, "the event is counted once");
    });

    it("rejects a notification for another business's channel or with the wrong secret", async () => {
      const h = await make({ allowed: ["org_a", "org_b"] });
      await h.connect("org_a", OWNER);
      await h.connect("org_b", "other@example.test");
      const a = [...h.google.channels.values()].find((c) => c.email === OWNER)!;
      assert.equal((await h.sync.receive({ channelId: a.id, token: "wrong-secret-0123456789abcdef" })).status, "unauthorized");
      assert.equal((await h.sync.receive({ channelId: "unknown-channel-0123456789", token: a.token })).status, "unauthorized");
    });

    it("never makes two events for one appointment when the request is repeated", async () => {
      const h = await make();
      await h.connect();
      const booked = (await h.book("org_a", MONDAY_10)).appointment!;
      for (let i = 0; i < 3; i += 1) {
        await h.sync.enqueue("org_a", booked, "create");
        await h.sync.push({ organizationId: "org_a" });
      }
      assert.equal(h.google.tradecatchEvents(OWNER).length, 1);
      assert.equal((await h.store.listEventLinks("org_a")).length, 1);
    });

    it("adopts the event when Google created it but the answer was lost, instead of duplicating it", async () => {
      const h = await make();
      await h.connect();
      const booked = (await h.book("org_a", MONDAY_10)).appointment!;
      // The earlier answer was lost: the link says "create" again.
      const link = (await h.store.getEventLink("org_a", booked.id))!;
      await h.store.saveEventLink({ ...link, state: "pending", pendingOp: "create", lastSyncedAt: undefined, remoteEtag: undefined, updatedAt: h.now().toISOString() });
      await h.sync.push({ organizationId: "org_a" });
      assert.equal(h.google.tradecatchEvents(OWNER).length, 1, "409 adopted the existing event");
      assert.equal((await h.store.getEventLink("org_a", booked.id))?.state, "synced");
    });

    it("serializes overlapping reads, and the second notification is not lost", async () => {
      const h = await make();
      await h.connect();
      h.google.ownerAdds(OWNER, { start: MONDAY_10, end: MONDAY_10_END });
      const [first, second] = await Promise.all([h.sync.pull("org_a"), h.sync.pull("org_a")]);
      assert.ok([first.status, second.status].includes("ok"));
      assert.equal((await h.store.listBusy("org_a")).length, 1);
    });
  });

  describe("SYNC-10 concurrent bookings", () => {
    it("lets exactly one of two simultaneous bookings win the time", async () => {
      const h = await make();
      await h.connect();
      const [a, b] = await Promise.all([
        h.book("org_a", MONDAY_10, { customerName: "First", requestIfUnavailable: false }),
        h.book("org_a", MONDAY_10, { customerName: "Second", requestIfUnavailable: false }),
      ]);
      assert.equal([a, b].filter((r) => r.confirmed).length, 1);
      const loser = [a, b].find((r) => !r.confirmed)!;
      assert.equal(loser.reason, "conflict");
      assert.equal(h.google.tradecatchEvents(OWNER).length, 1, "one event, not two");
      const confirmed = (await h.store.listAppointments("org_a")).filter((x) => x.status === "confirmed");
      assert.equal(confirmed.length, 1);
    });

    it("handles a burst of different times without losing or duplicating any", async () => {
      const h = await make();
      await h.connect();
      const times = Array.from({ length: 5 }, (_, i) => `2026-10-19T${String(13 + i * 2).padStart(2, "0")}:00:00.000Z`);
      const results = await Promise.all(times.map((t) => h.book("org_a", t, { requestIfUnavailable: false })));
      assert.ok(results.every((r) => r.confirmed));
      assert.equal(h.google.tradecatchEvents(OWNER).length, 5);
      assert.equal(new Set(h.google.tradecatchEvents(OWNER).map((e) => e.id)).size, 5);
    });
  });

  describe("SYNC-11 expired and revoked tokens", () => {
    it("refreshes an expired access token without the owner noticing", async () => {
      const h = await make();
      await h.connect();
      h.google.expireAccessTokens();
      h.google.clearCalls();
      const result = await h.book("org_a", MONDAY_10);
      assert.equal(result.confirmed, true);
      assert.ok(h.google.count("POST /token") >= 1, "refreshed");
      assert.equal(h.google.tradecatchEvents(OWNER).length, 1);
      assert.equal((await h.store.getConnection("org_a"))?.status, "connected");
    });

    it("asks the owner to reconnect when Google says the grant is gone, and keeps working safely meanwhile", async () => {
      const h = await make();
      await h.connect();
      const booked = (await h.book("org_a", MONDAY_10)).appointment!;
      h.google.ownerRevokesAccess(OWNER);

      const outcome = await h.sync.pull("org_a");
      assert.equal(outcome.status, "failed");
      const connection = await h.store.getConnection("org_a");
      assert.equal(connection?.status, "expired");
      assert.equal(connection?.lastError, "google_access_revoked");
      assert.deepEqual(h.revokedNotices, ["org_a"], "the owner is told once");

      // Nothing new is confirmed against a calendar we cannot see: it becomes a request.
      const request = await h.book("org_a", MONDAY_13, { requestIfUnavailable: true });
      assert.equal(request.confirmed, false);
      assert.equal(request.appointment?.status, "pending");

      // The existing appointment can still be canceled; Google is told after reconnecting.
      const canceled = await h.service.cancel("org_a", booked.id, "customer called");
      assert.equal(canceled.ok, true);
      assert.equal((await h.store.getAppointment("org_a", booked.id))?.status, "canceled");
      assert.equal((await h.store.getEventLink("org_a", booked.id))?.state, "pending");
      assert.equal(h.google.liveEvents(OWNER).length, 1, "not removed yet: Google refused access");

      // Reconnecting restores the same calendar and delivers what was waiting.
      await h.connect("org_a", OWNER, OWNER);
      await h.sync.tick();
      assert.equal((await h.store.getConnection("org_a"))?.status, "connected");
      assert.equal(h.google.liveEvents(OWNER).length, 0, "the cancellation arrived");
      assert.equal((await h.store.getEventLink("org_a", booked.id))?.state, "synced");
    });

    it("does not mistake a Google outage during refresh for a revoked connection", async () => {
      const h = await make();
      await h.connect();
      h.google.expireAccessTokens();
      h.google.down = true; // the token endpoint answers 503 too
      const outcome = await h.sync.pull("org_a");
      assert.equal(outcome.status, "failed");
      assert.equal((await h.store.getConnection("org_a"))?.status, "connected", "not 'expired'");
      assert.deepEqual(h.revokedNotices, []);
    });
  });

  describe("SYNC-12 Google is down", () => {
    it("keeps booking, records the error, retries with backoff, and recovers on its own", async () => {
      const h = await make();
      await h.connect();
      h.google.down = true;
      const result = await h.book("org_a", MONDAY_10);
      assert.equal(result.confirmed, true, "a Google outage does not stop a booking while the calendar was read recently");
      const link = (await h.store.getEventLink("org_a", result.appointment!.id))!;
      assert.equal(link.state, "pending");
      assert.equal(link.lastError, "google_unavailable");
      assert.equal(link.attempts, 1);
      assert.ok(Date.parse(link.nextAttemptAt!) > h.now().getTime(), "waits before trying again");
      assert.equal(h.google.tradecatchEvents(OWNER).length, 0);

      // A tick too early does nothing; the schedule is honoured.
      await h.sync.tick();
      assert.equal((await h.store.getEventLink("org_a", result.appointment!.id))?.attempts, 1);

      // Errors are visible to the owner, and the pull failure is recorded.
      const summary = await h.sync.summary("org_a");
      assert.equal(summary.pending, 1);

      h.google.down = false;
      h.advance(5 * MIN);
      await h.sync.tick();
      assert.equal(h.google.tradecatchEvents(OWNER).length, 1, "delivered after recovery");
      const healed = (await h.store.getEventLink("org_a", result.appointment!.id))!;
      assert.equal(healed.state, "synced");
      assert.equal(healed.lastError, undefined);
      assert.equal(healed.attempts, 0);
    });

    it("honours Retry-After on a rate limit", async () => {
      const h = await make();
      await h.connect();
      h.google.failNext(429, { error: { errors: [{ reason: "rateLimitExceeded" }] } }, { "Retry-After": "600" }, 1, "POST");
      const result = await h.book("org_a", MONDAY_10);
      assert.equal(result.confirmed, true);
      const link = (await h.store.getEventLink("org_a", result.appointment!.id))!;
      assert.equal(link.lastError, "google_rate_limited");
      assert.ok(Date.parse(link.nextAttemptAt!) - h.now().getTime() >= 600_000, "waits at least as long as Google asked");
    });

    it("gives up after a bounded number of attempts, shows it, and lets the owner retry", async () => {
      const h = await make();
      await h.connect();
      const booked = (await h.book("org_a", MONDAY_10)).appointment!;
      h.google.down = true;
      await h.service.reschedule("org_a", booked.id, MONDAY_13).catch(() => undefined);
      for (let i = 0; i < MAX_ATTEMPTS + 2; i += 1) {
        h.advance(2 * 60 * MIN);
        await h.sync.push({ organizationId: "org_a" });
      }
      const link = (await h.store.getEventLink("org_a", booked.id))!;
      assert.equal(link.state, "failed", "bounded");
      assert.ok(link.attempts <= MAX_ATTEMPTS);
      const summary = await h.sync.summary("org_a");
      assert.equal(summary.failed, 1);
      assert.equal(summary.lastError, "google_unavailable");
      const writesAtGiveUp = h.writes().length;
      h.advance(10 * 60 * MIN);
      await h.sync.tick();
      assert.equal(h.writes().length, writesAtGiveUp, "no further attempts once it has given up");

      // "Sync now" gives it a fresh set of attempts.
      h.google.down = false;
      const retried = await h.sync.retry("org_a");
      assert.equal(retried.push.synced, 1);
      assert.equal((await h.store.getEventLink("org_a", booked.id))?.state, "synced");
      assert.equal(h.google.tradecatchEvents(OWNER)[0]!.start.dateTime, MONDAY_13);
    });

    it("sends a waiting change at once when the owner presses Sync now, without waiting out the backoff", async () => {
      const h = await make();
      await h.connect();
      h.google.down = true;
      const result = await h.book("org_a", MONDAY_10);
      assert.equal(result.confirmed, true);
      const before = (await h.store.getEventLink("org_a", result.appointment!.id))!;
      assert.equal(before.state, "pending");
      assert.ok(Date.parse(before.nextAttemptAt!) > h.now().getTime(), "waiting out its backoff");

      h.google.down = false; // Google is back, but no time has passed
      const idle = await h.sync.push({ organizationId: "org_a" });
      assert.equal(idle.claimed, 0, "the schedule alone does not send it yet");

      const retried = await h.sync.retry("org_a");
      assert.equal(retried.push.synced, 1);
      assert.equal(h.google.tradecatchEvents(OWNER).length, 1);
      assert.equal((await h.sync.summary("org_a")).pending, 0);
    });

    it("makes one attempt per press of Sync now, never a retry storm", async () => {
      const h = await make();
      await h.connect();
      h.google.down = true;
      const result = await h.book("org_a", MONDAY_10);
      assert.equal(h.writes().length, 1, "the booking's own attempt");
      for (let i = 0; i < 3; i += 1) await h.sync.retry("org_a");
      assert.equal(h.writes().length, 4, "one more write attempt per press, no more");
      const link = (await h.store.getEventLink("org_a", result.appointment!.id))!;
      assert.equal(link.state, "pending");
      assert.equal(link.attempts, 4, "every attempt is counted");
    });

    it("will not call a calendar free when it has not been read for too long", async () => {
      const h = await make();
      await h.connect();
      h.google.down = true;
      h.advance(MAX_STALE_MS + MIN);
      const result = await h.book("org_a", "2026-10-20T14:00:00.000Z", { requestIfUnavailable: true });
      assert.equal(result.confirmed, false, "an unknown calendar is not a free calendar");
      assert.equal(result.appointment?.status, "pending");
    });
  });

  describe("SYNC-13 a different business is denied", () => {
    it("keeps every business's mirror, links and events apart", async () => {
      const h = await make({ allowed: ["org_a", "org_b"] });
      h.google.ownerAdds(OWNER, { start: MONDAY_10, end: MONDAY_10_END });
      await h.connect("org_a", OWNER);
      await h.connect("org_b", "other@example.test");
      const a = (await h.book("org_a", MONDAY_13)).appointment!;

      assert.equal(await h.store.getEventLink("org_b", a.id), null, "org_b cannot read org_a's link");
      assert.deepEqual(await h.store.listEventLinks("org_b"), []);
      assert.equal(h.google.tradecatchEvents("other@example.test").length, 0, "org_a's appointment never reaches org_b's calendar");
      assert.equal(h.google.tradecatchEvents(OWNER).length, 1);
      // org_a's Google event blocks only org_a.
      assert.ok(!(await slotsOn(h, "org_a", "2026-10-19T12:00:00Z", "2026-10-19T22:00:00Z")).includes(MONDAY_10));
      assert.ok((await slotsOn(h, "org_b", "2026-10-19T12:00:00Z", "2026-10-19T22:00:00Z")).includes(MONDAY_10));
      // org_b cannot cancel org_a's appointment through the service either.
      await assert.rejects(h.service.cancel("org_b", a.id), /not found/i);
      assert.equal((await h.store.getAppointment("org_a", a.id))?.status, "confirmed");
    });

    it("never lists another business's calendars or lets it pick one", async () => {
      const h = await make({ allowed: ["org_a", "org_b"] });
      await h.connect("org_a", OWNER);
      const listed = await listGoogleCalendarsViaOpen(h.open, "org_b");
      assert.equal(listed.ok, false, "org_b has no connection of its own");
    });
  });

  describe("SYNC-14 disconnect stops sync and preserves appointments", () => {
    it("revokes at Google, clears every credential and mirror, and keeps every appointment", async () => {
      const h = await make();
      h.google.ownerAdds(OWNER, { start: MONDAY_10, end: MONDAY_10_END });
      await h.connect();
      const kept = (await h.book("org_a", MONDAY_13)).appointment!;
      const channel = h.google.latestChannel()!;
      assert.ok(!(await slotsOn(h, "org_a", "2026-10-19T12:00:00Z", "2026-10-19T22:00:00Z")).includes(MONDAY_10));

      await h.service.disconnect("org_a");

      assert.ok(h.google.revokedTokens.some((token) => token.startsWith("rt:")), "the grant is revoked at Google");
      assert.ok(h.google.stoppedChannels.includes(channel.id), "the push channel is stopped");
      const connection = await h.store.getConnection("org_a");
      assert.equal(connection?.status, "disconnected");
      assert.equal(connection?.tokenCiphertext, undefined, "no credential kept");
      assert.equal(connection?.calendarId, undefined);
      // What the dashboard is told is what the owner just did, not "simulated".
      assert.equal((await h.service.connectionStatus("org_a")).status, "disconnected");
      assert.equal(await h.store.getSyncState("org_a"), null);
      assert.deepEqual(await h.store.listMirror("org_a", OWNER), []);
      assert.deepEqual(await h.store.listBusy("org_a"), []);
      assert.equal((await h.store.getEventLink("org_a", kept.id))?.state, "detached");

      // Appointments are untouched, and Google's events are left as they were.
      assert.equal((await h.store.getAppointment("org_a", kept.id))?.status, "confirmed");
      assert.equal(h.google.tradecatchEvents(OWNER).length, 1);

      // No further calls to Google, from the tick or from anything else.
      h.google.clearCalls();
      h.google.ownerAdds(OWNER, { start: MONDAY_13, end: "2026-10-19T18:00:00Z" });
      h.advance(DAY);
      await h.sync.tick();
      await h.sync.pull("org_a");
      await h.sync.push({ organizationId: "org_a" });
      assert.equal(h.google.calls.filter((c) => c.path.startsWith("/calendar/v3")).length, 0);

      // The preserved appointment can still be moved and canceled, without Google.
      const moved = await h.service.reschedule("org_a", kept.id, "2026-10-20T14:00:00.000Z");
      assert.equal(moved.ok, true);
      assert.equal((await h.service.cancel("org_a", kept.id)).ok, true);
      assert.equal(h.google.calls.filter((c) => c.path.startsWith("/calendar/v3")).length, 0);
      // And the old external block is gone, so its time can be booked.
      assert.ok((await slotsOn(h, "org_a", "2026-10-19T12:00:00Z", "2026-10-19T22:00:00Z")).includes(MONDAY_10));
    });

    it("still disconnects when Google cannot be reached", async () => {
      const h = await make();
      await h.connect();
      h.google.down = true;
      await h.service.disconnect("org_a");
      assert.equal((await h.store.getConnection("org_a"))?.status, "disconnected");
      assert.equal((await h.store.getConnection("org_a"))?.tokenCiphertext, undefined);
    });

    it("re-attaches to the events it left behind, without duplicating them, when reconnected", async () => {
      const h = await make();
      await h.connect();
      const kept = (await h.book("org_a", MONDAY_13)).appointment!;
      await h.service.disconnect("org_a");
      await h.connect();
      assert.equal(h.google.tradecatchEvents(OWNER).length, 1, "no duplicate");
      assert.equal((await h.store.getEventLink("org_a", kept.id))?.state, "synced");
      // Its own event does not block its own time.
      const busy = await h.store.listBusy("org_a");
      assert.equal(busy.length, 0);
    });
  });

  describe("SYNC-15 time zones and daylight saving", () => {
    it("stores UTC, labels in the business zone, and tells Google the zone", async () => {
      const h = await make({ start: "2026-10-28T12:00:00Z" });
      await h.connect();
      // 2026-10-31 09:00 EDT = 13:00Z; 2026-11-02 09:00 EST (after the fall-back) = 14:00Z.
      const before = (await h.book("org_a", "2026-10-30T13:00:00.000Z")).appointment!;
      const after = (await h.book("org_a", "2026-11-02T14:00:00.000Z")).appointment!;
      assert.equal(before.timezone, "America/Toronto");
      const events = h.google.tradecatchEvents(OWNER);
      for (const event of events) assert.equal(event.start.timeZone, "America/Toronto");
      assert.deepEqual(events.map((e) => e.start.dateTime).sort(), ["2026-10-30T13:00:00.000Z", "2026-11-02T14:00:00.000Z"]);
      // Same wall-clock 09:00 before and after the change, one hour apart in UTC.
      const day = (iso: string) =>
        new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
      assert.equal(day(before.startAt), "09:00");
      assert.equal(day(after.startAt), "09:00");
    });

    it("reads all-day events as the business's own days, including the 25-hour fall-back day", async () => {
      // 2026-11-01 is the day clocks go back in Toronto: 25 hours long.
      assert.equal(dayStartUtc("2026-11-01", "America/Toronto").toISOString(), "2026-11-01T04:00:00.000Z");
      assert.equal(dayStartUtc("2026-11-02", "America/Toronto").toISOString(), "2026-11-02T05:00:00.000Z");
      // 2027-03-14 is the spring-forward day: 23 hours long.
      assert.equal(dayStartUtc("2027-03-14", "America/Toronto").toISOString(), "2027-03-14T05:00:00.000Z");
      assert.equal(dayStartUtc("2027-03-15", "America/Toronto").toISOString(), "2027-03-15T04:00:00.000Z");
      // And in a zone ahead of UTC the all-day block starts the evening before in UTC.
      assert.equal(dayStartUtc("2026-10-20", "Australia/Sydney").toISOString(), "2026-10-19T13:00:00.000Z");

      const h = await make({ start: "2026-10-28T12:00:00Z" });
      h.google.ownerAdds(OWNER, { start: { date: "2026-11-01" }, end: { date: "2026-11-02" }, summary: "Fall-back day off" });
      await h.connect();
      const [block] = await h.store.listBusy("org_a");
      assert.equal(block!.startAt, "2026-11-01T04:00:00.000Z");
      assert.equal(block!.endAt, "2026-11-02T05:00:00.000Z");
      assert.equal((Date.parse(block!.endAt) - Date.parse(block!.startAt)) / 3_600_000, 25);
      // The Monday after is free, Sunday the 1st is closed anyway: check the business day edge.
      assert.ok((await slotsOn(h, "org_a", "2026-11-02T12:00:00Z", "2026-11-02T22:00:00Z")).length > 0, "the next day is bookable");
    });

    it("books across the spring-forward boundary without drifting an hour", async () => {
      const h = await make({ start: "2027-03-10T12:00:00Z" });
      await h.connect();
      // Monday 2027-03-15 10:00 EDT = 14:00Z (the Sunday before, clocks moved forward).
      const booked = (await h.book("org_a", "2027-03-15T14:00:00.000Z")).appointment!;
      assert.equal(booked.status, "confirmed");
      assert.equal(h.google.tradecatchEvents(OWNER)[0]!.start.dateTime, "2027-03-15T14:00:00.000Z");
    });
  });

  describe("SYNC-16 the Essential plan is denied", () => {
    it("makes no call to Google for a business whose plan does not include the calendar", async () => {
      const h = await make({ allowed: [] }); // org_a is not enrolled / not Professional
      assert.equal((await h.sync.pull("org_a")).status, "skipped");
      assert.equal((await h.sync.start("org_a")).pull.status, "skipped");
      await h.sync.tick();
      assert.equal(h.google.calls.length, 0);
      const listed = await listGoogleCalendarsViaOpen(h.open, "org_a");
      assert.equal(listed.ok, false);
    });

    it("stops everything the moment a plan is downgraded, without deleting anything", async () => {
      const h = await make();
      await h.connect();
      const booked = (await h.book("org_a", MONDAY_10)).appointment!;
      h.allowed.delete("org_a"); // downgraded to Essential
      h.google.clearCalls();
      h.google.ownerAdds(OWNER, { start: MONDAY_13, end: "2026-10-19T18:00:00Z" });
      await h.sync.tick();
      assert.equal(h.google.calls.length, 0, "nothing reaches Google");
      assert.equal((await h.store.getAppointment("org_a", booked.id))?.status, "confirmed");
    });
  });

  describe("SYNC-17 status persists across a refresh and a new login", () => {
    it("is read from what is stored, so a new process shows the same thing", async () => {
      const h = await make();
      await h.connect();
      await h.book("org_a", MONDAY_10);
      await h.sync.pull("org_a");
      const first = await h.sync.summary("org_a");
      const status = await h.service.connectionStatus("org_a");

      // A new process: new engine and service over the same stored state.
      const reborn = createGoogleSync({
        store: h.store,
        open: h.open,
        allowed: async () => true,
        rules: async () => ({ timezone: "America/Toronto", maxAdvanceDays: 30 }),
        now: h.now,
        fetchImpl: h.google.fetch,
        urls: URLS,
      });
      const second = await reborn.summary("org_a");
      assert.deepEqual(second, first);
      assert.equal(status.status, "connected");
      assert.equal(status.accountEmail, OWNER);
      assert.equal(status.calendarId, OWNER);
      assert.equal(status.calendarSummary, "Work calendar");
      assert.ok(first.lastSuccessfulSyncAt);
    });

    it("carries the last failure too, until the next success clears it", async () => {
      const h = await make();
      await h.connect();
      h.google.down = true;
      h.advance(5 * MIN);
      await h.sync.pull("org_a");
      assert.equal((await h.sync.summary("org_a")).lastError, "google_unavailable");
      h.google.down = false;
      h.advance(10 * MIN);
      await h.sync.pull("org_a");
      assert.equal((await h.sync.summary("org_a")).lastError, undefined);
    });
  });

  describe("SYNC-17b a half-finished connection is not lost on refresh", () => {
    it("still shows that a calendar has to be chosen, from stored state alone", async () => {
      const h = await make();
      const { clientCredentials, requestTokens } = await import(
        "../../src/product/scheduling/gcal/client"
      );
      const { sealTokens } = await import("../../src/product/scheduling/google");
      const exchanged = await requestTokens(
        {
          ...clientCredentials(),
          code: h.google.codeFor(OWNER),
          redirect_uri: "https://tradecatch.example/api/calendar/oauth/callback",
          grant_type: "authorization_code",
        },
        { fetchImpl: h.google.fetch, urls: URLS, now: () => h.now().getTime() },
      );
      assert.ok(exchanged.ok);
      // What the OAuth callback stores when there is no earlier calendar to keep.
      await h.store.saveConnection({
        organizationId: "org_a",
        provider: "google",
        status: "error",
        lastError: "select_calendar",
        accountEmail: OWNER,
        tokenCiphertext: sealTokens({ ...exchanged.tokens, email: OWNER }),
        expiresAt: exchanged.tokens.expiresAt,
        scope: exchanged.tokens.scope,
      });
      const status = await h.service.connectionStatus("org_a");
      assert.equal(status.status, "error");
      assert.equal(status.lastError, "select_calendar");
      assert.equal(status.accountEmail, OWNER);
      assert.equal(status.calendarId, undefined);
      // Nothing is synchronised and no appointment is sent anywhere yet.
      assert.equal(h.google.tradecatchEvents(OWNER).length, 0);
      // Another business is unaffected.
      assert.equal((await h.service.connectionStatus("org_b")).status, "simulated");
      // Choosing the calendar finishes the connection.
      const done = await h.service.selectCalendar("org_a", OWNER, "Work calendar");
      assert.equal(done.status, "connected");
    });
  });

  describe("SYNC-18 two-way sync with no loops and no duplicates", () => {
    it("settles: after a mixed history, running the sync again writes nothing and duplicates nothing", async () => {
      const h = await make();
      await h.connect();
      const a = (await h.book("org_a", MONDAY_10)).appointment!;
      h.google.ownerAdds(OWNER, { start: "2026-10-19T19:00:00Z", end: "2026-10-19T20:00:00Z", summary: "Owner's own" });
      await h.sync.pull("org_a");
      await h.service.reschedule("org_a", a.id, MONDAY_13);
      h.google.ownerRetitles(OWNER, a.calendarEventId!, "Owner edited the title");
      await h.sync.pull("org_a");
      const b = (await h.book("org_a", TUESDAY_10)).appointment!;
      await h.service.cancel("org_a", b.id);

      // Everything is delivered. Now let it run for a long while.
      h.google.clearCalls();
      for (let i = 0; i < 6; i += 1) {
        h.advance(20 * MIN);
        await h.sync.tick();
      }
      assert.equal(h.writes().length, 0, "no write loop: the sync is quiet once it has settled");

      // Google holds exactly what it should: the owner's event and ours (the canceled one is gone).
      assert.equal(h.google.liveEvents(OWNER).length, 2);
      assert.equal(h.google.tradecatchEvents(OWNER).filter((e) => e.status !== "cancelled").length, 1);
      assert.equal(h.google.tradecatchEvents(OWNER).find((e) => e.status !== "cancelled")!.start.dateTime, MONDAY_13);
      // TradeCatch blocks only the owner's own event, never its own appointments.
      const busy = await h.store.listBusy("org_a");
      assert.deepEqual(busy.map((x) => x.startAt), ["2026-10-19T19:00:00.000Z"]);
      assert.equal((await h.store.listEventLinks("org_a")).length, 2, "one link per appointment");
      assert.equal((await h.sync.summary("org_a")).pending, 0);
    });

    it("does not echo a change that came from Google back to Google", async () => {
      const h = await make();
      await h.connect();
      h.google.clearCalls();
      for (let i = 0; i < 4; i += 1) {
        h.google.ownerAdds(OWNER, { start: `2026-10-2${i}T14:00:00Z`, end: `2026-10-2${i}T15:00:00Z` });
        await h.sync.pull("org_a");
      }
      assert.equal(h.writes().length, 0);
      assert.equal(h.google.tradecatchEvents(OWNER).length, 0);
    });
  });

  describe("renewing push notifications", () => {
    it("registers a channel for the business and renews it before it expires", async () => {
      const h = await make();
      await h.connect();
      const first = h.google.latestChannel()!;
      assert.equal(first.calendarId, OWNER);
      assert.equal(first.address, "https://tradecatch.example/api/webhooks/google-calendar");
      assert.equal((await h.sync.summary("org_a")).push, "active");

      h.advance(7 * DAY - 6 * 60 * MIN); // under a day left
      await h.sync.tick();
      const second = h.google.latestChannel()!;
      assert.notEqual(second.id, first.id, "a fresh channel");
      assert.ok(h.google.stoppedChannels.includes(first.id), "the old one is stopped");
      assert.ok(!(await h.store.getSyncState("org_a") as { channelToken?: string })?.["channelToken" as never], "the secret is never stored in clear");
      const state = (await h.store.getSyncState("org_a"))!;
      assert.notEqual(state.channelTokenHash, second.token, "only a hash is kept");
    });

    it("falls back to polling when push cannot be used, and says so", async () => {
      const h = await make({ webhookUrl: undefined });
      await h.connect();
      assert.equal(h.google.channels.size, 0);
      assert.equal((await h.sync.summary("org_a")).push, "off");
      h.google.clearCalls();
      h.google.ownerAdds(OWNER, { start: MONDAY_10, end: MONDAY_10_END });
      h.advance(4 * MIN);
      await h.sync.tick();
      assert.ok(!(await slotsOn(h, "org_a", "2026-10-19T12:00:00Z", "2026-10-19T22:00:00Z")).includes(MONDAY_10), "the poll found it");
    });
  });

}
