/**
 * KAN-28 the admin incident endpoints: who may read an incident's history,
 * who may acknowledge or resolve one (MON-13), and what they get back. The
 * role matrix (read_only / support / super_admin) is covered by the RBAC
 * tests; here the wiring that applies it is checked.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getReliabilityService, resetReliabilityRuntimeForTests } from "../../src/product/reliability/runtime";

const OPS = "unit-test-ops-secret-0123456789abcdef";
const ops = { authorization: `Bearer ${OPS}`, "x-ops-actor": "alice" };
let saved: NodeJS.ProcessEnv;
const realLog = { error: console.error, warn: console.warn, info: console.info, log: console.log };

beforeEach(() => {
  saved = { ...process.env };
  for (const key of ["DATABASE_URL", "MISSED_CALL_DURABLE_STORE", "SAAS_DURABLE_STORE"]) delete process.env[key];
  process.env.MISSED_CALL_OPS_SECRET = OPS;
  resetReliabilityRuntimeForTests();
  console.error = console.warn = console.info = console.log = () => undefined;
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  resetReliabilityRuntimeForTests();
  Object.assign(console, realLog);
});

async function openIncident() {
  const service = getReliabilityService();
  const { incident } = await service.reportIncident({
    fingerprint: "stripe:webhook_failures",
    service: "stripe",
    category: "webhook_failures",
    priority: "high",
    title: "Stripe webhooks are failing",
    quietMs: 60_000,
    correlationId: "corr_1",
    simulated: false,
  });
  return incident;
}

const url = (path: string) => `http://localhost${path}`;
type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
async function call(file: "detail" | "acknowledge" | "resolve", id: string, headers: Record<string, string>, method = file === "detail" ? "GET" : "POST") {
  const route =
    file === "detail"
      ? await import("../../src/app/api/admin/incidents/[id]/route")
      : file === "acknowledge"
        ? await import("../../src/app/api/admin/incidents/[id]/acknowledge/route")
        : await import("../../src/app/api/admin/incidents/[id]/resolve/route");
  const handler = (method === "GET" ? (route as { GET: Handler }).GET : (route as { POST: Handler }).POST);
  const suffix = file === "detail" ? "" : `/${file}`;
  return handler(new Request(url(`/api/admin/incidents/${id}${suffix}`), { method, headers }), { params: Promise.resolve({ id }) });
}

describe("MON-13 unauthorized access is denied", () => {
  // A request with no administrator credentials reaches Next's cookies(), which
  // only works inside a real request, so the rejection itself is exercised
  // against a running server in tests/admin-dashboard.spec.ts (ADM-15). What a
  // unit test can and does pin down is that the guard runs first, with the right
  // permission, before any incident data is read or changed.
  const route = (path: string) => readFileSync(join(process.cwd(), "src", "app", "api", "admin", "incidents", path), "utf8");

  it("applies the right permission to each route (changes need admin.manage, reads admin.read)", () => {
    assert.match(route("[id]/acknowledge/route.ts"), /guardAdmin\(\s*request,\s*"admin\.manage"\s*\)/);
    assert.match(route("[id]/resolve/route.ts"), /guardAdmin\(\s*request,\s*"admin\.manage"\s*\)/);
    assert.match(route("[id]/route.ts"), /guardAdmin\(\s*request,\s*"admin\.read"\s*\)/);
  });

  it("checks access before touching the reliability service", () => {
    for (const file of ["[id]/route.ts", "[id]/acknowledge/route.ts", "[id]/resolve/route.ts"]) {
      const text = route(file);
      const guard = text.indexOf("guardAdmin(");
      const service = text.indexOf("getReliabilityService()");
      assert.ok(guard !== -1 && service !== -1 && guard < service, file);
      assert.match(text.slice(guard, service), /if \(!guard\.ok\) return guard\.response/, file);
    }
  });

  it("blocks a cross-site request that rides on a sign-in cookie to change an incident", async () => {
    const incident = await openIncident();
    const res = await call("acknowledge", incident.id, {
      cookie: "tc_admin=forged-for-this-test",
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example",
    });
    assert.equal(res.status, 403);
    assert.equal((await getReliabilityService().incidentDetail(incident.id))?.incident.status, "open");
  });
});

describe("incident detail", () => {
  it("returns the incident with its history, alert deliveries and the errors behind it", async () => {
    const incident = await openIncident();
    const res = await call("detail", incident.id, ops);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      incident: { id: string };
      events: { kind: string }[];
      deliveries: unknown[];
      errors: unknown[];
    };
    assert.equal(body.ok, true);
    assert.equal(body.incident.id, incident.id);
    assert.ok(Array.isArray(body.events) && body.events.some((e) => e.kind === "opened"));
    assert.ok(Array.isArray(body.deliveries));
    assert.ok(Array.isArray(body.errors));
  });

  it("answers 404 for an incident that does not exist", async () => {
    assert.equal((await call("detail", "inc_missing", ops)).status, 404);
  });

  it("never returns credentials, payment data or customer contact details, even if a failure's detail contained them", async () => {
    const service = getReliabilityService();
    for (let i = 0; i < 3; i += 1)
      await service.recordError({
        service: "stripe",
        operation: "webhook.invoice.payment_failed",
        errorCode: "sync_failed",
        severity: "high",
        retryable: true,
        detail: "failed for owner@example.com card 4242 4242 4242 4242 sk_live_abcdef123456 Bearer abc.def.ghi",
      });
    const [incident] = await service.listIncidents();
    const text = await (await call("detail", incident.id, ops)).text();
    for (const secret of ["owner@example.com", "4242 4242", "sk_live_abcdef", "abc.def.ghi"])
      assert.equal(text.includes(secret), false, `${secret} leaked`);
  });
});

describe("acknowledging and resolving", () => {
  it("acknowledges an active incident, and records who did it", async () => {
    const incident = await openIncident();
    const res = await call("acknowledge", incident.id, ops);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { incident: { status: string } }).incident.status, "investigating");
    const detail = await getReliabilityService().incidentDetail(incident.id);
    const event = detail?.events.find((e) => e.kind === "acknowledged");
    assert.equal(event?.actor, "ops:alice", "the person, not just 'ops'");
    assert.equal(detail?.incident.acknowledgedBy, "ops:alice");
  });

  it("acknowledging twice is harmless", async () => {
    const incident = await openIncident();
    await call("acknowledge", incident.id, ops);
    assert.equal((await call("acknowledge", incident.id, ops)).status, 200);
    const events = (await getReliabilityService().incidentDetail(incident.id))?.events.filter((e) => e.kind === "acknowledged");
    assert.equal(events?.length, 1);
  });

  it("answers 404 for an unknown incident and 409 for one that is already resolved", async () => {
    assert.equal((await call("acknowledge", "inc_missing", ops)).status, 404);
    const incident = await openIncident();
    await call("resolve", incident.id, ops);
    assert.equal((await call("acknowledge", incident.id, ops)).status, 409);
  });

  it("resolves an incident, recording who did it", async () => {
    const incident = await openIncident();
    const res = await call("resolve", incident.id, ops);
    assert.equal(res.status, 200);
    const detail = await getReliabilityService().incidentDetail(incident.id);
    assert.equal(detail?.incident.status, "resolved");
    assert.equal(detail?.events.find((e) => e.kind === "resolved")?.actor, "ops:alice");
  });
});
