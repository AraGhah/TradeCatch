/**
 * KAN-28 /api/monitoring/ingest: the Worker hands per-minute request counters
 * to the app here. It is reachable from the internet like any route, so it must
 * refuse everyone but the Worker (MON-13) and accept nothing that could poison
 * the numbers the alert rules read.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { getReliabilityStore, resetReliabilityRuntimeForTests } from "../../src/product/reliability/runtime";

const SECRET = "unit-test-monitoring-secret-0123456789abcdef";
const NOW = Date.now();
const minute = (minutesAgo: number) => new Date(Math.floor(NOW / 60_000) * 60_000 - minutesAgo * 60_000).toISOString();
const row = (over: Record<string, unknown> = {}) => ({
  at: minute(0),
  scope: "api",
  total: 10,
  s2xx: 8,
  s3xx: 0,
  s401: 0,
  s403: 1,
  s429: 0,
  s4xxOther: 0,
  s5xx: 1,
  lat: [6, 3, 1, 0, 0, 0, 0],
  ...over,
});

let saved: NodeJS.ProcessEnv;
const realError = console.error;
const realWarn = console.warn;
beforeEach(() => {
  saved = { ...process.env };
  for (const key of ["DATABASE_URL", "MISSED_CALL_DURABLE_STORE", "SAAS_DURABLE_STORE"]) delete process.env[key];
  process.env.MONITORING_SECRET = SECRET;
  resetReliabilityRuntimeForTests();
  console.error = () => undefined;
  console.warn = () => undefined;
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  resetReliabilityRuntimeForTests();
  console.error = realError;
  console.warn = realWarn;
});

async function post(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) {
  const { POST } = await import("../../src/app/api/monitoring/ingest/route");
  return POST(
    new NextRequest("http://localhost/api/monitoring/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}
const stored = () => getReliabilityStore().listBuckets(new Date(NOW - 6 * 3_600_000).toISOString());

describe("MON-13 who may send counters", () => {
  it("refuses requests with no credentials or a wrong secret, and stores nothing", async () => {
    const attempts: Record<string, string>[] = [{}, { authorization: "Bearer wrong" }, { authorization: SECRET }, { authorization: `Bearer ${SECRET}x` }];
    for (const headers of attempts) {
      const res = await post({ rows: [row()] }, headers);
      assert.equal(res.status, 401, JSON.stringify(headers));
    }
    assert.deepEqual(await stored(), []);
  });

  it("does not answer GET", async () => {
    const route = await import("../../src/app/api/monitoring/ingest/route");
    assert.equal((route as Record<string, unknown>).GET, undefined);
  });
});

describe("accepting counters", () => {
  it("stores valid rows and answers 202 without echoing them", async () => {
    const res = await post({ rows: [row(), row({ scope: "page", at: minute(1) })] });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { ok: true, accepted: 2 });
    const rows = await stored();
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.scope === "api")?.s5xx, 1);
  });

  it("adds to a minute that is already stored (several Worker isolates report the same minute)", async () => {
    await post({ rows: [row()] });
    await post({ rows: [row()] });
    const [only] = await stored();
    assert.equal(only.total, 20);
    assert.deepEqual(only.lat, [12, 6, 2, 0, 0, 0, 0]);
  });
});

describe("refusing anything that could poison the numbers", () => {
  const bad: [string, unknown][] = [
    ["not JSON", "{nope"],
    ["no rows", {}],
    ["empty rows", { rows: [] }],
    ["too many rows", { rows: Array.from({ length: 121 }, () => row()) }],
    ["unknown top-level key", { rows: [row()], extra: 1 }],
    ["unknown row key (a path or a user must never be stored)", { rows: [row({ path: "/api/secret" })] }],
    ["unknown scope", { rows: [row({ scope: "admin" })] }],
    ["negative count", { rows: [row({ s5xx: -1 })] }],
    ["fractional count", { rows: [row({ total: 1.5 })] }],
    ["absurd count", { rows: [row({ total: 10_000_000, s2xx: 10_000_000, lat: [10_000_000, 0, 0, 0, 0, 0, 0] })] }],
    ["status counts above the total", { rows: [row({ total: 5 })] }],
    ["latency counts above the total", { rows: [row({ lat: [20, 0, 0, 0, 0, 0, 0] })] }],
    ["wrong number of latency bins", { rows: [row({ lat: [10, 0, 0] })] }],
    ["not a minute boundary", { rows: [row({ at: new Date(Math.floor(NOW / 60_000) * 60_000 + 7_000).toISOString() })] }],
    ["from the future", { rows: [row({ at: minute(-30) })] }],
    ["from days ago", { rows: [row({ at: minute(60 * 24 * 3) })] }],
    ["not a date", { rows: [row({ at: "yesterday" })] }],
    ["a string where a number belongs", { rows: [row({ s2xx: "8" })] }],
  ];
  for (const [name, body] of bad)
    it(`rejects ${name}`, async () => {
      const res = await post(body);
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: "invalid_body" });
      assert.deepEqual(await stored(), [], "nothing from a rejected batch is kept");
    });

  it("rejects a body that is far larger than any real batch", async () => {
    const res = await post(JSON.stringify({ rows: [row()], padding: "x".repeat(200_000) }));
    assert.equal(res.status, 413);
    assert.deepEqual(await stored(), []);
  });
});

describe("when the database is down", () => {
  it("answers 503 without leaking the address or credentials", async () => {
    process.env.DATABASE_URL = "postgresql://svc:topsecret@127.0.0.1:1/appdb";
    process.env.MISSED_CALL_DURABLE_STORE = "1";
    resetReliabilityRuntimeForTests();
    const res = await post({ rows: [row()] });
    assert.equal(res.status, 503);
    const text = await res.text();
    assert.doesNotMatch(text, /127\.0\.0\.1|ECONNREFUSED|topsecret|appdb|postgres/i);
    assert.equal(JSON.parse(text).error, "storage_unavailable");
  });
});
