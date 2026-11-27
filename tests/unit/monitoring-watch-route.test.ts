/**
 * KAN-28 /api/monitoring/watch: who may run the monitor (MON-13), what the
 * scheduler gets back, and that a database outage neither leaks internals nor
 * pretends the run was healthy.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { resetReliabilityRuntimeForTests } from "../../src/product/reliability/runtime";

const SECRET = "unit-test-monitoring-secret-0123456789abcdef";
let saved: NodeJS.ProcessEnv;
const realError = console.error;
const realWarn = console.warn;

beforeEach(() => {
  saved = { ...process.env };
  for (const key of ["DATABASE_URL", "MISSED_CALL_DURABLE_STORE", "SAAS_DURABLE_STORE", "NEXT_PUBLIC_SITE_URL", "ADMIN_ALERT_EMAIL", "RESEND_NOTIFY_EMAIL", "TRADECATCH_ADMIN_EMAILS"])
    delete process.env[key];
  process.env.MONITORING_SECRET = SECRET;
  process.env.MISSED_CALL_OPS_SECRET = "unit-test-ops-secret-0123456789abcdef";
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

async function call(headers: Record<string, string> = {}, method: "GET" | "POST" = "POST") {
  const route = await import("../../src/app/api/monitoring/watch/route");
  const request = new NextRequest("http://localhost/api/monitoring/watch", { method, headers });
  return (method === "GET" ? route.GET : route.POST)(request);
}

describe("MON-13 access to the monitor", () => {
  it("refuses a request with no credentials", async () => {
    for (const method of ["GET", "POST"] as const) {
      const res = await call({}, method);
      assert.equal(res.status, 401, method);
      assert.deepEqual(await res.json(), { error: "Unauthorized" });
    }
  });

  it("refuses a wrong secret, a partial secret and a differently-shaped header", async () => {
    for (const authorization of ["Bearer wrong", `Bearer ${SECRET.slice(0, -1)}`, SECRET, `Basic ${SECRET}`, "Bearer "]) {
      const res = await call({ authorization });
      assert.equal(res.status, 401, authorization);
    }
  });

  it("does not run any check for an unauthorized caller", async () => {
    const res = await call({});
    const text = await res.text();
    assert.doesNotMatch(text, /database|website|incident/i);
  });
});

describe("a scheduled run", () => {
  it("answers ok with what it checked, and does not claim to have measured what it could not", async () => {
    const res = await call({ authorization: `Bearer ${SECRET}`, "x-vercel-cron": "cloudflare" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control")?.includes("no-store"), true);
    const body = (await res.json()) as { ok: boolean; checks: Record<string, string> };
    assert.equal(body.ok, true);
    assert.equal(body.checks.database, "not_measured");
    assert.equal(body.checks.website, "not_measured");
  });

  it("never uses the keys the scheduler reads as 'work failed' unless the run itself failed", async () => {
    // runCloudflareCron treats a top-level failed > 0 or an outcomes list with
    // failed entries as a failed job. Findings and alert failures are normal
    // results of a healthy monitor, not a failed run.
    const res = await call({ authorization: `Bearer ${SECRET}`, "x-vercel-cron": "cloudflare" });
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal("failed" in body, false);
    assert.equal("outcomes" in body, false);
  });

  it("in production, an operator using the ops secret must say who they are, as with the other operations routes", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    const ops = `Bearer ${process.env.MISSED_CALL_OPS_SECRET}`;
    assert.equal((await call({ authorization: ops })).status, 403);
    assert.equal((await call({ authorization: ops, "x-ops-actor": "alice" })).status, 200);
    assert.equal((await call({ authorization: `Bearer ${SECRET}`, "x-vercel-cron": "cloudflare" })).status, 200, "the scheduler is identified by its own header");
  });
});

describe("when the database is down", () => {
  it("fails the run (so the scheduler records it) without leaking the address or credentials", async () => {
    process.env.DATABASE_URL = "postgresql://svc:topsecret@127.0.0.1:1/appdb";
    process.env.MISSED_CALL_DURABLE_STORE = "1";
    const res = await call({ authorization: `Bearer ${SECRET}`, "x-vercel-cron": "cloudflare" });
    assert.equal(res.status, 503);
    const text = await res.text();
    assert.doesNotMatch(text, /127\.0\.0\.1|ECONNREFUSED|topsecret|appdb|postgres/i);
    const body = JSON.parse(text) as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, "storage_unavailable");
  });
});
