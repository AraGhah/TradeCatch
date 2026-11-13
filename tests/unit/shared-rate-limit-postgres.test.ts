import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import {
  pgRateLimitSweep,
  pgTokenBucket,
  storageKey,
} from "../../src/lib/pg-rate-limit";
import { resetRateLimitState, takeToken } from "../../src/lib/rate-limit";
import { closePgPool } from "../../src/product/missed-call/postgres-store";

/**
 * Runs against a real Postgres that already has src/product/security/schema.sql
 * applied (a throwaway container is enough):
 *   SECURITY_TEST_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/db npm run test:unit
 */
const URL = process.env.SECURITY_TEST_DATABASE_URL?.trim();

describe("Postgres token bucket", { skip: URL ? undefined : "set SECURITY_TEST_DATABASE_URL to run against Postgres" }, () => {
  let pool: Pool;
  const unique = () => `pg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  before(() => {
    pool = new Pool({ connectionString: URL, max: 20 });
  });
  after(async () => {
    await pool.end();
    await closePgPool();
  });

  /**
   * The guarantee under a burst of simultaneous requests: never more than
   * `capacity` allowed, and the last token may be missing only when statements
   * that started a few milliseconds apart took the row lock out of order (see
   * PG_SLACK_MS). Anything else, in either direction, is a bug.
   */
  const assertCapacity = (results: Array<{ allowed: boolean }>, capacity: number) => {
    const allowed = results.filter((r) => r.allowed).length;
    assert.ok(
      allowed <= capacity && allowed >= capacity - 1,
      `${allowed} of ${results.length} simultaneous requests allowed; capacity is ${capacity}`,
    );
  };

  it("allows `capacity` of 60 simultaneous requests, never more", async () => {
    const key = unique();
    const spec = { capacity: 10, refillEveryMs: 60_000 };
    const results = await Promise.all(
      Array.from({ length: 60 }, () => pgTokenBucket(pool, { key, spec })),
    );
    assertCapacity(results, 10);
    assert.ok(
      results.filter((r) => !r.allowed).every((r) => r.retryAfterMs >= 1 && r.retryAfterMs <= 60_000 + 100),
      "every refusal says how long to wait: one refill interval, plus a few ms of start-time skew",
    );
    // `remaining` counts down as the allowed requests are served, one per
    // request. It is informational and may read one low: each statement takes
    // the database clock when it starts, and one that started a millisecond
    // earlier can win the row lock later, which counts a sliver less refill.
    // That never changes who is allowed (asserted above), only this display.
    const remaining = results
      .filter((r) => r.allowed)
      .map((r) => r.remaining)
      .sort((a, b) => a - b);
    assert.ok(remaining.length >= 9 && remaining.length <= 10);
    remaining.forEach((value, index) => {
      assert.ok(
        value <= index + 1 && value >= index - 1,
        `allowed request #${index + 1} reported ${value} tokens left; sorted: ${remaining.join(",")}`,
      );
    });
  });

  it("allows `capacity` when the refill interval is not a whole number of milliseconds", async () => {
    const key = unique();
    const spec = { capacity: 7, refillEveryMs: 60_000 / 7 };
    const results = await Promise.all(
      Array.from({ length: 30 }, () => pgTokenBucket(pool, { key, spec })),
    );
    assertCapacity(results, 7);
  });

  it("is exact when requests arrive one after another: capacity allowed, the next refused", async () => {
    // No concurrency, so no start-time skew: the count is exact, not approximate.
    const key = unique();
    const spec = { capacity: 7, refillEveryMs: 60_000 / 7 };
    const results = [];
    for (let i = 0; i < 12; i += 1) results.push(await pgTokenBucket(pool, { key, spec }));
    assert.deepEqual(
      results.map((r) => r.allowed),
      [true, true, true, true, true, true, true, false, false, false, false, false],
    );
    assert.deepEqual(
      results.slice(0, 7).map((r) => r.remaining),
      [6, 5, 4, 3, 2, 1, 0],
    );
  });

  it("shares one bucket between independent pools (separate server instances)", async () => {
    const other = new Pool({ connectionString: URL, max: 2 });
    try {
      const key = unique();
      const spec = { capacity: 2, refillEveryMs: 60_000 };
      const a = await pgTokenBucket(pool, { key, spec });
      const b = await pgTokenBucket(other, { key, spec });
      const c = await pgTokenBucket(pool, { key, spec });
      assert.deepEqual([a.allowed, b.allowed, c.allowed], [true, true, false]);
      assert.equal(c.remaining, 0);
    } finally {
      await other.end();
    }
  });

  /**
   * Time passing, without waiting for it. A bucket is one timestamp (when it is
   * full again), so moving that back by `ms` is exactly what `ms` of real time
   * would do. Deterministic: no sleeps to be stretched by a busy machine.
   */
  const rewind = (key: string, ms: number) =>
    pool.query(
      `UPDATE tc_rate_limits SET reset_at = reset_at - make_interval(secs => $2::float8 / 1000) WHERE key = $1`,
      [`tb:${key}`, ms],
    );

  it("tells a refused caller how long to wait, and is right", async () => {
    const key = unique();
    const spec = { capacity: 1, refillEveryMs: 60_000 };
    assert.equal((await pgTokenBucket(pool, { key, spec })).allowed, true);
    const refused = await pgTokenBucket(pool, { key, spec });
    assert.equal(refused.allowed, false);
    assert.ok(
      refused.retryAfterMs > 55_000 && refused.retryAfterMs <= 60_000 + 100,
      `a minute minus the milliseconds already spent, got ${refused.retryAfterMs}`,
    );
    await rewind(key, refused.retryAfterMs - 2_000);
    assert.equal((await pgTokenBucket(pool, { key, spec })).allowed, false, "two seconds early is still too early");
    await rewind(key, 2_000 + 100);
    assert.equal((await pgTokenBucket(pool, { key, spec })).allowed, true, "waiting the advertised time is enough");
  });

  it("refills as time passes and never beyond capacity", async () => {
    const key = unique();
    const spec = { capacity: 2, refillEveryMs: 60_000 };
    await pgTokenBucket(pool, { key, spec });
    await pgTokenBucket(pool, { key, spec });
    assert.equal((await pgTokenBucket(pool, { key, spec })).allowed, false);

    await rewind(key, 70_000); // a minute and a bit: one token back, not two
    const partial = [];
    for (let i = 0; i < 3; i += 1) partial.push((await pgTokenBucket(pool, { key, spec })).allowed);
    assert.deepEqual(partial, [true, false, false], "one token came back");

    await rewind(key, 10 * 60_000); // far longer than a full refill: capped at capacity
    const full = [];
    for (let i = 0; i < 4; i += 1) full.push((await pgTokenBucket(pool, { key, spec })).allowed);
    assert.deepEqual(full, [true, true, false, false], "full again, and no more than capacity");
  });

  it("does not charge for refused requests", async () => {
    const key = unique();
    const spec = { capacity: 1, refillEveryMs: 60_000 };
    await pgTokenBucket(pool, { key, spec });
    for (let i = 0; i < 25; i += 1) {
      assert.equal((await pgTokenBucket(pool, { key, spec })).allowed, false);
    }
    // If each refusal had pushed the deadline back a minute, 25 of them would
    // need 25 more minutes. One minute is enough.
    await rewind(key, 60_000 + 100);
    assert.equal((await pgTokenBucket(pool, { key, spec })).allowed, true);
  });

  it("charges `cost` tokens", async () => {
    const key = unique();
    const spec = { capacity: 10, refillEveryMs: 60_000 };
    assert.equal((await pgTokenBucket(pool, { key, spec, cost: 4 })).remaining, 6);
    assert.equal((await pgTokenBucket(pool, { key, spec, cost: 4 })).remaining, 2);
    assert.equal((await pgTokenBucket(pool, { key, spec, cost: 4 })).allowed, false);
    assert.equal((await pgTokenBucket(pool, { key, spec, cost: 2 })).allowed, true);
  });

  it("keeps different keys independent and stores long keys hashed", async () => {
    const spec = { capacity: 1, refillEveryMs: 60_000 };
    const long = `${unique()}-${"x".repeat(2_000)}`;
    assert.equal((await pgTokenBucket(pool, { key: long, spec })).allowed, true);
    assert.equal((await pgTokenBucket(pool, { key: long, spec })).allowed, false);
    assert.equal((await pgTokenBucket(pool, { key: `${long}!`, spec })).allowed, true);
    const row = await pool.query(`SELECT key FROM tc_rate_limits WHERE key = $1`, [storageKey(`tb:${long}`)]);
    assert.equal(row.rowCount, 1);
    assert.ok(row.rows[0].key.length < 80);
  });

  it("records the latest outcome in `count` and the full-again time in `reset_at`", async () => {
    const key = unique();
    const spec = { capacity: 2, refillEveryMs: 60_000 };
    const read = async () =>
      (await pool.query(`SELECT count, extract(epoch FROM reset_at - now()) AS secs FROM tc_rate_limits WHERE key = $1`, [`tb:${key}`])).rows[0];
    await pgTokenBucket(pool, { key, spec });
    assert.equal((await read()).count, 1, "one token left");
    await pgTokenBucket(pool, { key, spec });
    assert.equal((await read()).count, 0);
    const full = Number((await read()).secs);
    assert.ok(full > 118 && full <= 120, `bucket is full again in ~2 minutes, got ${full}`);
    await pgTokenBucket(pool, { key, spec });
    assert.equal((await read()).count, -1, "a refusal is visible in the table");
    assert.ok(Math.abs(Number((await read()).secs) - full) < 2, "a refusal does not move the deadline");
  });

  it("never reads or disturbs fixed-window rows written by an older release", async () => {
    const key = unique();
    await pool.query(`INSERT INTO tc_rate_limits (key, count, reset_at) VALUES ($1, 999, now() + interval '1 hour')`, [key]);
    const spec = { capacity: 3, refillEveryMs: 60_000 };
    assert.equal((await pgTokenBucket(pool, { key, spec })).allowed, true, "old count of 999 is not mistaken for a drained bucket");
    const legacy = await pool.query(`SELECT count FROM tc_rate_limits WHERE key = $1`, [key]);
    assert.equal(legacy.rows[0].count, 999);
  });

  it("sweeps buckets that have been full for hours and keeps live ones", async () => {
    const stale = unique();
    const live = unique();
    await pool.query(`INSERT INTO tc_rate_limits (key, count, reset_at) VALUES ($1, 3, now() - interval '3 hours')`, [stale]);
    await pgTokenBucket(pool, { key: live, spec: { capacity: 5, refillEveryMs: 60_000 } });
    await pgRateLimitSweep(pool);
    const left = await pool.query(`SELECT key FROM tc_rate_limits WHERE key = ANY($1)`, [[stale, `tb:${live}`]]);
    assert.deepEqual(left.rows.map((r) => r.key), [`tb:${live}`]);
  });

  it("is what takeToken uses when the durable store is on, shared across callers", async () => {
    resetRateLimitState();
    const key = unique();
    const env = { DATABASE_URL: URL, MISSED_CALL_DURABLE_STORE: "1" };
    const spec = { capacity: 2, refillEveryMs: 60_000 };
    const results = [];
    for (let i = 0; i < 3; i += 1) results.push(await takeToken({ key, spec, env }));
    assert.deepEqual(results.map((r) => r.allowed), [true, true, false]);
    assert.ok(results.every((r) => r.tier === "postgres"));
    const row = await pool.query(`SELECT count FROM tc_rate_limits WHERE key = $1`, [`tb:${key}`]);
    assert.equal(row.rows[0]?.count, -1, "the bucket lives in the database, not in this process");
  });

  it("leaves Postgres alone when the caller says it cannot be used there (the Cloudflare proxy bundle)", async () => {
    resetRateLimitState();
    const key = unique();
    const env = { DATABASE_URL: URL, MISSED_CALL_DURABLE_STORE: "1" };
    const spec = { capacity: 2, refillEveryMs: 60_000 };
    const results = [];
    for (let i = 0; i < 3; i += 1) results.push(await takeToken({ key, spec, env, postgres: false }));
    assert.deepEqual(results.map((r) => r.allowed), [true, true, false], "still limited, from memory");
    assert.ok(results.every((r) => r.tier === "memory"));
    const row = await pool.query(`SELECT count FROM tc_rate_limits WHERE key = $1`, [`tb:${key}`]);
    assert.equal(row.rowCount, 0, "nothing was written to the database");
  });

  it("serves 50 rapid requests from 8 'instances' with `capacity` allowed, never more", async () => {
    // Eight pools stand in for eight Worker isolates that each hold a
    // connection of their own. In-memory counters would allow 8 x capacity.
    const instances = Array.from({ length: 8 }, () => new Pool({ connectionString: URL, max: 4 }));
    try {
      const key = unique();
      // Slow refill: the database keeps its own real clock.
      const spec = { capacity: 20, refillEveryMs: 120_000 };
      const results = await Promise.all(
        Array.from({ length: 50 }, (_, i) => pgTokenBucket(instances[i % instances.length], { key, spec })),
      );
      assertCapacity(results, 20);
    } finally {
      await Promise.all(instances.map((p) => p.end()));
    }
  });
});
