/**
 * KAN-19: the appointment calendar. One describe block per acceptance group;
 * every test name starts with its CAL-nn id so a failure points straight at the
 * criterion.
 *
 *   CAL-01  Open calendar: saved appointments are listed, with the business zone
 *   CAL-02  Day view: hourly positions            (layout, see calendar-layout)
 *   CAL-03  Week view: dates and time slots
 *   CAL-04  Month view: appointment dates
 *   CAL-05  Create: appears without a refresh      (API result carries the row)
 *   CAL-06  Edit / reschedule
 *   CAL-07  Cancel: status
 *   CAL-08  Refresh / relogin: appointments preserved (real SQL on PGlite)
 *   CAL-09  Timezone conversion
 *   CAL-10  Daylight saving transition
 *   CAL-11  Overlaps and booking rules
 *   CAL-12  Rapid repeated submission
 *   CAL-13  API / database failure: clear error, no false success
 *   CAL-14  Another business: access denied
 *   CAL-15  Mobile display                         (Playwright, tests/appointment-calendar.spec.ts)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseReceptionistConfig } from "../../src/product/receptionist/config";
import { createReceptionistEngine } from "../../src/product/receptionist/engine";
import { createRuleBrain } from "../../src/product/receptionist/brain-rules";
import { createReceptionistNotifier } from "../../src/product/receptionist/notifications";
import { createPhoneScheduler } from "../../src/product/receptionist/phone-booking";
import { createMemoryReceptionistStore } from "../../src/product/receptionist/store";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import {
  SchedulingError,
  createSchedulingService,
  createSimulatedCalendar,
  type CalendarPort,
} from "../../src/product/scheduling/service";
import { createMemorySchedulingStore } from "../../src/product/scheduling/store";

const ORG = "org-cal";
const NOW = new Date("2026-10-16T12:00:00.000Z");
// Monday 2026-10-19, Toronto is on EDT (UTC-4): 10:00 local = 14:00Z.
const MON_10 = "2026-10-19T14:00:00.000Z";

/** A calendar that can be switched between working and failing, like a real provider having an outage. */
function flakyCalendar(failing = true) {
  const real = createSimulatedCalendar();
  const state = { failing };
  const port: CalendarPort = {
    ...real,
    async createEvent(appointment) {
      return state.failing ? { error: "calendar_unavailable" } : real.createEvent(appointment);
    },
    async updateEvent(eventId, appointment) {
      return state.failing ? { error: "calendar_unavailable" } : real.updateEvent(eventId, appointment);
    },
    async deleteEvent(eventId) {
      return state.failing ? { error: "calendar_unavailable" } : real.deleteEvent(eventId);
    },
  };
  return { port, state };
}

function service(
  over: Partial<Parameters<typeof createSchedulingService>[0]> = {},
  now: () => Date = () => NOW,
) {
  const store = createMemorySchedulingStore();
  const svc = createSchedulingService({
    store,
    now,
    calendar: async () => createSimulatedCalendar(),
    ...over,
  });
  return { svc, store };
}

/* -------------------------------------------------------------------------- */
/* CAL-09: the business timezone is the business's own                        */
/* -------------------------------------------------------------------------- */

describe("CAL-09 timezone", () => {
  it("CAL-09 new scheduling rules start in the business's own timezone, not Toronto", async () => {
    const { svc } = service({ businessTimeZone: async () => "America/Vancouver" });
    const rules = await svc.getRules(ORG);
    assert.equal(rules.timezone, "America/Vancouver");
  });

  it("CAL-09 a business with no known timezone keeps the Toronto default", async () => {
    const { svc } = service({ businessTimeZone: async () => undefined });
    assert.equal((await svc.getRules(ORG)).timezone, "America/Toronto");
    const { svc: plain } = service();
    assert.equal((await plain.getRules(ORG)).timezone, "America/Toronto");
  });

  it("CAL-09 a timezone Intl does not know is never stored", async () => {
    const { svc } = service({ businessTimeZone: async () => "Mars/Olympus" });
    assert.equal((await svc.getRules(ORG)).timezone, "America/Toronto");
  });

  it("CAL-09 an appointment is stored as a UTC instant and carries the business zone", async () => {
    const { svc } = service({ businessTimeZone: async () => "America/Vancouver" });
    // Monday 2026-10-19 10:00 in Vancouver (PDT, UTC-7) is 17:00Z.
    const booked = await svc.book({
      organizationId: ORG,
      startAt: "2026-10-19T17:00:00.000Z",
      customerName: "Zone Customer",
      source: "dashboard",
    });
    assert.equal(booked.confirmed, true);
    assert.equal(booked.appointment?.startAt, "2026-10-19T17:00:00.000Z");
    assert.equal(booked.appointment?.timezone, "America/Vancouver");
  });

  it("CAL-09 a start time without an explicit offset is refused, never read in the server's zone", async () => {
    const { svc } = service();
    for (const startAt of ["2026-10-19T10:00", "2026-10-19T10:00:00", "2026-10-19", "next monday"]) {
      await assert.rejects(
        svc.book({ organizationId: ORG, startAt, customerName: "Naive", source: "dashboard" }),
        (error: unknown) =>
          error instanceof SchedulingError && error.status === 400 && error.code === "invalid_start",
        startAt,
      );
    }
    // An explicit offset is a real instant and is accepted.
    const ok = await svc.book({
      organizationId: ORG,
      startAt: "2026-10-19T10:00:00-04:00",
      customerName: "Offset",
      source: "dashboard",
    });
    assert.equal(ok.confirmed, true);
    assert.equal(ok.appointment?.startAt, "2026-10-19T14:00:00.000Z");
  });

  it("CAL-09 the same rule holds when moving an appointment", async () => {
    const { svc } = service();
    const booked = await svc.book({
      organizationId: ORG,
      startAt: "2026-10-19T14:00:00.000Z",
      customerName: "Mover",
      source: "dashboard",
    });
    await assert.rejects(
      svc.reschedule(ORG, booked.appointment!.id, "2026-10-20T10:00"),
      (error: unknown) => error instanceof SchedulingError && error.code === "invalid_start",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* CAL-09: the receptionist reads the caller's wish in the SAME zone it offers */
/* -------------------------------------------------------------------------- */

describe("CAL-09 receptionist and dashboard agree on the zone", () => {
  // 2026-10-22 05:00Z: 01:00 Thursday in Toronto, but still 22:00 Wednesday in Vancouver.
  const LATE = new Date("2026-10-22T05:00:00.000Z");

  function call() {
    const schedulingStore = createMemorySchedulingStore();
    const scheduling = createSchedulingService({
      store: schedulingStore,
      now: () => LATE,
      calendar: async () => createSimulatedCalendar(),
      // The business is in Vancouver ...
      businessTimeZone: async () => "America/Vancouver",
    });
    const config = parseReceptionistConfig({
      id: "rc_cal",
      clientAccountId: "client_cal",
      phoneNumberE164: "+15145550000",
      businessName: "Pacific Plomberie",
      languages: ["en"],
      defaultLanguage: "en",
      emergencyTransferE164: "+15145550302",
      fallbackTransferE164: "+15145550303",
      notifications: [{ type: "sms", toE164: "+15145550304" }],
      phoneBooking: true,
      // ... but the receptionist profile still says Toronto.
      timezone: "America/Toronto",
    });
    const scheduler = createPhoneScheduler({
      scheduling: async () => scheduling,
      findOrganizationId: async () => ORG,
    });
    const engine = createReceptionistEngine({
      store: createMemoryReceptionistStore(),
      configs: () => [config],
      brain: createRuleBrain(),
      notifier: createReceptionistNotifier({
        sms: createMemorySmsPort(),
        sendEmail: async () => ({ sent: true }),
      }),
      clock: { now: () => LATE },
      scheduler,
    });
    return { engine, scheduler };
  }

  it("CAL-09 'tomorrow' is tomorrow in the business's scheduling zone", async () => {
    const { engine } = call();
    let plan = await engine.startCall({
      callSid: "CA-zone-1",
      fromE164: "+15145559876",
      toE164: "+15145550000",
    });
    const say = (speech: string) =>
      engine.handleGather({ sessionId: plan.sessionId!, speech });
    plan = await say("I'd like to book an appointment for my water heater");
    plan = await say("My name is Marie Tremblay");
    plan = await say("123 Main Street");
    plan = await say("yes");
    plan = await say("tomorrow morning");
    const spoken = plan.verbs
      .flatMap((v) => (v.verb === "say" ? [v.text] : v.verb === "gather" ? v.prompts.map((p) => p.text) : []))
      .join(" | ");
    // It is Wednesday evening in Vancouver, so "tomorrow" is Thursday October 22.
    assert.match(spoken, /Thursday, October 22 at 8 AM/);
    assert.doesNotMatch(spoken, /Friday/);
  });

  it("CAL-09 the phone scheduler reports the scheduling zone to the engine", async () => {
    const { scheduler } = call();
    const config = parseReceptionistConfig({
      id: "rc_cal",
      clientAccountId: "client_cal",
      phoneNumberE164: "+15145550000",
      businessName: "Pacific Plomberie",
      languages: ["en"],
      defaultLanguage: "en",
      emergencyTransferE164: "+15145550302",
      fallbackTransferE164: "+15145550303",
      notifications: [{ type: "sms", toE164: "+15145550304" }],
      phoneBooking: true,
      timezone: "America/Toronto",
    });
    assert.equal(await scheduler.timeZone?.(config), "America/Vancouver");
  });
});

describe("CAL-09 changing the business's zone", () => {
  it("CAL-09 moves how the calendar reads appointments, never the instant they are stored at", async () => {
    const { svc } = service({ businessTimeZone: async () => "America/Toronto" });
    const booked = await svc.book({ organizationId: ORG, startAt: MON_10, customerName: "Stays Put", source: "dashboard" });
    assert.equal(booked.confirmed, true);
    await svc.setTimeZone(ORG, "America/Vancouver");
    assert.equal((await svc.getRules(ORG)).timezone, "America/Vancouver");
    const row = (await svc.list(ORG))[0]!;
    assert.equal(row.startAt, MON_10, "the same moment in time");
    assert.equal(row.timezone, "America/Toronto", "and a record of the zone it was booked in");
  });

  it("CAL-09 refuses a zone Intl does not know", async () => {
    const { svc } = service();
    await svc.getRules(ORG);
    await assert.rejects(
      svc.setTimeZone(ORG, "Mars/Olympus"),
      (error: unknown) => error instanceof SchedulingError && error.status === 400 && error.code === "invalid_timezone",
    );
    assert.equal((await svc.getRules(ORG)).timezone, "America/Toronto");
  });

  it("CAL-09 a zone change on the hours screen is passed on to the business, once", async () => {
    const calls: [string, string][] = [];
    const { svc } = service({ businessTimeZoneChanged: async (org, zone) => void calls.push([org, zone]) });
    const rules = await svc.getRules(ORG);
    await svc.saveRules({ ...rules, timezone: "America/Halifax" });
    await svc.saveRules({ ...rules, timezone: "America/Halifax", bufferMinutes: 15 });
    assert.deepEqual(calls, [[ORG, "America/Halifax"]]);
  });
});

/* -------------------------------------------------------------------------- */
/* CAL-11: overlaps and the business's booking rules                          */
/* -------------------------------------------------------------------------- */

describe("CAL-11 overlaps and booking rules", () => {
  const book = (svc: ReturnType<typeof service>["svc"], startAt: string, extra: object = {}) =>
    svc.book({
      organizationId: ORG,
      startAt,
      customerName: "Rule Customer",
      source: "dashboard",
      requestIfUnavailable: false,
      ...extra,
    });

  it("CAL-11 refuses a booking that overlaps a confirmed appointment, buffer included", async () => {
    const { svc } = service();
    assert.equal((await book(svc, MON_10)).confirmed, true);
    // 10:30 overlaps the 10:00-11:00 job.
    const overlap = await book(svc, "2026-10-19T14:30:00.000Z");
    assert.equal(overlap.confirmed, false);
    assert.equal(overlap.reason, "conflict");
    // 11:00 starts when the job ends, but the 30-minute buffer is still running.
    const buffered = await book(svc, "2026-10-19T15:00:00.000Z");
    assert.equal(buffered.confirmed, false);
    assert.equal(buffered.reason, "conflict");
    // 11:30 is clear of the buffer.
    assert.equal((await book(svc, "2026-10-19T15:30:00.000Z")).confirmed, true);
  });

  it("CAL-11 never leaves two confirmed appointments on one time, even when asked for a request", async () => {
    const { svc } = service();
    await book(svc, MON_10);
    // The receptionist-style default records a pending request for a taken time.
    const second = await svc.book({ organizationId: ORG, startAt: MON_10, customerName: "Second", source: "ai_receptionist" });
    assert.equal(second.confirmed, false);
    const confirmed = (await svc.list(ORG)).filter((row) => row.status === "confirmed");
    assert.equal(confirmed.length, 1);
  });

  it("CAL-11 enforces hours, notice, holidays and the booking window", async () => {
    const { svc } = service();
    const rules = await svc.getRules(ORG);
    rules.holidays = ["2026-10-21"];
    rules.maxAdvanceDays = 30;
    await svc.saveRules(rules);
    const refused: [string, string][] = [
      ["a Sunday", "2026-10-18T15:00:00.000Z"],
      ["before opening (07:00 local)", "2026-10-19T11:00:00.000Z"],
      ["after closing (18:00 local)", "2026-10-19T22:00:00.000Z"],
      ["a holiday", "2026-10-21T14:00:00.000Z"],
      ["inside the minimum notice", "2026-10-16T13:00:00.000Z"],
      ["in the past", "2026-10-01T14:00:00.000Z"],
      ["beyond the booking window", "2026-12-21T15:00:00.000Z"],
      ["off the half-hour grid", "2026-10-19T14:10:00.000Z"],
    ];
    for (const [why, startAt] of refused) {
      const result = await book(svc, startAt);
      assert.equal(result.confirmed, false, why);
      assert.equal(result.reason, "conflict", why);
    }
    assert.equal((await svc.list(ORG)).length, 0, "nothing was saved for any refused time");
  });

  it("CAL-11 refuses to move an appointment onto a taken time and leaves it where it was", async () => {
    const { svc } = service();
    const first = await book(svc, MON_10);
    const second = await book(svc, "2026-10-19T16:00:00.000Z");
    const moved = await svc.reschedule(ORG, second.appointment!.id, MON_10);
    assert.equal(moved.ok, false);
    assert.equal(moved.reason, "unavailable");
    const after = (await svc.get(ORG, second.appointment!.id)).appointment;
    assert.equal(after.startAt, "2026-10-19T16:00:00.000Z");
    assert.equal(after.status, "confirmed");
    assert.equal((await svc.get(ORG, first.appointment!.id)).appointment.startAt, MON_10);
  });

  it("CAL-11 will not hand an appointment to a technician who is busy at that time", async () => {
    const { svc } = service();
    await svc.listServices(ORG);
    await svc.upsertTechnician({ organizationId: ORG, name: "Second technician" });
    const a = await book(svc, MON_10);
    const b = await book(svc, MON_10);
    assert.equal(a.confirmed && b.confirmed, true, "two technicians can work the same hour");
    assert.notEqual(a.appointment!.technicianId, b.appointment!.technicianId);
    await assert.rejects(
      svc.updateDetails(ORG, b.appointment!.id, { technicianId: a.appointment!.technicianId }),
      (error: unknown) =>
        error instanceof SchedulingError && error.status === 409 && error.code === "technician_busy",
    );
    assert.equal(
      (await svc.get(ORG, b.appointment!.id)).appointment.technicianId,
      b.appointment!.technicianId,
      "the appointment keeps its technician",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* CAL-06 / CAL-07: edit, reschedule, cancel                                  */
/* -------------------------------------------------------------------------- */

describe("CAL-06 edit and reschedule", () => {
  it("CAL-06 reschedules the same record to a free time and keeps the customer", async () => {
    const { svc } = service();
    const booked = await svc.book({
      organizationId: ORG,
      startAt: MON_10,
      customerName: "Jean Tremblay",
      customerPhoneE164: "+15145550123",
      serviceAddress: "12 Rue Principale",
      source: "dashboard",
    });
    const id = booked.appointment!.id;
    const moved = await svc.reschedule(ORG, id, "2026-10-20T15:00:00.000Z");
    assert.equal(moved.ok, true);
    const rows = (await svc.list(ORG)).filter((row) => row.status !== "canceled");
    assert.equal(rows.length, 1, "moved, not copied");
    assert.equal(rows[0]!.id, id);
    assert.equal(rows[0]!.startAt, "2026-10-20T15:00:00.000Z");
    assert.equal(rows[0]!.endAt, "2026-10-20T16:00:00.000Z", "the duration is kept");
    assert.equal(rows[0]!.customerName, "Jean Tremblay");
    assert.equal(rows[0]!.customerPhoneE164, "+15145550123");
    assert.equal(rows[0]!.serviceAddress, "12 Rue Principale");
  });

  it("CAL-06 edits the customer's name, phone and address without touching the time", async () => {
    const { svc } = service();
    const booked = await svc.book({ organizationId: ORG, startAt: MON_10, customerName: "Old Name", source: "dashboard" });
    const id = booked.appointment!.id;
    const updated = await svc.updateDetails(ORG, id, {
      customerName: "New Name",
      customerPhoneE164: "+15145550999",
      serviceAddress: "99 New Street",
    });
    assert.equal(updated.customerName, "New Name");
    assert.equal(updated.customerPhoneE164, "+15145550999");
    assert.equal(updated.serviceAddress, "99 New Street");
    assert.equal(updated.startAt, MON_10);
    assert.equal(updated.status, "confirmed");
  });
});

describe("CAL-06 clearing a detail", () => {
  it("CAL-06 an address or a phone number can be taken off, and a name can never be blanked", async () => {
    const { svc } = service();
    const booked = await svc.book({
      organizationId: ORG,
      startAt: MON_10,
      customerName: "Keeps Name",
      customerPhoneE164: "+15145550123",
      serviceAddress: "12 Rue Principale",
      source: "dashboard",
    });
    const id = booked.appointment!.id;
    const cleared = await svc.updateDetails(ORG, id, { serviceAddress: "  ", customerPhoneE164: null, customerName: "" });
    assert.equal(cleared.serviceAddress, undefined, "an emptied address is removed, not silently kept");
    assert.equal(cleared.customerPhoneE164, undefined);
    assert.equal(cleared.customerName, "Keeps Name", "an empty name is ignored");
    assert.equal((await svc.get(ORG, id)).appointment.serviceAddress, undefined, "and it is the saved record that changed");
  });
});

describe("CAL-07 cancel", () => {
  it("CAL-07 cancels, keeps the record and history, and frees the time", async () => {
    const { svc } = service();
    const booked = await svc.book({ organizationId: ORG, startAt: MON_10, customerName: "Cancel Me", source: "dashboard" });
    const id = booked.appointment!.id;
    const result = await svc.cancel(ORG, id, "Customer called");
    assert.equal(result.ok, true);
    const { appointment, history } = await svc.get(ORG, id);
    assert.equal(appointment.status, "canceled");
    assert.equal(appointment.cancelReason, "Customer called");
    assert.ok(history.some((event) => event.kind === "canceled"));
    assert.equal((await svc.list(ORG)).length, 1, "a canceled appointment stays on the record");
    const again = await svc.book({ organizationId: ORG, startAt: MON_10, customerName: "Next", source: "dashboard", requestIfUnavailable: false });
    assert.equal(again.confirmed, true, "the freed time can be booked again");
  });

  it("CAL-07 cancelling twice is harmless", async () => {
    const { svc } = service();
    const booked = await svc.book({ organizationId: ORG, startAt: MON_10, customerName: "Twice", source: "dashboard" });
    await svc.cancel(ORG, booked.appointment!.id);
    const second = await svc.cancel(ORG, booked.appointment!.id);
    assert.equal(second.ok, true);
    assert.equal(second.appointment.status, "canceled");
  });

  it("CAL-07 a completed job cannot be cancelled", async () => {
    // Booked in advance, then completed on the day.
    const { svc, store } = service();
    const booked = await svc.book({ organizationId: ORG, startAt: MON_10, customerName: "Done", source: "dashboard" });
    const id = booked.appointment!.id;
    const onTheDay = createSchedulingService({
      store,
      now: () => new Date("2026-10-19T20:00:00.000Z"),
      calendar: async () => createSimulatedCalendar(),
    });
    await onTheDay.updateDetails(ORG, id, { status: "completed" });
    await assert.rejects(
      onTheDay.cancel(ORG, id),
      (error: unknown) => error instanceof SchedulingError && error.status === 409 && error.code === "already_completed",
    );
    assert.equal((await onTheDay.get(ORG, id)).appointment.status, "completed");
  });

  it("CAL-07 stays confirmed, and says so, when the calendar cannot remove the event", async () => {
    const calendar = flakyCalendar(false);
    const { svc } = service({ calendar: async () => calendar.port });
    const booked = await svc.book({ organizationId: ORG, startAt: MON_10, customerName: "Synced", source: "dashboard" });
    assert.equal(booked.confirmed, true);
    calendar.state.failing = true;
    const result = await svc.cancel(ORG, booked.appointment!.id);
    assert.equal(result.ok, false);
    assert.equal("reason" in result && result.reason, "calendar_error");
    assert.equal((await svc.get(ORG, booked.appointment!.id)).appointment.status, "confirmed", "not silently dropped");
  });

  it("CAL-07 a cancel racing a reschedule can never bring the appointment back", async () => {
    const { svc } = service();
    const booked = await svc.book({ organizationId: ORG, startAt: MON_10, customerName: "Race", source: "dashboard" });
    const id = booked.appointment!.id;
    await Promise.allSettled([svc.reschedule(ORG, id, "2026-10-20T15:00:00.000Z"), svc.cancel(ORG, id, "race")]);
    assert.equal((await svc.get(ORG, id)).appointment.status, "canceled");
  });
});

/* -------------------------------------------------------------------------- */
/* CAL-12 / CAL-13: duplicates and failures                                   */
/* -------------------------------------------------------------------------- */

describe("CAL-12 rapid repeated submission", () => {
  it("CAL-12 twenty-five identical submissions make one appointment", async () => {
    const { svc } = service();
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        svc.book({
          organizationId: ORG,
          startAt: MON_10,
          customerName: "Double Click",
          source: "dashboard",
          idempotencyKey: "attempt-1",
          requestIfUnavailable: false,
        }),
      ),
    );
    assert.equal((await svc.list(ORG)).length, 1);
    assert.ok(results.every((result) => result.ok && result.confirmed));
    assert.equal(new Set(results.map((result) => result.appointment!.id)).size, 1);
  });

  it("CAL-12 retrying a booking whose calendar failed saves one request, never a pile of them", async () => {
    const calendar = flakyCalendar(true);
    const { svc } = service({ calendar: async () => calendar.port });
    const attempt = () =>
      svc.book({
        organizationId: ORG,
        startAt: MON_10,
        customerName: "Retry",
        source: "dashboard",
        idempotencyKey: "attempt-2",
        requestIfUnavailable: false,
      });
    const first = await attempt();
    assert.equal(first.ok, false);
    assert.equal(first.reason, "calendar_error");
    const second = await attempt();
    const third = await attempt();
    assert.equal(second.confirmed, false);
    assert.equal(third.confirmed, false);
    const live = (await svc.list(ORG)).filter((row) => row.status !== "canceled");
    assert.equal(live.length, 1, "one pending request, not one per click");
    assert.equal(live[0]!.status, "pending");
    assert.equal(second.appointment?.id, live[0]!.id);
    // When the calendar is back the owner can approve it: still one appointment.
    calendar.state.failing = false;
    const approved = await svc.approve(ORG, live[0]!.id);
    assert.equal(approved.ok, true);
    assert.equal((await svc.list(ORG)).filter((row) => row.status === "confirmed").length, 1);
  });
});

describe("CAL-13 failures are never reported as success", () => {
  it("CAL-13 a calendar failure is never a confirmation", async () => {
    const calendar = flakyCalendar(true);
    const { svc } = service({ calendar: async () => calendar.port });
    const result = await svc.book({ organizationId: ORG, startAt: MON_10, customerName: "Outage", source: "dashboard" });
    assert.equal(result.confirmed, false);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "calendar_error");
    assert.equal(result.appointment?.status, "pending", "kept as a request so it is not lost");
    assert.equal(result.appointment?.appointmentKind, "request");
  });

  it("CAL-13 a failed move leaves the appointment on its old time", async () => {
    const calendar = flakyCalendar(false);
    const { svc } = service({ calendar: async () => calendar.port });
    const booked = await svc.book({ organizationId: ORG, startAt: MON_10, customerName: "Mover", source: "dashboard" });
    calendar.state.failing = true;
    const moved = await svc.reschedule(ORG, booked.appointment!.id, "2026-10-20T15:00:00.000Z");
    assert.equal(moved.ok, false);
    assert.equal(moved.reason, "calendar_error");
    assert.equal((await svc.get(ORG, booked.appointment!.id)).appointment.startAt, MON_10);
  });
});
