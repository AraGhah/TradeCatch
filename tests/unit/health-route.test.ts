import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { GET } from "../../src/app/api/health/route";
import { closePgPool } from "../../src/product/missed-call/postgres-store";

const MANAGED_ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "NEXT_PUBLIC_SITE_URL",
  "TRADECATCH_E2E",
  "SAAS_DEV_LOGIN",
  "MISSED_CALL_SANDBOX",
  "MISSED_CALL_ALLOW_DEMO",
  "MISSED_CALL_SKIP_TWILIO_VALIDATE",
  "MISSED_CALL_SMS_MODE",
  "MISSED_CALL_DURABLE_STORE",
  "DATABASE_URL",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "MISSED_CALL_OPS_SECRET",
  "CRON_SECRET",
  "AUTH_SECRET",
  "SESSION_SECRET",
  "MISSED_CALL_CLIENT_CONFIG_JSON",
  "MISSED_CALL_CLIENT_ID",
  "MISSED_CALL_SMS_FROM",
  "MISSED_CALL_TECH_PHONE",
  "MISSED_CALL_TECH_NAME",
  "MISSED_CALL_TECH_BACKUP_PHONES",
  "MISSED_CALL_TECH_OWNER_PHONE",
  "MISSED_CALL_TECH_OWNER_NAME",
  "MISSED_CALL_HUMAN_REVIEW_PHONE",
  "MISSED_CALL_CONTRACTOR_NAME",
  "MISSED_CALL_TIMEZONE",
] as const;

const originalEnv = new Map(
  MANAGED_ENV_KEYS.map((key) => [key, process.env[key]]),
);
const originalPoolQuery = Pool.prototype.query;
const originalConsoleError = console.error;

type DetailedHealthBody = {
  ok: boolean;
  checks: {
    clientRouting: boolean;
    database: boolean | null;
    schemaOk: boolean | null;
    diagnosticsComplete: boolean;
    queue: {
      queued: number;
      retry: number;
      sending: number;
      staleSending: number;
    } | null;
    escalationsLastTick: string | null;
    escalationsFresh: boolean | null;
  };
  moduleA: { ready: boolean; status: string };
};

function clearManagedEnvironment() {
  for (const key of MANAGED_ENV_KEYS) delete process.env[key];
}

function configureValidProductionEnvironment() {
  Object.assign(process.env, {
    NODE_ENV: "production",
    MISSED_CALL_DURABLE_STORE: "1",
    DATABASE_URL:
      "postgres://health:health-password@localhost/tradecatch-health",
    TWILIO_ACCOUNT_SID: "AC_health_test",
    TWILIO_AUTH_TOKEN: "twilio-health-secret",
    MISSED_CALL_OPS_SECRET: "health-ops-secret",
    MISSED_CALL_CLIENT_ID: "client_pilot",
    MISSED_CALL_SMS_FROM: "+14162220001",
    MISSED_CALL_TECH_PHONE: "+14162220002",
    MISSED_CALL_HUMAN_REVIEW_PHONE: "+14162220003",
    MISSED_CALL_CONTRACTOR_NAME: "Pilot Contractor",
    MISSED_CALL_TIMEZONE: "America/Toronto",
  });
}

function installQueryStub(
  query: (...args: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>,
) {
  Reflect.set(Pool.prototype, "query", query);
}

function installSuccessfulProbeStub(): () => number {
  let calls = 0;
  installQueryStub(async () => {
    calls += 1;
    switch (calls) {
      case 1:
        return { rows: [{ ok: true }] };
      case 2:
        return { rows: [{ ok: true }] };
      case 3:
        return {
          rows: [{ queued: "0", retry: "0", sending: "0", stale_sending: "0" }],
        };
      case 4:
        return {
          rows: [
            {
              value: new Date().toISOString(),
              updated_at: new Date(),
            },
          ],
        };
      default:
        throw new Error(`Unexpected health query ${calls}`);
    }
  });
  return () => calls;
}

function healthRequest(token?: string): NextRequest {
  return new NextRequest("https://tradecatch.example/api/health", {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

beforeEach(() => {
  clearManagedEnvironment();
  configureValidProductionEnvironment();
});

afterEach(async () => {
  Reflect.set(Pool.prototype, "query", originalPoolQuery);
  console.error = originalConsoleError;
  await closePgPool();
});

after(() => {
  clearManagedEnvironment();
  for (const [key, value] of originalEnv) {
    if (value !== undefined) Reflect.set(process.env, key, value);
  }
});

describe("health route", () => {
  it("keeps unauthenticated production liveness cheap and secret-free", async () => {
    let queryCalls = 0;
    installQueryStub(async () => {
      queryCalls += 1;
      throw new Error(`must not query ${process.env.DATABASE_URL}`);
    });

    const response = await GET(healthRequest());
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-tradecatch-ready"), null);
    assert.equal(response.headers.get("x-tradecatch-live"), "1");
    assert.equal(body.ok, true);
    assert.equal(body.status, "live");
    assert.equal(body.livenessMarker, "tradecatch-live");
    assert.equal("readyMarker" in body, false);
    assert.equal("checks" in body, false);
    assert.equal(queryCalls, 0);
    assert.equal(JSON.stringify(body).includes("health-password"), false);
  });

  it("rejects a supplied invalid readiness bearer instead of downgrading to liveness", async () => {
    let queryCalls = 0;
    installQueryStub(async () => {
      queryCalls += 1;
      throw new Error("must not query");
    });

    const response = await GET(healthRequest("wrong-secret"));
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
    assert.equal(response.headers.get("x-tradecatch-ready"), null);
    assert.equal(response.headers.get("x-tradecatch-live"), null);
    assert.equal(body.ok, false);
    assert.equal(body.status, "unauthorized");
    assert.equal("checks" in body, false);
    assert.equal(queryCalls, 0);
    assert.equal(JSON.stringify(body).includes("health-password"), false);
  });

  it("fails every durable diagnostic closed when a later probe throws", async () => {
    let queryCalls = 0;
    installQueryStub(async () => {
      queryCalls += 1;
      if (queryCalls <= 2) return { rows: [{ ok: true }] };
      throw new Error(`queue probe failed for ${process.env.DATABASE_URL}`);
    });
    console.error = () => undefined;

    const response = await GET(healthRequest("health-ops-secret"));
    const body = (await response.json()) as DetailedHealthBody;

    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.equal(body.checks.clientRouting, true);
    assert.equal(body.checks.database, false);
    assert.equal(body.checks.schemaOk, false);
    assert.equal(body.checks.diagnosticsComplete, false);
    assert.equal(body.checks.queue, null);
    assert.equal(body.checks.escalationsLastTick, null);
    assert.equal(body.checks.escalationsFresh, false);
    assert.equal(body.moduleA.ready, false);
    assert.equal(queryCalls, 3);
    assert.equal(JSON.stringify(body).includes("health-password"), false);
  });

  it("rejects readiness when production client routing cannot bootstrap", async () => {
    delete process.env.MISSED_CALL_CLIENT_ID;
    delete process.env.MISSED_CALL_SMS_FROM;
    delete process.env.MISSED_CALL_TECH_PHONE;
    delete process.env.MISSED_CALL_HUMAN_REVIEW_PHONE;
    const queryCalls = installSuccessfulProbeStub();

    const response = await GET(healthRequest("health-ops-secret"));
    const body = (await response.json()) as DetailedHealthBody;

    assert.equal(response.status, 503);
    assert.equal(body.checks.clientRouting, false);
    assert.equal(body.checks.database, true);
    assert.equal(body.checks.schemaOk, true);
    assert.equal(body.checks.diagnosticsComplete, true);
    assert.equal(body.checks.escalationsFresh, true);
    assert.equal(body.moduleA.ready, false);
    assert.equal(queryCalls(), 4);
    assert.equal(JSON.stringify(body).includes("MISSED_CALL_CLIENT"), false);
  });

  it("reports authenticated readiness when all Module A checks pass", async () => {
    const queryCalls = installSuccessfulProbeStub();

    const response = await GET(healthRequest("health-ops-secret"));
    const body = (await response.json()) as DetailedHealthBody;

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.checks.clientRouting, true);
    assert.equal(body.checks.database, true);
    assert.equal(body.checks.schemaOk, true);
    assert.equal(body.checks.diagnosticsComplete, true);
    assert.equal(body.checks.escalationsFresh, true);
    assert.equal(body.moduleA.ready, true);
    assert.equal(queryCalls(), 4);
  });
});
