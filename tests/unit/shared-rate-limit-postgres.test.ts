import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { pgRateLimit, pgRateLimitSweep, storageKey } from "../../src/lib/pg-rate-limit";
import { rateLimitAsync } from "../../src/lib/rate-limit";
import { closePgPool } from "../../src/product/missed-call/postgres-store";

/**
 * Runs against a real Postgres that already has src/product/security/schema.sql
 * applied (a throwaway container is enough):
 *   SECURITY_TEST_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/db npm run test:unit
 */
const URL = process.env.SECURITY_TEST_DATABASE_URL?.trim();

describe("Postgres-backed rate limit", { skip: URL ? undefined : "set SECURITY_TEST_DATABASE_URL to run against Postgres" }, () => {
  let pool: Pool;
  const unique = () => `pg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  before(() => {
    pool = new Pool({ connectionString: URL, max: 20 });
  });
  after(async () => {
    await pool.end();
    await closePgPool();
  });

  it("allows exactly `limit` of many simultaneous requests", async () => {
    const key = unique();
    const results = await Promise.all(
      Array.from({ length: 60 }, () => pgRateLimit(pool, { key, limit: 10, windowMs: 60_000 })),
    );
    assert.equal(results.filter((r) => r.allowed).length, 10);
    assert.equal(results.filter((r) => !r.allowed).length, 50);
    assert.ok(results.every((r) => r.resetAt > Date.now() && r.resetAt <= Date.now() + 61_000));
  });

  it("shares one budget between independent pools (separate server instances)", async () => {
    const other = new Pool({ connectionString: URL, max: 2 });
    try {
      const key = unique();
      const a = await pgRateLimit(pool, { key, limit: 2, windowMs: 60_000 });
      const b = await pgRateLimit(other, { key, limit: 2, windowMs: 60_000 });
      const c = await pgRateLimit(pool, { key, limit: 2, windowMs: 60_000 });
      assert.deepEqual([a.allowed, b.allowed, c.allowed], [true, true, false]);
      assert.equal(c.remaining, 0);
    } finally {
      await other.end();
    }
  });

  it("starts a new window once the old one has ended", async () => {
    const key = unique();
    assert.equal((await pgRateLimit(pool, { key, limit: 1, windowMs: 300 })).allowed, true);
    assert.equal((await pgRateLimit(pool, { key, limit: 1, windowMs: 300 })).allowed, false);
    await new Promise((resolve) => setTimeout(resolve, 450));
    const fresh = await pgRateLimit(pool, { key, limit: 1, windowMs: 300 });
    assert.equal(fresh.allowed, true);
    assert.equal(fresh.remaining, 0);
  });

  it("keeps different keys independent and stores long keys hashed", async () => {
    const long = `${unique()}-${"x".repeat(2_000)}`;
    assert.equal((await pgRateLimit(pool, { key: long, limit: 1, windowMs: 60_000 })).allowed, true);
    assert.equal((await pgRateLimit(pool, { key: long, limit: 1, windowMs: 60_000 })).allowed, false);
    assert.equal((await pgRateLimit(pool, { key: `${long}!`, limit: 1, windowMs: 60_000 })).allowed, true);
    const row = await pool.query(`SELECT key FROM tc_rate_limits WHERE key = $1`, [storageKey(long)]);
    assert.equal(row.rowCount, 1);
    assert.ok(row.rows[0].key.length < 80);
  });

  it("sweeps windows that ended long ago and keeps live ones", async () => {
    const stale = unique();
    const live = unique();
    await pool.query(`INSERT INTO tc_rate_limits (key, count, reset_at) VALUES ($1, 3, now() - interval '3 hours')`, [stale]);
    await pgRateLimit(pool, { key: live, limit: 5, windowMs: 60_000 });
    await pgRateLimitSweep(pool);
    const left = await pool.query(`SELECT key FROM tc_rate_limits WHERE key = ANY($1)`, [[stale, live]]);
    assert.deepEqual(left.rows.map((r) => r.key), [live]);
  });

  it("is what rateLimitAsync uses when the durable store is on", async () => {
    const key = unique();
    const env = { DATABASE_URL: URL, MISSED_CALL_DURABLE_STORE: "1" };
    const results = [];
    for (let i = 0; i < 3; i += 1) results.push((await rateLimitAsync({ key, limit: 2, windowMs: 60_000, env })).allowed);
    assert.deepEqual(results, [true, true, false]);
    const row = await pool.query(`SELECT count FROM tc_rate_limits WHERE key = $1`, [key]);
    assert.equal(row.rows[0]?.count, 3, "the counter lives in the database, not in this process");
  });
});
