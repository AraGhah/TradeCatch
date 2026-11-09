import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";

const managed = [
  "NODE_ENV",
  "TRADECATCH_ENV",
  "DATABASE_URL",
  "MISSED_CALL_DURABLE_STORE",
  "SAAS_DURABLE_STORE",
  "MISSED_CALL_OPS_SECRET",
  "CRON_SECRET",
  "OVERAGE_INVOICING",
  "OVERAGE_RATE_SMS_SEGMENT_CENTS",
  "OVERAGE_RATE_VOICE_MINUTE_CENTS",
];
const original = new Map(managed.map((key) => [key, process.env[key]]));

beforeEach(() => {
  managed.forEach((key) => delete process.env[key]);
  Object.assign(process.env, {
    NODE_ENV: "development",
    MISSED_CALL_OPS_SECRET: "test-ops-secret",
  });
  mock.method(console, "warn", () => {});
  mock.method(console, "info", () => {});
  mock.method(console, "error", () => {});
});

afterEach(() => {
  mock.restoreAll();
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function request(method: "GET" | "POST", headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/billing/overage-invoices/tick", {
    method,
    headers,
  });
}

const auth = {
  authorization: "Bearer test-ops-secret",
  "x-ops-actor": "ops-test",
};

describe("/api/billing/overage-invoices/tick", () => {
  it("refuses unauthenticated and wrongly authenticated requests", async () => {
    const { GET, POST } =
      await import("../../src/app/api/billing/overage-invoices/tick/route");
    assert.equal((await POST(request("POST"))).status, 401);
    assert.equal((await GET(request("GET"))).status, 401);
    assert.equal(
      (
        await POST(
          request("POST", { authorization: "Bearer nope", "x-ops-actor": "x" }),
        )
      ).status,
      401,
    );
  });

  it("is a no-op that says why while invoicing is off, even with a database configured", async () => {
    Object.assign(process.env, {
      DATABASE_URL: "postgres://nobody@127.0.0.1:1/never_connected",
      MISSED_CALL_DURABLE_STORE: "1",
    });
    const { POST } =
      await import("../../src/app/api/billing/overage-invoices/tick/route");
    const response = await POST(request("POST", auth));
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      ok: boolean;
      enabled: boolean;
      reason: string;
    };
    assert.equal(body.ok, true);
    assert.equal(body.enabled, false);
    assert.match(body.reason, /OVERAGE_INVOICING/);
  });

  it("stays off when a rate is missing", async () => {
    Object.assign(process.env, {
      OVERAGE_INVOICING: "1",
      OVERAGE_RATE_SMS_SEGMENT_CENTS: "7",
    });
    const { POST } =
      await import("../../src/app/api/billing/overage-invoices/tick/route");
    const body = (await (await POST(request("POST", auth))).json()) as {
      enabled: boolean;
      reason: string;
    };
    assert.equal(body.enabled, false);
    assert.match(body.reason, /OVERAGE_RATE_VOICE_MINUTE_CENTS/);
  });

  it("answers 503, not a guess, when switched on without a durable database", async () => {
    Object.assign(process.env, {
      OVERAGE_INVOICING: "1",
      OVERAGE_RATE_SMS_SEGMENT_CENTS: "7",
      OVERAGE_RATE_VOICE_MINUTE_CENTS: "25",
    });
    const { POST } =
      await import("../../src/app/api/billing/overage-invoices/tick/route");
    const response = await POST(request("POST", auth));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "unavailable",
    });
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  });
});
