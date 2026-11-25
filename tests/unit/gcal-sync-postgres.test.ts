/**
 * The Google Calendar sync scenarios (SYNC-03..18) against the real SQL in
 * schema.sql: the same scenarios the in-memory run uses, so the two stores
 * cannot disagree.
 *
 * Default: PGlite, an in-process PostgreSQL with ONE connection. That proves the
 * SQL is valid and behaves like the memory store, but it cannot prove two
 * Workers contend correctly (row claims, leases, advisory locks).
 *
 * For that, point TEST_DATABASE_URL at a throwaway LOCAL Postgres, for example
 *   docker run --rm -d --name tc-kan22-pg -e POSTGRES_PASSWORD=pw -p 127.0.0.1:54329:5432 postgres:16-alpine
 *   TEST_DATABASE_URL=postgres://postgres:pw@127.0.0.1:54329/postgres
 * The suite builds its own schema (dropped afterwards) and refuses any host
 * that is not local, so it can never touch a real database.
 */
import { randomBytes } from "node:crypto";
import { after, before, describe } from "node:test";
import { Pool } from "pg";
import { setPgPoolForTests } from "../../src/product/missed-call/postgres-store";
import { createPostgresSchedulingStore } from "../../src/product/scheduling/postgres-store";
import {
  createPglite,
  pgliteAvailable,
  poolOf,
  type PgliteDb,
} from "../support/pglite-pool";
import { registerSyncScenarios } from "./gcal-scenarios";
import { schedulingSchemaSql } from "../support/scheduling-schema";
import assert from "node:assert/strict";
import { it } from "node:test";
import {
  createHarness,
  MONDAY_10,
  OWNER,
  useGoogleEnv,
} from "./support/gcal-harness";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/;

function realServerUrl(): string | null {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return null;
  const host = new URL(url).hostname;
  if (!LOCAL_HOST.test(host)) {
    throw new Error(
      `TEST_DATABASE_URL must point at a local database, not "${host}": this suite creates and drops a schema.`,
    );
  }
  return url;
}

const realUrl = realServerUrl();
const usable = Boolean(realUrl) || pgliteAvailable();
const STORE_URL = "postgres://pglite.test/gcal";

describe(
  `KAN-22 Google Calendar sync on real SQL (${realUrl ? "PostgreSQL server" : "PGlite"})`,
  { skip: !usable && "PGlite is not installed (npm i --no-save @electric-sql/pglite)" },
  () => {
    let pool: Pool;
    let db: PgliteDb | undefined;
    let admin: Pool | undefined;
    let schemaName = "";

    before(async () => {
      const schema = schedulingSchemaSql();
      const stubs = `
        CREATE TABLE mc_schema_migrations (id TEXT PRIMARY KEY);
        CREATE TABLE tc_organizations (id TEXT PRIMARY KEY);
      `;
      if (realUrl) {
        schemaName = `kan22_${randomBytes(4).toString("hex")}`;
        admin = new Pool({ connectionString: realUrl, max: 1 });
        await admin.query(`CREATE SCHEMA ${schemaName}`);
        // Several connections, as in production: this is what lets claims and locks contend.
        pool = new Pool({
          connectionString: realUrl,
          max: 10,
          options: `-c search_path=${schemaName}`,
        });
        await pool.query(stubs);
        await pool.query(schema);
      } else {
        db = await createPglite();
        await db.exec(stubs);
        await db.exec(schema);
        pool = poolOf(db) as unknown as Pool;
      }
      setPgPoolForTests(pool);
    });

    after(async () => {
      setPgPoolForTests(null);
      if (realUrl) {
        await pool.end();
        await admin?.query(`DROP SCHEMA ${schemaName} CASCADE`);
        await admin?.end();
      } else {
        await db?.close();
      }
    });

    /** Every test starts from empty tables, with the two businesses the scenarios use. */
    async function reset() {
      const { rows } = await pool.query(
        `SELECT tablename FROM pg_tables
          WHERE schemaname = current_schema() AND tablename <> 'mc_schema_migrations'`,
      );
      const names = (rows as { tablename: string }[]).map((row) => row.tablename);
      if (names.length) await pool.query(`TRUNCATE ${names.join(", ")} CASCADE`);
      await pool.query(`INSERT INTO tc_organizations (id) VALUES ('org_a'), ('org_b')`);
    }

    const make = async (options?: Parameters<typeof createHarness>[0]) => {
      await reset();
      return createHarness({
        ...options,
        store: createPostgresSchedulingStore(STORE_URL),
      });
    };
    registerSyncScenarios(make);

    describe("what is physically stored", () => {
      it("keeps no readable token, channel secret or private event text in any table", async () => {
        const restore = useGoogleEnv();
        try {
          const h = await make();
          h.google.ownerAdds(OWNER, {
            start: "2026-10-19T19:00:00Z",
            end: "2026-10-19T20:00:00Z",
            summary: "Oncologist appointment",
          });
          await h.connect();
          await h.book("org_a", MONDAY_10);
          await h.sync.pull("org_a");

          const { rows } = await pool.query(
            `SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`,
          );
          let everything = "";
          for (const { tablename } of rows as { tablename: string }[]) {
            const dump = await pool.query(`SELECT row_to_json(t) AS r FROM ${tablename} t`);
            everything += JSON.stringify(dump.rows);
          }
          const channel = h.google.latestChannel()!;
          const connection = await h.store.getConnection("org_a");
          assert.ok(connection?.tokenCiphertext, "the credential is stored, sealed");
          for (const secret of [
            "rt:" + OWNER, // the refresh token
            "at:" + OWNER, // an access token
            channel.token, // the channel secret
            "client-secret",
            "Oncologist",
            "private.example",
            "Private notes",
          ]) {
            assert.ok(!everything.includes(secret), `"${secret}" must not be readable in the database`);
          }
          assert.ok(everything.includes(channel.id), "the channel id itself is not secret");
        } finally {
          restore();
        }
      });

      it("lets two workers push at once without sending any change twice", async () => {
        const restore = useGoogleEnv();
        try {
          const h = await make();
          await h.connect();
          // Several appointments whose events are still waiting to go out.
          h.google.down = true;
          // Two hours apart: a booking needs its 30-minute buffer on each side.
          const times = [0, 1, 2, 3, 4].map((i) => `2026-10-19T${String(12 + i * 2).padStart(2, "0")}:00:00.000Z`);
          for (const t of times) {
            assert.equal((await h.book("org_a", t, { requestIfUnavailable: false })).confirmed, true);
          }
          assert.equal(h.google.tradecatchEvents(OWNER).length, 0);
          assert.equal((await h.sync.summary("org_a")).pending, times.length);

          h.google.down = false;
          h.google.latencyMs = 25; // long enough for the workers to overlap
          h.advance(60 * 60_000);
          h.google.clearCalls();
          await Promise.all([
            h.sync.push({ organizationId: "org_a" }),
            h.sync.push({ organizationId: "org_a" }),
            h.sync.push({ organizationId: "org_a" }),
          ]);
          h.google.latencyMs = 0;

          const creates = h.google.calls.filter((c) => c.method === "POST" && c.path.endsWith("/events"));
          assert.equal(creates.length, times.length, "each change was sent by exactly one worker");
          assert.equal(h.google.tradecatchEvents(OWNER).length, times.length);
          assert.equal((await h.sync.summary("org_a")).pending, 0);
        } finally {
          restore();
        }
      });
    });
  },
);
