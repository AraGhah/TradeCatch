import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { storageKey } from "../../src/lib/pg-rate-limit";
import {
  rateLimit,
  rateLimitAsync,
  resetRateLimitState,
  takeToken,
} from "../../src/lib/rate-limit";
import { takeTokens } from "../../src/lib/token-bucket";

const realFetch = globalThis.fetch;
const realError = console.error;
let logged: string[] = [];
beforeEach(() => {
  resetRateLimitState();
  logged = [];
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
  mock.restoreAll();
  mock.timers.reset();
});

const upstashEnv = {
  UPSTASH_REDIS_REST_URL: "https://fake.upstash.test",
  UPSTASH_REDIS_REST_TOKEN: "t",
};
const unique = (label: string) => `${label}-${Date.now()}-${Math.random()}`;

/**
 * An Upstash stand-in that runs the token bucket on its own clock and records
 * every command it is sent. (The Lua script itself is exercised against a real
 * Redis in upstash-rate-limit.test.ts.)
 */
function fakeUpstash() {
  const buckets = new Map<string, number>();
  const commands: unknown[][] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)) as [string, string, number, string, number, number, number];
    commands.push(command);
    const [, , , key, refill, tolerance, costMs] = command;
    const now = Date.now();
    const { decision, fullAt } = takeTokens(
      { capacity: tolerance / refill, refillEveryMs: refill },
      buckets.get(key) ?? null,
      now,
      costMs / refill,
    );
    buckets.set(key, fullAt);
    const deficit = Math.max(0, fullAt - now);
    return new Response(
      JSON.stringify({ result: [decision.allowed ? 1 : 0, deficit.toFixed(3), now] }),
    );
  }) as typeof fetch;
  return { commands };
}

describe("takeToken with no shared store (memory tier)", () => {
  it("allows exactly `capacity` of 50 rapid requests and tells the rest when to retry", async () => {
    const key = unique("rapid");
    const spec = { capacity: 20, refillEveryMs: 3_000 };
    const results = [];
    for (let i = 0; i < 50; i += 1) results.push(await takeToken({ key, spec, env: {} }));
    assert.equal(results.filter((r) => r.allowed).length, 20);
    assert.ok(results.every((r) => r.tier === "memory"));
    assert.ok(results.slice(20).every((r) => r.retryAfterMs >= 1 && r.retryAfterMs <= 3_000));
  });

  it("holds under 50 concurrent callers", async () => {
    const key = unique("concurrent");
    const spec = { capacity: 12, refillEveryMs: 60_000 };
    const results = await Promise.all(
      Array.from({ length: 50 }, () => takeToken({ key, spec, env: {} })),
    );
    assert.equal(results.filter((r) => r.allowed).length, 12);
  });

  it("recovers as time passes: one token back per refill interval", async () => {
    mock.method(Date, "now", () => now);
    let now = 1_700_000_000_000;
    const key = unique("recover");
    const spec = { capacity: 3, refillEveryMs: 10_000 };
    for (let i = 0; i < 3; i += 1) await takeToken({ key, spec, env: {} });
    assert.equal((await takeToken({ key, spec, env: {} })).allowed, false);
    now += 9_999;
    assert.equal((await takeToken({ key, spec, env: {} })).allowed, false);
    now += 1;
    assert.equal((await takeToken({ key, spec, env: {} })).allowed, true);
    assert.equal((await takeToken({ key, spec, env: {} })).allowed, false);
    now += 10 * 60_000;
    assert.equal((await takeToken({ key, spec, env: {} })).remaining, 2);
  });

  it("keeps the legacy 'N per window' helpers working as token buckets", async () => {
    const key = unique("legacy");
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await rateLimitAsync({ key, limit: 3, windowMs: 60_000, env: {} }));
    assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false]);
    const wait = results[3].resetAt - Date.now();
    assert.ok(wait > 0 && wait <= 20_000, `next request in ~20 s (one token), got ${wait} ms`);

    const sync = [];
    const syncKey = unique("legacy-sync");
    for (let i = 0; i < 3; i += 1) sync.push(rateLimit({ key: syncKey, limit: 2, windowMs: 60_000 }).allowed);
    assert.deepEqual(sync, [true, true, false]);
  });
});

describe("takeToken with Upstash", () => {
  it("shares the bucket through Upstash with one round trip per request", async () => {
    const { commands } = fakeUpstash();
    const key = unique("upstash");
    const spec = { capacity: 2, refillEveryMs: 60_000 };
    const results = [];
    for (let i = 0; i < 3; i += 1) results.push(await takeToken({ key, spec, env: upstashEnv }));
    assert.deepEqual(results.map((r) => [r.allowed, r.tier]), [[true, "upstash"], [true, "upstash"], [false, "upstash"]]);
    assert.equal(commands.length, 3);
  });

  it("answers a flood against a refused key from memory instead of calling the store each time", async () => {
    const { commands } = fakeUpstash();
    const key = unique("flood");
    const spec = { capacity: 5, refillEveryMs: 60_000 };
    for (let i = 0; i < 5; i += 1) await takeToken({ key, spec, env: upstashEnv });
    assert.equal(commands.length, 5);
    const flood = [];
    for (let i = 0; i < 500; i += 1) flood.push(await takeToken({ key, spec, env: upstashEnv }));
    assert.ok(flood.every((r) => !r.allowed));
    assert.equal(commands.length, 6, "one refusal reached the store; the other 499 were remembered");
    assert.ok(flood.slice(1).every((r) => r.tier === "memo"));
    assert.ok(flood.every((r) => r.retryAfterMs > 55_000), "the remembered wait is still honest");
  });

  it("stops repeating a remembered refusal once its Retry-After has passed", async () => {
    mock.method(Date, "now", () => now);
    let now = 1_700_000_000_000;
    const { commands } = fakeUpstash();
    const key = unique("memo-expiry");
    const spec = { capacity: 1, refillEveryMs: 5_000 };
    await takeToken({ key, spec, env: upstashEnv });
    assert.equal((await takeToken({ key, spec, env: upstashEnv })).allowed, false);
    now += 2_000;
    const memo = await takeToken({ key, spec, env: upstashEnv });
    assert.deepEqual([memo.allowed, memo.tier, memo.retryAfterMs], [false, "memo", 3_000]);
    now += 3_000;
    const after = await takeToken({ key, spec, env: upstashEnv });
    assert.deepEqual([after.allowed, after.tier], [true, "upstash"]);
    assert.equal(commands.length, 3);
  });

  it("falls to memory when Upstash errors, logs once without the error text, and skips it for a while", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("password=hunter2 boom", { status: 500 });
    }) as typeof fetch;
    const key = unique("upstash-down");
    const spec = { capacity: 1, refillEveryMs: 60_000 };
    const first = await takeToken({ key, spec, env: upstashEnv });
    const second = await takeToken({ key, spec, env: upstashEnv });
    assert.deepEqual([first.allowed, first.tier], [true, "memory"]);
    assert.deepEqual([second.allowed, second.tier], [false, "memory"]);
    assert.equal(calls, 1, "the second request did not wait for a tier that just failed");
    assert.equal(logged.filter((line) => line.includes("Upstash failed")).length, 1);
    assert.ok(logged.every((line) => !line.includes("hunter2")));
  });

  it("does not let a hung Upstash stall requests: the next tier answers after 2 seconds", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
    const pending = takeToken({
      key: unique("hung"),
      spec: { capacity: 1, refillEveryMs: 60_000 },
      env: upstashEnv,
    });
    mock.timers.tick(1_999);
    mock.timers.tick(1);
    const result = await pending;
    assert.deepEqual([result.allowed, result.tier], [true, "memory"]);
  });

  it("returns to Upstash after the cooldown", async () => {
    mock.method(Date, "now", () => now);
    let now = 1_700_000_000_000;
    let healthy = false;
    const inner = fakeUpstash();
    const good = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) =>
      healthy ? good(...args) : new Response("down", { status: 503 })) as typeof fetch;
    const spec = { capacity: 5, refillEveryMs: 60_000 };
    assert.equal((await takeToken({ key: unique("a"), spec, env: upstashEnv })).tier, "memory");
    healthy = true;
    assert.equal((await takeToken({ key: unique("b"), spec, env: upstashEnv })).tier, "memory", "still cooling down");
    now += 15_001;
    assert.equal((await takeToken({ key: unique("c"), spec, env: upstashEnv })).tier, "upstash");
    assert.equal(inner.commands.length, 1);
  });
});

describe("takeToken with an unreachable database", () => {
  it("keeps enforcing the limit in memory, logging once and never the connection string", async () => {
    // Nothing listens on port 1, so the Postgres tier fails immediately.
    const env = {
      DATABASE_URL: "postgresql://nobody:s3cret@127.0.0.1:1/none",
      MISSED_CALL_DURABLE_STORE: "1",
    };
    const key = unique("tier-fallback");
    const spec = { capacity: 3, refillEveryMs: 60_000 };
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await takeToken({ key, spec, env }));
    assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false]);
    assert.ok(results.every((r) => r.tier === "memory"));
    assert.equal(logged.filter((line) => line.includes("Postgres failed")).length, 1);
    assert.ok(logged.every((line) => !line.includes("s3cret") && !line.includes("postgresql://")));
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
