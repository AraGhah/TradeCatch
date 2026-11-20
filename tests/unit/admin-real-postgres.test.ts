import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { withAdvisoryLock } from "../../src/product/admin-console/db";
import {
  openAdminConsoleDb,
  poolOf,
  realPgUrl,
  type Db,
} from "./support/pglite-db";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * What PGlite cannot show: it has one connection, so a lock that serialises work across
 * connections (two server instances creating the same customer at once) was only ever
 * exercised through an injected stand-in. These run against a real server and skip unless
 * TEST_DATABASE_URL points at a local throwaway one:
 *   TEST_DATABASE_URL=postgres://postgres:...@127.0.0.1:54329/postgres npm run test:unit
 */
describe("admin console locking on a real PostgreSQL server", { skip: !realPgUrl }, () => {
  let db: Db;
  before(async () => {
    db = await openAdminConsoleDb();
  });
  after(async () => {
    await db.close();
  });

  /** Advisory locks still held in this test's database. A leak would hide behind a reused connection. */
  async function heldAdvisoryLocks(): Promise<number> {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM pg_locks
        WHERE locktype = 'advisory'
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
    );
    return Number(rows[0]?.n);
  }

  it("serialises work for one key across separate connections, and releases the lock", async () => {
    const pool = poolOf(db);
    let inside = 0;
    let peak = 0;
    let done = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        withAdvisoryLock(pool, "tc-admin-create:same@owner.ca", async () => {
          inside += 1;
          peak = Math.max(peak, inside);
          await sleep(20);
          inside -= 1;
          done += 1;
        }),
      ),
    );
    assert.equal(done, 6);
    assert.equal(peak, 1, "two callers were inside the locked section at once");
    assert.equal(await heldAdvisoryLocks(), 0);
  });

  it("lets different keys run at the same time", async () => {
    const pool = poolOf(db);
    let aStarted = false;
    let bStarted = false;
    const waitFor = async (seen: () => boolean) => {
      for (let i = 0; i < 100 && !seen(); i += 1) await sleep(10);
      return seen();
    };
    const results = await Promise.all([
      withAdvisoryLock(pool, "tc-admin-create:a@owner.ca", async () => {
        aStarted = true;
        return waitFor(() => bStarted);
      }),
      withAdvisoryLock(pool, "tc-admin-create:b@owner.ca", async () => {
        bStarted = true;
        return waitFor(() => aStarted);
      }),
    ]);
    assert.deepEqual(results, [true, true], "an unrelated key was blocked by another one");
    assert.equal(await heldAdvisoryLocks(), 0);
  });

  it("releases the lock when the work throws", async () => {
    const pool = poolOf(db);
    await assert.rejects(
      withAdvisoryLock(pool, "tc-admin-create:boom@owner.ca", async () => {
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(await heldAdvisoryLocks(), 0, "the lock leaked after a failure");
    const next = await Promise.race([
      withAdvisoryLock(pool, "tc-admin-create:boom@owner.ca", async () => "ok"),
      sleep(3000).then(() => "timed out waiting for the lock"),
    ]);
    assert.equal(next, "ok");
  });
});
