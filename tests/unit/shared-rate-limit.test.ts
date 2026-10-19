import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { storageKey } from "../../src/lib/pg-rate-limit";
import { rateLimitAsync } from "../../src/lib/rate-limit";
import { upstashRateLimit } from "../../src/lib/upstash";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Minimal Upstash REST stand-in: INCR / TTL / EXPIRE over an in-memory map. */
function fakeUpstash(initial: { count: number; ttl: number } | null) {
  const state = initial ? { ...initial } : null;
  const store = { counter: state, calls: [] as string[] };
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)) as Array<string | number>;
    const name = String(command[0]);
    store.calls.push(name);
    let result: number;
    if (name === "INCR") {
      store.counter = store.counter ? { ...store.counter, count: store.counter.count + 1 } : { count: 1, ttl: -1 };
      result = store.counter.count;
    } else if (name === "TTL") {
      result = store.counter ? store.counter.ttl : -2;
    } else if (name === "EXPIRE") {
      if (store.counter) store.counter.ttl = Number(command[2]);
      result = 1;
    } else {
      throw new Error(`unexpected command ${name}`);
    }
    return new Response(JSON.stringify({ result }), { status: 200 });
  }) as typeof fetch;
  return store;
}

const upstashEnv = { UPSTASH_REDIS_REST_URL: "https://fake.upstash.test", UPSTASH_REDIS_REST_TOKEN: "t" };

describe("Upstash counter expiry", () => {
  it("gives a fresh counter an expiry", async () => {
    const store = fakeUpstash(null);
    const result = await upstashRateLimit({ key: "fresh", limit: 3, windowMs: 60_000, env: upstashEnv });
    assert.equal(result.allowed, true);
    assert.deepEqual(store.calls, ["INCR", "TTL", "EXPIRE"]);
    assert.equal(store.counter?.ttl, 60);
  });

  it("repairs a counter that lost its expiry instead of blocking the key forever", async () => {
    // An earlier caller died between INCR and EXPIRE: count is high, ttl is -1 (never expires).
    const store = fakeUpstash({ count: 50, ttl: -1 });
    const result = await upstashRateLimit({ key: "stuck", limit: 3, windowMs: 60_000, env: upstashEnv });
    assert.equal(result.allowed, false);
    assert.ok(store.calls.includes("EXPIRE"), "the missing expiry is restored");
    assert.equal(store.counter?.ttl, 60);
    assert.ok(result.resetAt > Date.now() && result.resetAt <= Date.now() + 61_000);
  });

  it("does not touch the expiry of a healthy counter", async () => {
    const store = fakeUpstash({ count: 1, ttl: 20 });
    await upstashRateLimit({ key: "healthy", limit: 3, windowMs: 60_000, env: upstashEnv });
    assert.deepEqual(store.calls, ["INCR", "TTL"]);
    assert.equal(store.counter?.ttl, 20);
  });
});

describe("rateLimitAsync tiers", () => {
  it("keeps enforcing the limit in memory when the shared database is unreachable", async () => {
    const errors: unknown[][] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      // Nothing listens on port 1, so the Postgres tier fails immediately.
      const env = {
        DATABASE_URL: "postgresql://nobody:none@127.0.0.1:1/none",
        MISSED_CALL_DURABLE_STORE: "1",
      };
      const key = `tier-fallback-${Date.now()}-${Math.random()}`;
      const results = [];
      for (let i = 0; i < 4; i += 1) results.push((await rateLimitAsync({ key, limit: 3, windowMs: 60_000, env })).allowed);
      assert.deepEqual(results, [true, true, true, false]);
      // One line for the whole outage, not one per request.
      assert.equal(errors.filter((args) => String(args[0]).includes("Postgres failed")).length, 1);
    } finally {
      console.error = realError;
    }
  });

  it("falls through Upstash errors to the next tier", async () => {
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    const realError = console.error;
    console.error = () => {};
    try {
      const key = `upstash-down-${Date.now()}-${Math.random()}`;
      const first = await rateLimitAsync({ key, limit: 1, windowMs: 60_000, env: upstashEnv });
      const second = await rateLimitAsync({ key, limit: 1, windowMs: 60_000, env: upstashEnv });
      assert.equal(first.allowed, true);
      assert.equal(second.allowed, false);
    } finally {
      console.error = realError;
    }
  });
});

describe("rate-limit storage keys", () => {
  it("leaves short keys readable and hashes long, caller-controlled ones to a fixed size", () => {
    assert.equal(storageKey("magic-link:ip:203.0.113.9"), "magic-link:ip:203.0.113.9");
    const long = `magic-link:${"a".repeat(5_000)}@example.com`;
    const hashed = storageKey(long);
    assert.match(hashed, /^h:[0-9a-f]{64}$/);
    assert.equal(storageKey(long), hashed);
    assert.notEqual(storageKey(`${long}x`), hashed);
  });
});
