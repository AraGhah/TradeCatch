import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

function setNodeEnv(value: string | undefined) {
  const env = process.env as { NODE_ENV?: string };
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

describe("missed-call runtime fail-closed", () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevDurable = process.env.MISSED_CALL_DURABLE_STORE;
  const prevDb = process.env.DATABASE_URL;
  const prevE2e = process.env.TRADECATCH_E2E;
  const prevVercel = process.env.VERCEL_ENV;

  beforeEach(() => {
    const g = globalThis as unknown as {
      __tradecatchMissedCall?: unknown;
    };
    delete g.__tradecatchMissedCall;
  });

  afterEach(() => {
    setNodeEnv(prevNodeEnv);
    if (prevDurable === undefined) delete process.env.MISSED_CALL_DURABLE_STORE;
    else process.env.MISSED_CALL_DURABLE_STORE = prevDurable;
    if (prevDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDb;
    if (prevE2e === undefined) delete process.env.TRADECATCH_E2E;
    else process.env.TRADECATCH_E2E = prevE2e;
    if (prevVercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = prevVercel;

    const g = globalThis as unknown as {
      __tradecatchMissedCall?: unknown;
    };
    delete g.__tradecatchMissedCall;
  });

  it("refuses memory store in production without durable config", async () => {
    setNodeEnv("production");
    delete process.env.MISSED_CALL_DURABLE_STORE;
    delete process.env.DATABASE_URL;
    delete process.env.TRADECATCH_E2E;

    const { getMissedCallRuntime } = await import(
      "../../src/product/missed-call/runtime"
    );
    assert.throws(
      () => getMissedCallRuntime(),
      /Refusing in-memory store in production/,
    );
  });

  it("allows memory store outside production", async () => {
    setNodeEnv("development");
    delete process.env.MISSED_CALL_DURABLE_STORE;
    delete process.env.DATABASE_URL;

    const { getMissedCallRuntime, isRuntimeUsingDurableStore } = await import(
      "../../src/product/missed-call/runtime"
    );
    const runtime = getMissedCallRuntime();
    assert.equal(isRuntimeUsingDurableStore(), false);
    assert.ok(runtime.store);
  });
});
