import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decryptSecret, encryptSecret } from "../../src/product/scheduling/crypto";
import {
  createSchedulingService,
  createSimulatedCalendar,
  type CalendarPort,
} from "../../src/product/scheduling/service";
import { createMemorySchedulingStore } from "../../src/product/scheduling/store";
import { listSlots } from "../../src/product/scheduling/slots";
import { defaultDays } from "../../src/product/scheduling/slots";

const NOW = new Date("2026-10-16T12:00:00.000Z");
const MONDAY_10 = "2026-10-19T14:00:00.000Z";

function setup(calendar?: CalendarPort) {
  const store = createMemorySchedulingStore();
  const port = calendar ?? createSimulatedCalendar();
  const notices: string[] = [];
  const canceled: string[] = [];
  const service = createSchedulingService({
    store,
    now: () => NOW,
    calendar: async () => port,
    scheduleNotices: async (input) => {
      notices.push(input.appointmentId);
    },
    cancelNotices: async (_org, appointmentId) => {
      canceled.push(appointmentId);
    },
  });
  return { service, store, port, notices, canceled };
}

describe("appointment scheduling", () => {
  it("offers Monday 10:00 Montréal and refuses Sunday", async () => {
    const { service } = setup();
    const rules = await service.getRules("org-a");
    assert.equal(rules.timezone, "America/Toronto");
    assert.equal(rules.days["0"], null);
    const open = await service.availability({
      organizationId: "org-a",
      from: "2026-10-19T13:00:00.000Z",
      until: "2026-10-19T18:00:00.000Z",
    });
    assert.equal(open.slots.some((slot) => slot.startAt === MONDAY_10), true);
    const sunday = await service.availability({
      organizationId: "org-a",
      from: "2026-10-18T12:00:00.000Z",
      until: "2026-10-18T22:00:00.000Z",
    });
    assert.equal(sunday.slots.length, 0);
  });

  it("lists the whole working day and closes a day only once it holds the maximum bookings", async () => {
    const { service } = setup();
    const rules = await service.getRules("org-a");
    assert.equal(rules.maxDailyBookings, 8);
    const day = (from: string, until: string) =>
      service.availability({ organizationId: "org-a", from, until });

    const open = await day("2026-10-19T12:00:00.000Z", "2026-10-19T23:00:00.000Z");
    const starts = open.slots.map((slot) => slot.startAt);
    assert.equal(starts.includes("2026-10-19T12:00:00.000Z"), true, "08:00 local");
    assert.equal(starts.includes("2026-10-19T19:00:00.000Z"), true, "15:00 local is offered, not cut off after the morning");
    assert.equal(starts.includes("2026-10-19T21:00:00.000Z"), true, "17:00 local, the last 60-minute start");

    rules.maxDailyBookings = 2;
    await service.saveRules(rules);
    for (const startAt of ["2026-10-19T12:00:00.000Z", "2026-10-19T16:00:00.000Z"]) {
      const booked = await service.book({
        organizationId: "org-a",
        startAt,
        customerName: "Test Customer",
        source: "simulation",
      });
      assert.equal(booked.confirmed, true, startAt);
    }
    assert.equal((await day("2026-10-19T12:00:00.000Z", "2026-10-19T23:00:00.000Z")).slots.length, 0, "a full day offers nothing");
    const refused = await service.book({
      organizationId: "org-a",
      startAt: "2026-10-19T19:00:00.000Z",
      customerName: "Third Customer",
      source: "simulation",
    });
    assert.equal(refused.confirmed, false, "the daily maximum is enforced when reserving too");
    assert.ok((await day("2026-10-20T12:00:00.000Z", "2026-10-20T23:00:00.000Z")).slots.length > 0, "the next day is unaffected");
  });

  it("keeps local 8:00 on both sides of daylight saving", () => {
    const winter = listSlots({
      rules: {
        organizationId: "org-a",
        timezone: "America/Toronto",
        days: defaultDays(),
        defaultDurationMinutes: 60,
        bufferMinutes: 0,
        travelBufferMinutes: 0,
        minimumNoticeMinutes: 0,
        maxAdvanceDays: 30,
        holidays: [],
        calendarMode: "simulated",
        updatedAt: NOW.toISOString(),
      },
      from: new Date("2026-01-05T12:30:00.000Z"),
      until: new Date("2026-01-05T14:00:00.000Z"),
      durationMinutes: 60,
      bufferMinutes: 0,
      appointments: [],
      externalBusy: [],
      now: new Date("2026-01-05T12:00:00.000Z"),
    });
    assert.equal(winter[0]?.startAt, "2026-01-05T13:00:00.000Z");
    const summer = listSlots({
      rules: {
        organizationId: "org-a",
        timezone: "America/Toronto",
        days: defaultDays(),
        defaultDurationMinutes: 60,
        bufferMinutes: 0,
        travelBufferMinutes: 0,
        minimumNoticeMinutes: 0,
        maxAdvanceDays: 30,
        holidays: [],
        calendarMode: "simulated",
        updatedAt: NOW.toISOString(),
      },
      from: new Date("2026-07-06T11:30:00.000Z"),
      until: new Date("2026-07-06T13:00:00.000Z"),
      durationMinutes: 60,
      bufferMinutes: 0,
      appointments: [],
      externalBusy: [],
      now: new Date("2026-07-06T11:00:00.000Z"),
    });
    assert.equal(summer[0]?.startAt, "2026-07-06T12:00:00.000Z");
  });

  it("applies holidays, service duration and buffer", async () => {
    const { service } = setup();
    const rules = await service.getRules("org-a");
    rules.holidays = ["2026-10-20"];
    await service.saveRules(rules);
    const services = await service.listServices("org-a");
    const drain = services.find((row) => row.durationMinutes === 30);
    assert.ok(drain);
    const booked = await service.book({
      organizationId: "org-a",
      serviceId: drain.id,
      startAt: MONDAY_10,
      customerName: "Test Customer A",
      customerPhoneE164: "+15145550100",
      source: "simulation",
    });
    assert.equal(booked.confirmed, true);
    assert.equal(booked.appointment?.endAt, "2026-10-19T14:30:00.000Z");
    const later = await service.availability({
      organizationId: "org-a",
      from: "2026-10-19T14:00:00.000Z",
      until: "2026-10-19T17:00:00.000Z",
    });
    assert.equal(later.slots.some((slot) => slot.startAt === "2026-10-19T14:30:00.000Z"), false);
    const holiday = await service.availability({
      organizationId: "org-a",
      from: "2026-10-20T13:00:00.000Z",
      until: "2026-10-20T18:00:00.000Z",
    });
    assert.equal(holiday.slots.length, 0);
  });

  it("confirms only after reservation and ignores a repeated idempotency key", async () => {
    const { service, notices } = setup();
    const first = await service.book({
      organizationId: "org-a",
      startAt: MONDAY_10,
      customerName: "John Smith",
      customerPhoneE164: "+15145550101",
      serviceAddress: "123 Example Street",
      idempotencyKey: "book-1",
      source: "ai_receptionist",
    });
    assert.equal(first.confirmed, true);
    assert.equal(notices.length, 1);
    const second = await service.book({
      organizationId: "org-a",
      startAt: MONDAY_10,
      customerName: "John Smith",
      idempotencyKey: "book-1",
      source: "ai_receptionist",
    });
    assert.equal(second.appointment?.id, first.appointment?.id);
    const rows = await service.list("org-a");
    assert.equal(rows.filter((row) => row.status === "confirmed").length, 1);
  });

  it("does not double-book a technician when two requests arrive together", async () => {
    const { service } = setup();
    const [a, b] = await Promise.all([
      service.book({
        organizationId: "org-a",
        startAt: MONDAY_10,
        customerName: "Customer A",
        source: "ai_receptionist",
      }),
      service.book({
        organizationId: "org-a",
        startAt: MONDAY_10,
        customerName: "Customer B",
        source: "ai_receptionist",
      }),
    ]);
    const confirmed = [a, b].filter((result) => result.confirmed);
    assert.equal(confirmed.length, 1);
    assert.equal([a, b].some((result) => result.confirmed === false), true);
  });

  it("adds travel time between different addresses", async () => {
    const { service } = setup();
    const first = await service.book({
      organizationId: "org-a",
      startAt: MONDAY_10,
      serviceAddress: "10 Rue A",
      customerName: "A",
      source: "dashboard",
    });
    assert.equal(first.confirmed, true);
    const near = await service.availability({
      organizationId: "org-a",
      from: "2026-10-19T15:00:00.000Z",
      until: "2026-10-19T16:30:00.000Z",
      serviceAddress: "900 Rue B",
    });
    assert.equal(near.slots.some((slot) => slot.startAt === "2026-10-19T15:30:00.000Z"), false);
  });

  it("reschedules the same record and refuses a taken time", async () => {
    const { service } = setup();
    const original = await service.book({
      organizationId: "org-a",
      startAt: MONDAY_10,
      customerName: "A",
      source: "dashboard",
    });
    const other = await service.book({
      organizationId: "org-a",
      startAt: "2026-10-19T16:00:00.000Z",
      customerName: "B",
      source: "dashboard",
    });
    assert.equal(other.confirmed, true);
    const blocked = await service.reschedule("org-a", original.appointment!.id, "2026-10-19T16:00:00.000Z");
    assert.equal(blocked.ok, false);
    assert.equal(blocked.appointment?.startAt, MONDAY_10);
    const moved = await service.reschedule("org-a", original.appointment!.id, "2026-10-19T18:00:00.000Z");
    assert.equal(moved.ok, true);
    assert.equal(moved.appointment?.id, original.appointment?.id);
    assert.equal(moved.appointment?.startAt, "2026-10-19T18:00:00.000Z");
  });

  it("does not report a move when the calendar update fails", async () => {
    let failUpdate = false;
    const port: CalendarPort = {
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
        return failUpdate ? { error: "calendar_unavailable" } : { ok: true as const };
      },
      async deleteEvent() {
        return { ok: true as const };
      },
    };
    const { service } = setup(port);
    const booked = await service.book({
      organizationId: "org-a",
      startAt: MONDAY_10,
      customerName: "A",
      source: "dashboard",
    });
    failUpdate = true;
    const moved = await service.reschedule("org-a", booked.appointment!.id, "2026-10-19T18:00:00.000Z");
    assert.equal(moved.ok, false);
    assert.equal(moved.reason, "calendar_error");
    assert.equal(moved.appointment?.startAt, MONDAY_10);
  });

  it("cancels the booking, stops reminders and keeps history", async () => {
    const { service, canceled } = setup();
    const booked = await service.book({
      organizationId: "org-a",
      startAt: MONDAY_10,
      customerName: "A",
      customerPhoneE164: "+15145550102",
      source: "dashboard",
    });
    const result = await service.cancel("org-a", booked.appointment!.id, "customer asked");
    assert.equal(result.ok, true);
    assert.equal(result.appointment?.status, "canceled");
    assert.deepEqual(canceled, [booked.appointment!.id]);
    const detail = await service.get("org-a", booked.appointment!.id);
    assert.equal(detail.history.some((event) => event.kind === "canceled"), true);
    const again = await service.book({
      organizationId: "org-a",
      startAt: MONDAY_10,
      customerName: "B",
      source: "dashboard",
    });
    assert.equal(again.confirmed, true);
  });

  it("does not confirm when Google Calendar is disconnected", async () => {
    const port: CalendarPort = {
      kind: "google",
      connected: false,
      externalCalls: 0,
      async freeBusy() {
        return [];
      },
      async createEvent() {
        port.externalCalls += 1;
        return { error: "no" };
      },
      async updateEvent() {
        return { error: "no" };
      },
      async deleteEvent() {
        return { error: "no" };
      },
    };
    const { service } = setup(port);
    const rules = await service.getRules("org-a");
    rules.calendarMode = "google";
    await service.saveRules(rules);
    const result = await service.book({
      organizationId: "org-a",
      startAt: MONDAY_10,
      customerName: "A",
      source: "ai_receptionist",
    });
    assert.equal(result.confirmed, false);
    assert.equal(result.reason, "calendar_unavailable");
    assert.equal(port.externalCalls, 0);
  });

  it("rolls back a confirmation when calendar creation fails and never calls a real provider in simulation", async () => {
    const google: CalendarPort = {
      kind: "google",
      connected: true,
      externalCalls: 0,
      async freeBusy() {
        return [];
      },
      async createEvent() {
        google.externalCalls += 1;
        return { error: "calendar_unavailable" };
      },
      async updateEvent() {
        return { error: "calendar_unavailable" };
      },
      async deleteEvent() {
        return { error: "calendar_unavailable" };
      },
    };
    const { service } = setup(google);
    const rules = await service.getRules("org-a");
    rules.calendarMode = "google";
    await service.saveRules(rules);
    const failed = await service.book({
      organizationId: "org-a",
      startAt: MONDAY_10,
      customerName: "A",
      source: "dashboard",
    });
    assert.equal(failed.confirmed, false);
    assert.equal(failed.reason, "calendar_error");
    assert.equal(google.externalCalls, 1);
    const simulated = await service.book({
      organizationId: "org-a",
      startAt: "2026-10-19T18:00:00.000Z",
      customerName: "Sim",
      source: "simulation",
      simulated: true,
    });
    assert.equal(simulated.confirmed, true);
    assert.equal(google.externalCalls, 1);
  });

  it("keeps two businesses isolated and hides tokens from status", async () => {
    const { service, store } = setup();
    await service.book({
      organizationId: "org-a",
      startAt: MONDAY_10,
      customerName: "A",
      source: "dashboard",
    });
    const other = await service.list("org-b");
    assert.equal(other.length, 0);
    await store.saveConnection({
      organizationId: "org-a",
      provider: "google",
      status: "connected",
      calendarId: "cal-1",
      tokenCiphertext: encryptSecret(JSON.stringify({ accessToken: "secret-token" }), "test-secret"),
    });
    const status = await service.connectionStatus("org-a");
    assert.equal("tokenCiphertext" in status, false);
    assert.equal(JSON.stringify(status).includes("secret-token"), false);
    assert.equal(decryptSecret(
      (await store.getConnection("org-a"))!.tokenCiphertext!,
      "test-secret",
    ).includes("secret-token"), true);
  });

  it("asks for approval instead of promising an emergency visit", async () => {
    const { service } = setup();
    const services = await service.listServices("org-a");
    const emergency = services.find((row) => row.bookingMode === "escalate");
    const result = await service.book({
      organizationId: "org-a",
      serviceId: emergency!.id,
      startAt: MONDAY_10,
      customerName: "A",
      source: "ai_receptionist",
    });
    assert.equal(result.confirmed, false);
    assert.equal(result.reason, "escalate");
    assert.equal(result.appointment?.appointmentKind, "request");
  });
});

describe("crew calendars (technicians)", () => {
  it("creates a new technician and later updates it by id", async () => {
    const { service } = setup();
    const created = await service.upsertTechnician({
      organizationId: "org-a",
      name: "  Alex Tran  ",
      serviceArea: "Laval",
    });
    assert.equal(created.name, "Alex Tran");
    assert.equal(created.active, true);
    const updated = await service.upsertTechnician({
      id: created.id,
      organizationId: "org-a",
      name: "Alex Tran",
      active: false,
    });
    assert.equal(updated.id, created.id);
    assert.equal(updated.active, false);
    const all = await service.listTechnicians("org-a");
    assert.equal(all.filter((t) => t.id === created.id).length, 1);
  });

  it("refuses an empty name", async () => {
    const { service } = setup();
    await assert.rejects(() =>
      service.upsertTechnician({ organizationId: "org-a", name: "   " }),
    );
  });

  it("refuses to edit another organization's technician by id", async () => {
    const { service } = setup();
    const theirs = await service.upsertTechnician({
      organizationId: "org-b",
      name: "Their tech",
    });
    await assert.rejects(() =>
      service.upsertTechnician({
        id: theirs.id,
        organizationId: "org-a",
        name: "Renamed by someone else",
      }),
    );
    const stillTheirs = await service.listTechnicians("org-b");
    assert.equal(stillTheirs[0].name, "Their tech");
  });
});
