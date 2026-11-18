/**
 * KAN-19 at the HTTP boundary: the real route handlers, a real session cookie,
 * and the real scheduling SQL (schema.sql) running on PGlite.
 *
 *   CAL-01  the list carries the business zone and hours
 *   CAL-05  a created appointment comes back in the response and in the list
 *   CAL-08  the data survives a "refresh" (fresh process state) and a re-login
 *   CAL-12  rapid repeated submissions: one row in the database
 *   CAL-13  a database failure is a clear error, never a success, never a row
 *   CAL-14  another business, a lower plan and a missing session are all refused
 *   + the legacy /api/app/bookings route no longer writes to a table the
 *     calendar does not read, and the demo seed is visible in the calendar.
 *
 * PGlite has one connection: true cross-connection lock contention is not
 * exercised here (the advisory lock is the same SQL the other suites use).
 */
import "../support/next-request-context";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { withRequest } from "../support/next-request-context";
import { createPglite, pgliteAvailable, poolOf, type PgliteDb } from "../support/pglite-pool";
import { GET as listGET, POST as createPOST } from "../../src/app/api/businesses/[id]/appointments/route";
import {
  GET as detailGET,
  PATCH as detailPATCH,
} from "../../src/app/api/businesses/[id]/appointments/[appointmentId]/route";
import { POST as cancelPOST } from "../../src/app/api/businesses/[id]/appointments/[appointmentId]/cancel/route";
import { POST as reschedulePOST } from "../../src/app/api/businesses/[id]/appointments/[appointmentId]/reschedule/route";
import {
  GET as availabilityGET,
  PUT as availabilityPUT,
} from "../../src/app/api/businesses/[id]/availability/route";
import { PATCH as orgPATCH } from "../../src/app/api/businesses/[id]/route";
import { GET as legacyGET, POST as legacyPOST } from "../../src/app/api/app/bookings/route";
import { setPgPoolForTests } from "../../src/product/missed-call/postgres-store";
import { signSessionClaims } from "../../src/product/saas/auth/session-token";
import type { PlanId } from "../../src/product/saas/entitlements";
import { createMemorySaasStore } from "../../src/product/saas/memory-store";
import type { SaasStore } from "../../src/product/saas/store";
import { createPostgresSchedulingStore } from "../../src/product/scheduling/postgres-store";
import type { SchedulingStore } from "../../src/product/scheduling/store";

const SECRET = "appointment-calendar-unit-secret-not-for-production";
const BASE = "https://tradecatch.test";
const runtime = globalThis as typeof globalThis & {
  __tradecatchSaas?: { store: SaasStore; durable: boolean };
  __tradecatchScheduling?: { store: SchedulingStore; durable: boolean };
};
const saved = new Map(["AUTH_SECRET", "NODE_ENV"].map((name) => [name, process.env[name]]));

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const available = pgliteAvailable();

describe("KAN-19 appointment calendar API (PGlite)", { skip: !available && "PGlite is not installed" }, () => {
  let db: PgliteDb;
  let pool: ReturnType<typeof poolOf>;
  let saas: SaasStore;

  before(async () => {
    db = await createPglite();
    await db.exec(`
      CREATE TABLE mc_schema_migrations (id TEXT PRIMARY KEY);
      CREATE TABLE tc_organizations (id TEXT PRIMARY KEY);
    `);
    await db.exec(readFileSync(path.join(process.cwd(), "src", "product", "scheduling", "schema.sql"), "utf8"));
    pool = poolOf(db);
  });
  after(async () => {
    setPgPoolForTests(null);
    await db.close();
  });

  function bootRuntime() {
    setPgPoolForTests(pool);
    runtime.__tradecatchScheduling = {
      store: createPostgresSchedulingStore("postgres://pglite.test/calendar"),
      durable: true,
    };
  }

  beforeEach(() => {
    process.env.AUTH_SECRET = SECRET;
    (process.env as { NODE_ENV?: string }).NODE_ENV = "development";
    saas = createMemorySaasStore();
    runtime.__tradecatchSaas = { store: saas, durable: false };
    bootRuntime();
    mock.method(console, "warn", () => {});
    mock.method(console, "error", () => {});
  });
  afterEach(() => {
    mock.restoreAll();
    delete runtime.__tradecatchSaas;
    delete runtime.__tradecatchScheduling;
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  /** A business with an owner, a plan and a signed session cookie. */
  async function business(plan: PlanId = "professional", timezone = "America/Vancouver") {
    const made = await saas.createOrganizationWithOwner({
      name: "Calendar fixture",
      ownerName: "Owner",
      ownerEmail: `${crypto.randomUUID()}@example.test`,
      timezone,
    });
    await saas.updateOrganizationPlan(made.organization.id, plan);
    await db.query("INSERT INTO tc_organizations (id) VALUES ($1) ON CONFLICT DO NOTHING", [made.organization.id]);
    return { id: made.organization.id, login: () => loginAs(made.organization.id, made.user.id, plan) };
  }

  async function loginAs(organizationId: string, userId: string, plan: PlanId) {
    const session = {
      id: crypto.randomUUID(),
      organizationId,
      userId,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    await saas.createSession(session);
    const cookie = await signSessionClaims(
      { sid: session.id, uid: userId, oid: organizationId, plan, exp: Math.floor(Date.now() / 1000) + 600 },
      SECRET,
    );
    return `tc_session=${cookie}`;
  }

  // Route handlers take their own `{ params }` shape; the helper hands each one the params it asks for.
  type Handler = (request: NextRequest, ctx: never) => Promise<Response>;
  function call(
    handler: Handler,
    cookie: string | null,
    urlPath: string,
    params: Json,
    method = "GET",
    body?: unknown,
  ): Promise<Response> {
    const request = new NextRequest(`${BASE}${urlPath}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return withRequest(request, () =>
      handler(request, { params: Promise.resolve(params) } as never),
    );
  }

  const base = (id: string) => `/api/businesses/${id}/appointments`;
  const list = (cookie: string | null, id: string, query = "") =>
    call(listGET, cookie, `${base(id)}${query}`, { id });
  const create = (cookie: string | null, id: string, body: object) =>
    call(createPOST, cookie, base(id), { id }, "POST", body);

  /** The first two free times the availability API offers, on different days. */
  async function twoFreeTimes(cookie: string, id: string) {
    const found: string[] = [];
    const now = new Date();
    for (let month = 0; month < 3 && found.length < 4; month += 1) {
      const probe = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + month, 1));
      const ym = `${probe.getUTCFullYear()}-${String(probe.getUTCMonth() + 1).padStart(2, "0")}`;
      const res = await call(availabilityGET, cookie, `/api/businesses/${id}/availability?month=${ym}`, { id });
      assert.equal(res.status, 200);
      const data = (await res.json()) as Json;
      for (const day of Object.keys(data.days).sort()) {
        const times = data.days[day] as { startAt: string }[];
        // Mid-morning, so the second time of the day is far from the first.
        if (times.length > 6) found.push(times[1]!.startAt, times[5]!.startAt);
        if (found.length >= 4) break;
      }
    }
    assert.ok(found.length >= 4, "the availability API offers times");
    return found;
  }

  /* ------------------------------------------------------------------------ */

  it("CAL-01 the list reports the business's own timezone and hours, so it never guesses from the browser", async () => {
    const biz = await business("professional", "America/Vancouver");
    const cookie = await biz.login();
    const res = await list(cookie, biz.id);
    assert.equal(res.status, 200);
    const data = (await res.json()) as Json;
    assert.equal(data.timezone, "America/Vancouver", "seeded from the organization, not Toronto");
    assert.equal(data.hours["1"].open, "08:00");
    assert.equal(data.hours["0"], null, "Sunday is closed");
    assert.deepEqual(data.appointments, []);
  });

  it("CAL-05 a created appointment is returned at once and listed after", async () => {
    const biz = await business();
    const cookie = await biz.login();
    const [first] = await twoFreeTimes(cookie, biz.id);
    const res = await create(cookie, biz.id, {
      startAt: first,
      customerName: "Calendar Customer",
      customerPhoneE164: "514-555-0123",
      idempotencyKey: "cal-05",
    });
    assert.equal(res.status, 201);
    const created = (await res.json()) as Json;
    assert.equal(created.confirmed, true);
    assert.equal(created.appointment.startAt, first);
    assert.equal(created.appointment.timezone, "America/Vancouver");
    assert.equal(created.appointment.customerPhoneE164, "+15145550123");
    const listed = (await (await list(cookie, biz.id)).json()) as Json;
    assert.equal(listed.appointments.length, 1);
    assert.equal(listed.appointments[0].id, created.appointment.id);
  });

  it("CAL-05 a start time with no offset is a 400, not a guess", async () => {
    const biz = await business();
    const cookie = await biz.login();
    const res = await create(cookie, biz.id, { startAt: "2026-12-01T10:00", customerName: "Naive" });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as Json).code, "invalid_start");
  });

  it("CAL-01 the list can be asked for one window, and refuses a backwards one", async () => {
    const biz = await business();
    const cookie = await biz.login();
    const [first, , second] = await twoFreeTimes(cookie, biz.id);
    await create(cookie, biz.id, { startAt: first, customerName: "One", idempotencyKey: "w1" });
    await create(cookie, biz.id, { startAt: second, customerName: "Two", idempotencyKey: "w2" });
    const day = (iso: string) => ({ from: new Date(Date.parse(iso) - 3_600_000), to: new Date(Date.parse(iso) + 3_600_000) });
    const win = day(first!);
    const only = (await (await list(cookie, biz.id, `?from=${encodeURIComponent(win.from.toISOString())}&to=${encodeURIComponent(win.to.toISOString())}`)).json()) as Json;
    assert.deepEqual(only.appointments.map((row: Json) => row.customerName), ["One"]);
    const backwards = await list(cookie, biz.id, `?from=${encodeURIComponent(win.to.toISOString())}&to=${encodeURIComponent(win.from.toISOString())}`);
    assert.equal(backwards.status, 400);
    assert.equal(((await backwards.json()) as Json).code, "invalid_range");
    const naive = await list(cookie, biz.id, "?from=2026-12-01&to=2026-12-02");
    assert.equal(naive.status, 400);
  });

  it("CAL-08 appointments survive a refresh and a fresh login, at the same instant", async () => {
    const biz = await business();
    const cookie = await biz.login();
    const [first, second] = await twoFreeTimes(cookie, biz.id);
    const a = (await (await create(cookie, biz.id, { startAt: first, customerName: "Persisted", idempotencyKey: "p1" })).json()) as Json;
    const b = (await (await create(cookie, biz.id, { startAt: second, customerName: "Persisted Too", idempotencyKey: "p2" })).json()) as Json;
    const before = (await (await list(cookie, biz.id)).json()) as Json;

    // "Refresh": the server process forgets everything it held in memory.
    delete runtime.__tradecatchScheduling;
    bootRuntime();
    // "Logout and login": a brand new session for the same person.
    const again = await biz.login();
    assert.notEqual(again, cookie);
    const after = (await (await list(again, biz.id)).json()) as Json;

    assert.deepEqual(
      after.appointments.map((row: Json) => [row.id, row.startAt, row.endAt, row.status, row.timezone]),
      before.appointments.map((row: Json) => [row.id, row.startAt, row.endAt, row.status, row.timezone]),
    );
    assert.deepEqual(
      new Set(after.appointments.map((row: Json) => row.id)),
      new Set([a.appointment.id, b.appointment.id]),
    );
    const stored = await db.query("SELECT start_at FROM tc_schedule_appointments WHERE id = $1", [a.appointment.id]);
    assert.equal(new Date(String(stored.rows[0]!.start_at)).toISOString(), first, "stored as the UTC instant that was booked");
  });

  it("CAL-06 / CAL-07 edit, move and cancel go through the API and show in the next list", async () => {
    const biz = await business();
    const cookie = await biz.login();
    const [first, second] = await twoFreeTimes(cookie, biz.id);
    const made = (await (await create(cookie, biz.id, { startAt: first, customerName: "Before", idempotencyKey: "e1" })).json()) as Json;
    const id = made.appointment.id as string;
    const item = { id, appointmentId: id };

    const edited = await call(detailPATCH, cookie, `${base(biz.id)}/${id}`, { id: biz.id, appointmentId: id }, "PATCH", {
      customerName: "After",
      customerPhoneE164: "(604) 555-0142",
      serviceAddress: "1 Granville St",
    });
    assert.equal(edited.status, 200);
    const editedRow = ((await edited.json()) as Json).appointment;
    assert.equal(editedRow.customerName, "After");
    assert.equal(editedRow.customerPhoneE164, "+16045550142");

    const badPhone = await call(detailPATCH, cookie, `${base(biz.id)}/${id}`, { id: biz.id, appointmentId: id }, "PATCH", {
      customerPhoneE164: "not a phone",
    });
    assert.equal(badPhone.status, 400);
    assert.equal(((await badPhone.json()) as Json).code, "invalid_phone");

    const moved = await call(reschedulePOST, cookie, `${base(biz.id)}/${id}/reschedule`, { id: biz.id, appointmentId: id }, "POST", { startAt: second });
    assert.equal(moved.status, 200);
    assert.equal(((await moved.json()) as Json).appointment.startAt, second);
    const naive = await call(reschedulePOST, cookie, `${base(biz.id)}/${id}/reschedule`, { id: biz.id, appointmentId: id }, "POST", { startAt: "2026-12-01T10:00" });
    assert.equal(naive.status, 400);

    const canceled = await call(cancelPOST, cookie, `${base(biz.id)}/${id}/cancel`, { id: biz.id, appointmentId: id }, "POST", { reason: "Changed mind" });
    assert.equal(canceled.status, 200);
    const row = ((await (await list(cookie, biz.id)).json()) as Json).appointments.find((r: Json) => r.id === item.id);
    assert.equal(row.status, "canceled");
    assert.equal(row.customerName, "After");
    assert.equal(row.startAt, second);
    const detail = (await (await call(detailGET, cookie, `${base(biz.id)}/${id}`, { id: biz.id, appointmentId: id })).json()) as Json;
    assert.ok(detail.history.some((event: Json) => event.kind === "canceled"));
  });

  it("CAL-12 ten identical submissions leave exactly one row in the database", async () => {
    const biz = await business();
    const cookie = await biz.login();
    const [first] = await twoFreeTimes(cookie, biz.id);
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        create(cookie, biz.id, { startAt: first, customerName: "Double Click", idempotencyKey: "same-attempt" }),
      ),
    );
    const bodies = (await Promise.all(responses.map((res) => res.json()))) as Json[];
    assert.ok(responses.every((res) => res.status === 201 || res.status === 200), responses.map((res) => res.status).join());
    assert.equal(new Set(bodies.map((body) => body.appointment.id)).size, 1);
    const rows = await db.query(
      "SELECT count(*)::int AS n FROM tc_schedule_appointments WHERE organization_id = $1 AND status <> 'canceled'",
      [biz.id],
    );
    assert.equal(rows.rows[0]!.n, 1);
  });

  it("CAL-12 two different people picking the same time: one is told the time is gone", async () => {
    const biz = await business();
    const cookie = await biz.login();
    const [first] = await twoFreeTimes(cookie, biz.id);
    const [a, b] = await Promise.all([
      create(cookie, biz.id, { startAt: first, customerName: "A", idempotencyKey: "who-a" }),
      create(cookie, biz.id, { startAt: first, customerName: "B", idempotencyKey: "who-b" }),
    ]);
    // The default technician is a single person, so the second booking cannot also be confirmed.
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [201, 409]);
    const loser = (a.status === 409 ? a : b) as Response;
    assert.match(((await loser.json()) as Json).error, /no longer available/i);
  });

  it("CAL-13 a database failure on save is an error with no success, and nothing is stored", async () => {
    const biz = await business();
    const cookie = await biz.login();
    const [first] = await twoFreeTimes(cookie, biz.id);
    pool.failNext?.(/INSERT INTO tc_schedule_appointments/);
    const res = await create(cookie, biz.id, { startAt: first, customerName: "Outage", idempotencyKey: "fail-1" });
    assert.ok(res.status >= 500, `got ${res.status}`);
    const body = (await res.json()) as Json;
    assert.notEqual(body.ok, true);
    assert.notEqual(body.confirmed, true);
    assert.ok(typeof body.error === "string" && body.error.length > 0, "says what happened");
    assert.equal(JSON.stringify(body).includes("simulated database failure"), false, "no internals leak");
    const rows = await db.query("SELECT count(*)::int AS n FROM tc_schedule_appointments WHERE organization_id = $1 AND status = 'confirmed'", [biz.id]);
    assert.equal(rows.rows[0]!.n, 0);
    // And the same request, retried once the database is back, simply works.
    const retry = await create(cookie, biz.id, { startAt: first, customerName: "Outage", idempotencyKey: "fail-1" });
    assert.equal(retry.status, 201);
  });

  it("CAL-13 a database failure on read is an error, not an empty calendar", async () => {
    const biz = await business();
    const cookie = await biz.login();
    pool.failNext?.(/FROM tc_schedule_appointments/);
    const res = await list(cookie, biz.id);
    assert.ok(res.status >= 500, `got ${res.status}`);
    const body = (await res.json()) as Json;
    assert.equal(body.appointments, undefined, "an outage is never shown as 'no appointments'");
    assert.ok(typeof body.error === "string");
  });

  it("CAL-14 another business can neither read nor change this business's appointments", async () => {
    const mine = await business();
    const theirs = await business();
    const myCookie = await mine.login();
    const theirCookie = await theirs.login();
    const [first, second] = await twoFreeTimes(myCookie, mine.id);
    const made = (await (await create(myCookie, mine.id, { startAt: first, customerName: "Private", idempotencyKey: "iso" })).json()) as Json;
    const id = made.appointment.id as string;

    // Using their own session against my business id.
    assert.equal((await list(theirCookie, mine.id)).status, 403);
    assert.equal((await create(theirCookie, mine.id, { startAt: second, customerName: "Intruder" })).status, 403);
    assert.equal((await call(detailGET, theirCookie, `${base(mine.id)}/${id}`, { id: mine.id, appointmentId: id })).status, 403);
    assert.equal((await call(detailPATCH, theirCookie, `${base(mine.id)}/${id}`, { id: mine.id, appointmentId: id }, "PATCH", { customerName: "Hacked" })).status, 403);
    assert.equal((await call(cancelPOST, theirCookie, `${base(mine.id)}/${id}/cancel`, { id: mine.id, appointmentId: id }, "POST", {})).status, 403);
    assert.equal((await call(reschedulePOST, theirCookie, `${base(mine.id)}/${id}/reschedule`, { id: mine.id, appointmentId: id }, "POST", { startAt: second })).status, 403);

    // Using their own business id with my appointment id.
    assert.equal((await call(detailGET, theirCookie, `${base(theirs.id)}/${id}`, { id: theirs.id, appointmentId: id })).status, 404);
    assert.equal((await call(cancelPOST, theirCookie, `${base(theirs.id)}/${id}/cancel`, { id: theirs.id, appointmentId: id }, "POST", {})).status, 404);

    assert.deepEqual(((await (await list(theirCookie, theirs.id)).json()) as Json).appointments, []);
    const mineAfter = ((await (await list(myCookie, mine.id)).json()) as Json).appointments;
    assert.equal(mineAfter.length, 1);
    assert.equal(mineAfter[0].customerName, "Private");
    assert.equal(mineAfter[0].status, "confirmed");
  });

  it("CAL-14 the calendar needs the Professional plan and a session", async () => {
    const essential = await business("essential");
    const cookie = await essential.login();
    const refused = await list(cookie, essential.id);
    assert.equal(refused.status, 403);
    assert.match(((await refused.json()) as Json).error, /Professional/);
    assert.equal((await create(cookie, essential.id, { startAt: "2026-12-01T15:00:00Z", customerName: "x" })).status, 403);
    assert.ok([401, 403].includes((await list(null, essential.id)).status));
  });

  it("CAL-09 the business's zone is one setting: the profile and the hours screen move it together", async () => {
    const biz = await business("professional", "America/Vancouver");
    const cookie = await biz.login();
    const zoneOf = async () => ((await (await list(cookie, biz.id)).json()) as Json).timezone;
    assert.equal(await zoneOf(), "America/Vancouver");

    const patch = (timezone: string) =>
      call(orgPATCH, cookie, `/api/businesses/${biz.id}`, { id: biz.id }, "PATCH", { timezone });
    assert.equal((await patch("Mars/Olympus")).status, 400);
    assert.equal((await saas.getOrganization(biz.id))?.timezone, "America/Vancouver", "a bad zone is refused before anything is saved");

    assert.equal((await patch("America/Halifax")).status, 200);
    assert.equal(await zoneOf(), "America/Halifax", "the calendar follows the profile");

    const rulesRes = await call(availabilityGET, cookie, `/api/businesses/${biz.id}/availability`, { id: biz.id });
    const rules = ((await rulesRes.json()) as Json).rules;
    const put = await call(availabilityPUT, cookie, `/api/businesses/${biz.id}/availability`, { id: biz.id }, "PUT", {
      ...rules,
      timezone: "America/Edmonton",
    });
    assert.equal(put.status, 200);
    assert.equal((await saas.getOrganization(biz.id))?.timezone, "America/Edmonton", "the profile follows the hours screen");
  });

  it("CAL-05 a malformed slot query is a 400, not a crash", async () => {
    const biz = await business();
    const cookie = await biz.login();
    const res = await call(availabilityGET, cookie, `/api/businesses/${biz.id}/availability?slots=1&from=tomorrow`, { id: biz.id });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as Json).code, "invalid_start");
  });

  it("CAL-14 a save that names another business's appointment id changes nothing", async () => {
    const mine = await business();
    const theirs = await business();
    const store = runtime.__tradecatchScheduling!.store;
    const now = new Date().toISOString();
    const row = {
      id: "appt_tenant_guard",
      organizationId: mine.id,
      customerName: "Mine",
      serviceName: "Visit",
      startAt: "2030-03-04T15:00:00.000Z",
      endAt: "2030-03-04T16:00:00.000Z",
      timezone: "America/Vancouver",
      status: "confirmed" as const,
      bookingSource: "dashboard" as const,
      appointmentKind: "job" as const,
      simulated: false,
      createdAt: now,
      updatedAt: now,
    };
    await store.saveAppointment(row);
    await store.saveAppointment({ ...row, organizationId: theirs.id, customerName: "Hijacked", status: "canceled" });
    const stored = await db.query("SELECT organization_id, customer_name, status FROM tc_schedule_appointments WHERE id = $1", [row.id]);
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0]!.organization_id, mine.id);
    assert.equal(stored.rows[0]!.customer_name, "Mine");
    assert.equal(stored.rows[0]!.status, "confirmed");
  });

  it("the legacy bookings route writes to the calendar everyone reads, under the same rules", async () => {
    const biz = await business();
    const cookie = await biz.login();
    const [first] = await twoFreeTimes(cookie, biz.id);
    const post = (body: object) => call(legacyPOST, cookie, "/api/app/bookings", {}, "POST", body);

    // It used to save a row in a table the calendar never reads, with no rules at all.
    const made = await post({ title: "Furnace check", startsAt: first, customerName: "Legacy Customer" });
    assert.equal(made.status, 200);
    const seen = ((await (await list(cookie, biz.id)).json()) as Json).appointments;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].customerName, "Legacy Customer");
    assert.equal(seen[0].startAt, first);

    // The same time again is a conflict, like everywhere else.
    assert.equal((await post({ title: "Again", startsAt: first, customerName: "Other" })).status, 409);
    // A range that ends before it starts is refused.
    const backwards = await post({ title: "Backwards", startsAt: first, endsAt: new Date(Date.parse(first!) - 3_600_000).toISOString() });
    assert.equal(backwards.status, 400);
    // Outside the business's hours is refused, not saved.
    const night = await post({ title: "Night", startsAt: first!.replace(/T\d\d:/, "T10:") });
    assert.ok([409, 400].includes(night.status));

    const legacy = (await (await call(legacyGET, cookie, "/api/app/bookings", {})).json()) as Json;
    assert.equal(legacy.appointments.length, 1);
  });
});
