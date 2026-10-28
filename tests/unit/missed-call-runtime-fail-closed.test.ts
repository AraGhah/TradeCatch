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
  const prevTradeCatchEnv = process.env.TRADECATCH_ENV;

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
    if (prevTradeCatchEnv === undefined) delete process.env.TRADECATCH_ENV;
    else process.env.TRADECATCH_ENV = prevTradeCatchEnv;

    const g = globalThis as unknown as {
      __tradecatchMissedCall?: unknown;
    };
    delete g.__tradecatchMissedCall;
  });

  it("refuses memory store in production without durable config", async () => {
    setNodeEnv("production");
    process.env.TRADECATCH_ENV = "production";
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

  it("allows memory store on staging builds without durable config", async () => {
    setNodeEnv("production");
    process.env.TRADECATCH_ENV = "staging";
    delete process.env.MISSED_CALL_DURABLE_STORE;
    delete process.env.DATABASE_URL;

    const { getMissedCallRuntime, isRuntimeUsingDurableStore } = await import(
      "../../src/product/missed-call/runtime"
    );
    const runtime = getMissedCallRuntime();
    assert.equal(isRuntimeUsingDurableStore(), false);
    assert.ok(runtime.store);
  });

  it("allows memory store outside production", async () => {
    setNodeEnv("development");
    delete process.env.TRADECATCH_ENV;
    delete process.env.MISSED_CALL_DURABLE_STORE;
    delete process.env.DATABASE_URL;

    const { getMissedCallRuntime, isRuntimeUsingDurableStore } = await import(
      "../../src/product/missed-call/runtime"
    );
    const runtime = getMissedCallRuntime();
    assert.equal(isRuntimeUsingDurableStore(), false);
    assert.ok(runtime.store);
  });

  it("boots in real production with a durable store and no legacy MISSED_CALL_* client configured", async () => {
    // Regression for the production SMS webhook crash: a genuinely
    // multi-tenant deployment never sets MISSED_CALL_CLIENT_ID /
    // MISSED_CALL_SMS_FROM / MISSED_CALL_TECH_PHONE because each
    // organization routes through its own linked client record instead.
    // Runtime boot must not throw just because that single legacy client
    // is absent.
    setNodeEnv("production");
    process.env.TRADECATCH_ENV = "production";
    process.env.MISSED_CALL_DURABLE_STORE = "1";
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/test";
    delete process.env.MISSED_CALL_CLIENT_ID;
    delete process.env.MISSED_CALL_SMS_FROM;
    delete process.env.MISSED_CALL_TECH_PHONE;
    delete process.env.MISSED_CALL_CLIENT_CONFIG_JSON;
    delete process.env.MISSED_CALL_ALLOW_DEMO;

    const { getMissedCallRuntime, isRuntimeUsingDurableStore } = await import(
      "../../src/product/missed-call/runtime"
    );
    assert.doesNotThrow(() => getMissedCallRuntime());
    const runtime = getMissedCallRuntime();
    assert.equal(isRuntimeUsingDurableStore(), true);
    assert.ok(runtime.store);
    assert.ok(runtime.engine);
  });

  it("still fails loudly when an explicit legacy client config is invalid in production", async () => {
    setNodeEnv("production");
    process.env.TRADECATCH_ENV = "production";
    process.env.MISSED_CALL_DURABLE_STORE = "1";
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/test";
    delete process.env.MISSED_CALL_ALLOW_DEMO;
    process.env.MISSED_CALL_CLIENT_ID = "client_demo";
    process.env.MISSED_CALL_SMS_FROM = "+15145550100";
    process.env.MISSED_CALL_TECH_PHONE = "+14165551234";

    const { getMissedCallRuntime } = await import(
      "../../src/product/missed-call/runtime"
    );
    assert.throws(
      () => getMissedCallRuntime(),
      /Invalid production client config/,
    );

    delete process.env.MISSED_CALL_CLIENT_ID;
    delete process.env.MISSED_CALL_SMS_FROM;
    delete process.env.MISSED_CALL_TECH_PHONE;
  });
});
