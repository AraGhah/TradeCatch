import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test, mock } from "node:test";
import { Pool } from "pg";
import { closePgPool } from "../../src/product/missed-call/postgres-store";
import { createPostgresSchedulingStore } from "../../src/product/scheduling/postgres-store";
import { createMemorySchedulingStore } from "../../src/product/scheduling/store";
import {
  createSchedulingService,
  createSimulatedCalendar,
} from "../../src/product/scheduling/service";
import { createGoogleCalendarPort } from "../../src/product/scheduling/google";

test("a reservation remains a hold until its calendar event is created", async () => {
  const store = createMemorySchedulingStore();
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  const gate = new Promise<void>((r) => (release = r));
  const port = {
    ...createSimulatedCalendar(),
    async createEvent() {
      entered();
      await gate;
      return { id: "test-event" };
    },
  };
  const service = createSchedulingService({
    store,
    now: () => new Date("2026-10-16T12:00:00Z"),
    calendar: async () => port,
  });
  const booking = service.book({
    organizationId: "org_hold",
    startAt: "2026-10-19T14:00:00Z",
    source: "ai_receptionist",
    idempotencyKey: "call-slot",
  });
  await started;
  try {
    const otherWorkerRead = await store.findByIdempotency(
      "org_hold",
      "call-slot",
    );
    assert.equal(otherWorkerRead?.status, "hold");
    assert.ok(otherWorkerRead?.holdExpiresAt);
  } finally {
    release();
  }
  const result = await booking;
  assert.equal(result.confirmed, true);
  assert.equal(result.appointment?.status, "confirmed");
  assert.equal(result.appointment?.calendarEventId, "test-event");
});

test("unknown calendar availability is never treated as a free calendar", async () => {
  const original = globalThis.fetch;
  try {
    for (const response of [
      Response.json({ error: "private detail" }, { status: 503 }),
      Response.json({
        calendars: { primary: { errors: [{ reason: "forbidden" }] } },
      }),
      Response.json({}),
    ]) {
      globalThis.fetch = async () => response;
      const port = createGoogleCalendarPort({
        tokens: {
          accessToken: "test",
          refreshToken: "test",
          expiresAt: "2099-01-01T00:00:00Z",
        },
        calendarId: "primary",
      });
      await assert.rejects(
        port.freeBusy("2026-10-19T12:00:00Z", "2026-10-19T16:00:00Z"),
        /availability/,
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("a calendar result after the phone deadline is canceled without confirming or sending a notice", async () => {
  const store = createMemorySchedulingStore(),
    actualNow = Date.now();
  const deleted: string[] = [];
  let notices = 0;
  const port = {
    ...createSimulatedCalendar(),
    async createEvent() {
      mock.method(Date, "now", () => actualNow + 20_000);
      return { id: "late-event" };
    },
    async deleteEvent(id: string) {
      deleted.push(id);
      return { ok: true as const };
    },
  };
  try {
    const service = createSchedulingService({
      store,
      now: () => new Date("2026-10-16T12:00:00Z"),
      calendar: async () => port,
      scheduleNotices: async () => {
        notices++;
      },
    });
    const result = await service.book({
      organizationId: "org_deadline",
      startAt: "2026-10-19T14:00:00Z",
      source: "ai_receptionist",
      deadlineAt: actualNow + 10_000,
    });
    assert.equal(result.confirmed, false);
    assert.equal(result.reason, "booking_timed_out");
    assert.deepEqual(deleted, ["late-event"]);
    assert.equal(notices, 0);
    assert.ok(
      (await store.listAppointments("org_deadline")).every(
        (a) => a.status !== "confirmed",
      ),
    );
  } finally {
    mock.restoreAll();
  }
});

const database = process.env.NOTIFICATION_TEST_DATABASE_URL;
test(
  "PostgreSQL atomically reserves one slot across concurrent workers and replays",
  { skip: !database },
  async () => {
    const url = new URL(database!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.ok(
      ["/tc003_staging", "/notifications_staging"].includes(url.pathname),
    );
    assert.equal(url.search, "");
    const schema = "booking_" + randomUUID().replaceAll("-", "");
    const admin = new Pool({ connectionString: database });
    const scopedUrl = `${database}?options=-c%20search_path%3D${schema}`;
    const sql = new Pool({ connectionString: scopedUrl });
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await sql.query(
        "CREATE TABLE tc_organizations(id TEXT PRIMARY KEY); CREATE TABLE mc_schema_migrations(id TEXT PRIMARY KEY)",
      );
      await sql.query(
        readFileSync("src/product/scheduling/schema.sql", "utf8"),
      );
      await sql.query(
        "INSERT INTO tc_organizations(id) VALUES ('booking_test')",
      );
      const stores = Array.from({ length: 12 }, () =>
        createPostgresSchedulingStore(scopedUrl),
      );
      const now = new Date().toISOString();
      const row = {
        id: "winner",
        organizationId: "booking_test",
        serviceName: "Test visit",
        startAt: "2099-01-05T14:00:00Z",
        endAt: "2099-01-05T15:00:00Z",
        timezone: "America/Toronto",
        status: "hold" as const,
        bookingSource: "simulation" as const,
        appointmentKind: "job" as const,
        simulated: true,
        holdExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        createdAt: now,
        updatedAt: now,
      };
      const results = await Promise.all(
        stores.map((s, i) =>
          s.insertIfFree(
            { ...row, id: `slot_${i}`, idempotencyKey: `caller_${i}` },
            30,
          ),
        ),
      );
      assert.equal(results.filter(Boolean).length, 1);
      const winner = results.find(Boolean)!;
      const replay = await stores[0].insertIfFree(
        { ...row, id: "replay", idempotencyKey: winner.idempotencyKey },
        30,
      );
      assert.equal(replay?.id, winner.id);
      assert.equal(replay?.status, "hold");
      assert.equal(
        (await stores[0].listAppointments("booking_test")).length,
        1,
      );
    } finally {
      await sql.end();
      await closePgPool();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  },
);
