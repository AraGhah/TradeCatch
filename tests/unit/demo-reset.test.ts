import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { POST as resetDemo } from "../../src/app/api/ops/demo/reset/route";
import { DEMO_RESET_CONFIRMATION } from "../../src/product/demo/reset-demo-data";

const KEYS = [
  "NODE_ENV",
  "TRADECATCH_ENV",
  "TRADECATCH_ALLOW_DEMO_RESET",
  "MISSED_CALL_OPS_SECRET",
  "MISSED_CALL_DURABLE_STORE",
  "DATABASE_URL",
  "MISSED_CALL_CLIENT_ID",
  "MISSED_CALL_ALLOW_DEMO",
] as const;

const original = new Map(KEYS.map((key) => [key, process.env[key]]));

function setNodeEnv(value: string | undefined) {
  const env = process.env as { NODE_ENV?: string };
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

beforeEach(() => {
  const g = globalThis as unknown as { __tradecatchMissedCall?: unknown };
  delete g.__tradecatchMissedCall;
});

afterEach(() => {
  for (const key of KEYS) {
    const value = original.get(key);
    if (key === "NODE_ENV") {
      setNodeEnv(value);
      continue;
    }
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const g = globalThis as unknown as { __tradecatchMissedCall?: unknown };
  delete g.__tradecatchMissedCall;
});

describe("demo reset API", () => {
  it("returns 404 on real production", async () => {
    setNodeEnv("production");
    process.env.TRADECATCH_ENV = "production";
    process.env.MISSED_CALL_OPS_SECRET = "ops-secret";

    const response = await resetDemo(
      new NextRequest("http://localhost/api/ops/demo/reset", {
        method: "POST",
        headers: {
          authorization: "Bearer ops-secret",
          "x-ops-actor": "tester",
          "content-type": "application/json",
        },
        body: JSON.stringify({ confirm: DEMO_RESET_CONFIRMATION }),
      }),
    );

    assert.equal(response.status, 404);
  });

  it("resets the in-memory staging demo client", async () => {
    setNodeEnv("production");
    process.env.TRADECATCH_ENV = "staging";
    process.env.MISSED_CALL_OPS_SECRET = "ops-secret";
    process.env.MISSED_CALL_ALLOW_DEMO = "1";
    process.env.MISSED_CALL_CLIENT_ID = "client_demo";
    delete process.env.MISSED_CALL_DURABLE_STORE;
    delete process.env.DATABASE_URL;

    const response = await resetDemo(
      new NextRequest("http://localhost/api/ops/demo/reset", {
        method: "POST",
        headers: {
          authorization: "Bearer ops-secret",
          "x-ops-actor": "tester",
          "content-type": "application/json",
        },
        body: JSON.stringify({ confirm: DEMO_RESET_CONFIRMATION }),
      }),
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      ok: boolean;
      mode: string;
      seededClientId: string;
    };
    assert.equal(body.ok, true);
    assert.equal(body.mode, "memory");
    assert.equal(body.seededClientId, "client_demo");
  });
});
