import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dateKeyInZone,
  formatSlotTime,
  monthGrid,
  partOfDay,
  shiftMonth,
  weekdayNames,
} from "../../src/components/app/schedule-picker-utils";
import {
  createSchedulingService,
  createSimulatedCalendar,
  SchedulingError,
} from "../../src/product/scheduling/service";
import { createMemorySchedulingStore } from "../../src/product/scheduling/store";

// Friday 2026-10-16, 08:00 in Montréal. Default hours: Mon-Fri 08:00-18:00,
// 60-minute visits, 30-minute buffer, 2 hours' notice, 30 days ahead.
const NOW = new Date("2026-10-16T12:00:00.000Z");
const ORG = "org-month";

function setup() {
  const store = createMemorySchedulingStore();
  const service = createSchedulingService({
    store,
    now: () => NOW,
    calendar: async () => createSimulatedCalendar(),
  });
  return { service, store };
}

const times = (days: Record<string, { time: string }[]>, day: string) =>
  (days[day] ?? []).map((slot) => slot.time);

describe("month availability (what the calendar picker shows)", () => {
  it("groups free times by the business's own day and shows only days that can be booked", async () => {
    const { service } = setup();
    const month = await service.availabilityMonth({
      organizationId: ORG,
      month: "2026-10",
    });
    assert.equal(month.timezone, "America/Toronto");
    assert.equal(month.today, "2026-10-16");
    assert.equal(month.month, "2026-10");
    // Past days are never offered.
    assert.equal(month.days["2026-10-15"], undefined);
    // Today: 08:00 now + 2 hours' notice means the first time is 10:00.
    assert.equal(times(month.days, "2026-10-16")[0], "10:00");
    // Weekends are closed by the default hours.
    assert.equal(month.days["2026-10-17"], undefined, "Saturday");
    assert.equal(month.days["2026-10-18"], undefined, "Sunday");
    // A normal Monday runs 08:00 to the last 60-minute start at 17:00.
    const monday = times(month.days, "2026-10-19");
    assert.equal(monday[0], "08:00");
    assert.equal(monday.at(-1), "17:00");
    assert.equal(
      month.days["2026-10-19"]![0]!.startAt,
      "2026-10-19T12:00:00.000Z",
      "startAt is the exact instant to send back to book",
    );
  });

  it("covers the whole month, not the first 48 slots", async () => {
    const { service } = setup();
    const month = await service.availabilityMonth({
      organizationId: ORG,
      month: "2026-11",
    });
    const total = Object.values(month.days).reduce((n, d) => n + d.length, 0);
    assert.ok(total > 48, `only ${total} slots`);
    assert.ok(month.days["2026-11-13"], "the last bookable Friday is there");
    assert.equal(month.lastBookableDate, "2026-11-15", "30 days ahead");
    assert.equal(month.days["2026-11-16"], undefined, "beyond the advance limit");
    assert.equal(month.days["2026-11-30"], undefined);
  });

  it("keeps local times right across the daylight-saving change", async () => {
    const { service } = setup();
    const rules = await service.getRules(ORG);
    rules.maxAdvanceDays = 60;
    await service.saveRules(rules);
    const month = await service.availabilityMonth({
      organizationId: ORG,
      month: "2026-11",
    });
    // Clocks went back on Nov 1: 08:00 is now UTC-5.
    assert.equal(month.days["2026-11-02"]![0]!.time, "08:00");
    assert.equal(month.days["2026-11-02"]![0]!.startAt, "2026-11-02T13:00:00.000Z");
  });

  it("skips holidays", async () => {
    const { service } = setup();
    const rules = await service.getRules(ORG);
    rules.holidays = ["2026-10-20"];
    await service.saveRules(rules);
    const month = await service.availabilityMonth({
      organizationId: ORG,
      month: "2026-10",
    });
    assert.equal(month.days["2026-10-20"], undefined);
    assert.ok(month.days["2026-10-21"]);
  });

  it("removes a booked time and its buffer, and a conflicting booking is refused", async () => {
    const { service } = setup();
    const booked = await service.book({
      organizationId: ORG,
      startAt: "2026-10-19T14:00:00.000Z", // Monday 10:00
      customerName: "First",
      source: "dashboard",
      requestIfUnavailable: false,
    });
    assert.equal(booked.confirmed, true);

    const month = await service.availabilityMonth({
      organizationId: ORG,
      month: "2026-10",
    });
    const monday = times(month.days, "2026-10-19");
    assert.ok(monday.includes("08:00"));
    assert.ok(!monday.includes("09:30"), "ends inside the 30-minute buffer before");
    assert.ok(!monday.includes("10:00"), "the booked time");
    assert.ok(!monday.includes("11:00"), "starts inside the buffer after");
    assert.ok(monday.includes("11:30"));

    const again = await service.book({
      organizationId: ORG,
      startAt: "2026-10-19T14:00:00.000Z",
      customerName: "Second",
      source: "dashboard",
      requestIfUnavailable: false,
    });
    assert.equal(again.confirmed, false);
    assert.equal(again.ok, false);
    assert.equal(again.reason, "conflict", "a plain conflict, not a silent pending request");
    assert.ok(again.alternatives.length > 0, "other times are offered");
    assert.ok(
      !again.alternatives.some((a) => a.startAt === "2026-10-19T14:00:00.000Z"),
    );
  });

  it("two people booking the same time at once: exactly one wins", async () => {
    const { service } = setup();
    const results = await Promise.all(
      ["A", "B", "C"].map((customerName) =>
        service.book({
          organizationId: ORG,
          startAt: "2026-10-20T15:00:00.000Z",
          customerName,
          source: "dashboard",
          requestIfUnavailable: false,
        }),
      ),
    );
    assert.equal(results.filter((r) => r.confirmed).length, 1);
    assert.deepEqual(
      results.filter((r) => !r.confirmed).map((r) => r.reason),
      ["conflict", "conflict"],
    );
  });

  it("rescheduling: the appointment's own time is free for itself, not for others", async () => {
    const { service } = setup();
    const booked = await service.book({
      organizationId: ORG,
      startAt: "2026-10-19T14:00:00.000Z",
      customerName: "Mover",
      source: "dashboard",
    });
    const id = booked.appointment!.id;
    const others = await service.availabilityMonth({ organizationId: ORG, month: "2026-10" });
    assert.ok(!times(others.days, "2026-10-19").includes("10:00"));
    const own = await service.availabilityMonth({
      organizationId: ORG,
      month: "2026-10",
      excludeAppointmentId: id,
    });
    assert.ok(times(own.days, "2026-10-19").includes("10:00"));
  });

  it("respects Google Calendar busy time", async () => {
    const { service } = setup();
    await service.syncBusy(ORG, [
      {
        startAt: "2026-10-20T14:00:00.000Z", // 10:00-12:00 local
        endAt: "2026-10-20T16:00:00.000Z",
      },
    ]);
    const month = await service.availabilityMonth({ organizationId: ORG, month: "2026-10" });
    const day = times(month.days, "2026-10-20");
    for (const busy of ["09:30", "10:00", "10:30", "11:00", "11:30"]) {
      assert.ok(!day.includes(busy), `${busy} overlaps the busy block`);
    }
    assert.ok(day.includes("09:00"), "a visit ending exactly when the block starts is fine");
    assert.ok(day.includes("12:00"));
  });

  it("lists each start time once, even with several technicians", async () => {
    const { service } = setup();
    await service.upsertTechnician({ organizationId: ORG, name: "Second technician" });
    const month = await service.availabilityMonth({ organizationId: ORG, month: "2026-10" });
    for (const [day, slots] of Object.entries(month.days)) {
      const starts = slots.map((s) => s.startAt);
      assert.equal(new Set(starts).size, starts.length, `duplicates on ${day}`);
    }
    const flat = await service.availability({
      organizationId: ORG,
      from: "2026-10-19T12:00:00.000Z",
      until: "2026-10-19T23:00:00.000Z",
    });
    const starts = flat.slots.map((s) => s.startAt);
    assert.equal(new Set(starts).size, starts.length);
    // Two technicians are two people: the same time can be booked twice.
    const one = await service.book({
      organizationId: ORG,
      startAt: "2026-10-19T14:00:00.000Z",
      customerName: "One",
      source: "dashboard",
      requestIfUnavailable: false,
    });
    const two = await service.book({
      organizationId: ORG,
      startAt: "2026-10-19T14:00:00.000Z",
      customerName: "Two",
      source: "dashboard",
      requestIfUnavailable: false,
    });
    assert.equal(one.confirmed, true);
    assert.equal(two.confirmed, true);
    assert.notEqual(one.appointment!.technicianId, two.appointment!.technicianId);
  });

  it("rejects a malformed or far-away month", async () => {
    const { service } = setup();
    for (const month of ["garbage", "2026-13", "2026-1", "2020-01", "2031-01"]) {
      await assert.rejects(
        service.availabilityMonth({ organizationId: ORG, month }),
        (error: unknown) => error instanceof SchedulingError && error.status === 400,
        month,
      );
    }
  });

  it("offers the same instants whenever it is asked, whatever the seconds on the clock", async () => {
    // A real server's "now" is never on an exact minute. Slot times used to
    // inherit its seconds (13:00:38.117Z), so an opening had a new startAt on
    // every request and the one a person picked could not be found again.
    const at = (iso: string) => {
      const store = createMemorySchedulingStore();
      return createSchedulingService({
        store,
        now: () => new Date(iso),
        calendar: async () => createSimulatedCalendar(),
      });
    };
    const first = await at("2026-10-16T12:00:38.117Z").availabilityMonth({
      organizationId: ORG,
      month: "2026-10",
    });
    const later = await at("2026-10-16T12:07:11.904Z").availabilityMonth({
      organizationId: ORG,
      month: "2026-10",
    });
    const starts = (m: typeof first) =>
      Object.values(m.days).flatMap((d) => d.map((s) => s.startAt));
    assert.ok(starts(first).length > 0);
    for (const startAt of starts(first)) {
      assert.match(startAt, /:(00|30):00\.000Z$/, startAt);
    }
    assert.deepEqual(starts(first), starts(later));

    // And what the calendar showed can be booked: the picked instant round-trips.
    const service = at("2026-10-16T12:00:38.117Z");
    const pick = starts(first).find((s) => s.startsWith("2026-10-19"))!;
    const booked = await service.book({
      organizationId: ORG,
      startAt: pick,
      customerName: "Round Trip",
      source: "dashboard",
      requestIfUnavailable: false,
    });
    assert.equal(booked.confirmed, true);
    assert.equal(booked.appointment!.startAt, pick);
  });

  it("defaults to the current month in the business timezone", async () => {
    const { service } = setup();
    const month = await service.availabilityMonth({ organizationId: ORG });
    assert.equal(month.month, "2026-10");
  });
});

describe("calendar picker helpers", () => {
  it("shifts months across a year boundary", () => {
    assert.equal(shiftMonth("2026-12", 1), "2027-01");
    assert.equal(shiftMonth("2026-01", -1), "2025-12");
    assert.equal(shiftMonth("2026-10", 0), "2026-10");
    assert.equal(shiftMonth("2026-10", 14), "2027-12");
  });

  it("lays out a Sunday-first grid with the right number of days", () => {
    const oct = monthGrid("2026-10"); // Oct 1, 2026 is a Thursday
    assert.equal(oct.filter((c) => c === null).length, 4);
    assert.equal(oct.filter(Boolean).length, 31);
    assert.deepEqual(oct[4], { day: 1, key: "2026-10-01" });
    assert.equal(monthGrid("2026-11")[0]?.day, 1, "Nov 1, 2026 is a Sunday: no blanks");
    assert.equal(monthGrid("2028-02").filter(Boolean).length, 29, "leap year");
    assert.equal(monthGrid("2026-02").filter(Boolean).length, 28);
  });

  it("splits the day at noon", () => {
    assert.equal(partOfDay("08:00"), "morning");
    assert.equal(partOfDay("11:30"), "morning");
    assert.equal(partOfDay("12:00"), "afternoon");
    assert.equal(partOfDay("17:00"), "afternoon");
  });

  it("uses the business timezone, not the browser's", () => {
    // 22:30 in Montréal on the 10th is already the 11th in UTC.
    assert.equal(dateKeyInZone("2026-11-11T03:30:00.000Z", "America/Toronto"), "2026-11-10");
    assert.equal(dateKeyInZone("2026-11-11T03:30:00.000Z", "UTC"), "2026-11-11");
    // Daylight saving began at 02:00 on 2026-03-08: 07:00Z is 03:00 EDT.
    assert.match(formatSlotTime("2026-03-08T07:00:00.000Z", "America/Toronto", "en-CA"), /^3:00/);
    assert.match(formatSlotTime("2026-03-08T07:00:00.000Z", "America/Toronto", "fr-CA"), /^3\D+00/);
  });

  it("starts the week on Sunday", () => {
    const names = weekdayNames("en-CA");
    assert.equal(names.length, 7);
    assert.match(names[0]!, /^Sun/);
    assert.match(names[6]!, /^Sat/);
  });
});
