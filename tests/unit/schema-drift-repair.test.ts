/**
 * The 2026-11-25 production state, rebuilt on a disposable database: 012_scheduling
 * recorded, the Cal.com and Google Calendar structures (060/061/062) absent.
 * Proves that --check sees it, that --apply no longer skips it silently, that the
 * repair restores everything without touching existing rows, and that a fresh
 * database is reported fully up to date (zero missing).
 *
 * Runs against SCHEMA_RUNNER_TEST_DATABASE_URL (a disposable local server only,
 * never a shared or production one); skips itself when it is not set.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { Client } from "pg";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { checkWith, applyWith } = require("../../scripts/schema-targeted.js");

const serverUrl = process.env.SCHEMA_RUNNER_TEST_DATABASE_URL?.trim();
const REPAIR = [
  "060_scheduling_confirmation_recovery",
  "061_scheduling_calcom",
  "062_scheduling_google_sync",
];

function runSchema(databaseUrl: string) {
  const result = spawnSync(process.execPath, ["scripts/apply-missed-call-schema.js"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    timeout: 180_000,
  });
  assert.equal(result.status, 0, `db:schema failed: ${result.stderr || result.stdout}`);
}

async function check(db: Client) {
  const lines: string[] = [];
  const behind: number = await checkWith(db, { log: (line: string) => lines.push(line) });
  return { behind, missing: lines.filter((line) => line.startsWith("MISSING")) };
}

describe("schema drift repair (real PostgreSQL)", { skip: !serverUrl }, () => {
  it("detects, refuses to skip, and repairs a recorded 012 without the later scheduling steps", async () => {
    const admin = new Client({ connectionString: serverUrl });
    await admin.connect();
    const name = `tc_schema_drift_${randomBytes(4).toString("hex")}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const target = new URL(serverUrl!);
    target.pathname = `/${name}`;
    const db = new Client({ connectionString: target.toString() });
    const quiet = { log: () => undefined };
    try {
      runSchema(target.toString());
      await db.connect();

      // A database built by the repository is complete.
      assert.deepEqual(await check(db), { behind: 0, missing: [] });

      // Production as found: 012 as first recorded, nothing from 060/061/062.
      await db.query(`
        DROP TABLE tc_calcom_bookings, tc_calcom_connections, tc_gcal_event_links, tc_gcal_events;
        DROP INDEX tc_calendar_sync_state_channel, tc_schedule_pending_confirmations;
        ALTER TABLE tc_calendar_connections
          DROP COLUMN event_detail, DROP COLUMN cancel_policy, DROP COLUMN connected_at;
        ALTER TABLE tc_calendar_sync_state
          DROP COLUMN calendar_id, DROP COLUMN channel_token_hash, DROP COLUMN channel_id,
          DROP COLUMN resource_id, DROP COLUMN last_message_number, DROP COLUMN last_full_sync_at,
          DROP COLUMN last_error, DROP COLUMN consecutive_failures, DROP COLUMN next_attempt_at,
          DROP COLUMN lease_until, DROP COLUMN rerun_requested;
        ALTER TABLE tc_schedule_appointments DROP COLUMN confirmation_notices_pending;
        ALTER TABLE tc_availability_rules DROP CONSTRAINT tc_availability_rules_calendar_mode_check;
        ALTER TABLE tc_availability_rules ADD CONSTRAINT tc_availability_rules_calendar_mode_check
          CHECK (calendar_mode IN ('simulated', 'google', 'internal'));
        DELETE FROM mc_schema_migrations WHERE id IN ('060_scheduling_confirmation_recovery',
          '061_scheduling_calcom', '062_scheduling_google_sync');
      `);
      // Data that existed before the repair.
      await db.query(`INSERT INTO tc_organizations (id, name, slug) VALUES ('org-keep', 'Keep', 'keep')`);
      await db.query(`INSERT INTO tc_availability_rules (organization_id, calendar_mode) VALUES ('org-keep', 'google')`);
      await db.query(`INSERT INTO tc_calendar_connections (organization_id, status, calendar_id, token_ciphertext)
        VALUES ('org-keep', 'connected', 'cal-keep', 'sealed-keep')`);
      await db.query(`INSERT INTO tc_calendar_sync_state (organization_id, sync_token, channel_token, last_synced_at)
        VALUES ('org-keep', 'sync-keep', 'legacy-keep', '2026-11-01T00:00:00Z')`);
      // Every value that existed before the repair, as text, read the same way both times.
      const snapshot = async () =>
        (
          await db.query(
            `SELECT c.organization_id, c.status, c.calendar_id, c.token_ciphertext, c.updated_at::text AS c_updated,
               s.sync_token, s.channel_token, s.last_synced_at::text AS s_synced,
               r.calendar_mode, r.updated_at::text AS r_updated
             FROM tc_calendar_connections c JOIN tc_calendar_sync_state s USING (organization_id)
             JOIN tc_availability_rules r USING (organization_id)`,
          )
        ).rows;
      const before = await snapshot();
      assert.equal(before.length, 1);

      const drifted = await check(db);
      assert.equal(drifted.behind, 3);
      assert.ok(drifted.missing.every((line) => REPAIR.some((id) => line.includes(id))));
      assert.match(drifted.missing.join("\n"), /table tc_calcom_connections.*table tc_calcom_bookings/);
      assert.match(drifted.missing.join("\n"), /column tc_calendar_sync_state\.last_error/);

      // The old failure mode: an id recorded without its tables is refused, not skipped.
      await db.query(`INSERT INTO mc_schema_migrations (id) VALUES ('061_scheduling_calcom')`);
      await assert.rejects(applyWith(db, ["061_scheduling_calcom"], quiet), /Recorded migration 061_scheduling_calcom is incomplete/);
      await db.query(`DELETE FROM mc_schema_migrations WHERE id = '061_scheduling_calcom'`);

      // 012 itself is complete and stays untouched.
      const lines: string[] = [];
      await applyWith(db, ["012_scheduling", ...REPAIR], { log: (line: string) => lines.push(line) });
      assert.deepEqual(lines, [
        "skip  012_scheduling (already recorded and complete)",
        ...REPAIR.map((id) => `apply ${id}`),
      ]);

      assert.deepEqual(await check(db), { behind: 0, missing: [] });

      assert.deepEqual(await snapshot(), before, "the repair changed an existing row");
      assert.equal(before[0].channel_token, "legacy-keep");
      const added = await db.query(
        `SELECT c.event_detail, s.consecutive_failures FROM tc_calendar_connections c
         JOIN tc_calendar_sync_state s USING (organization_id)`,
      );
      assert.deepEqual(added.rows, [{ event_detail: "minimal", consecutive_failures: 0 }]);
      // The widened check accepts the new provider.
      await db.query(`UPDATE tc_availability_rules SET calendar_mode = 'calcom' WHERE organization_id = 'org-keep'`);

      // Repeatable: a second targeted run skips everything, and a full replay still succeeds.
      const again: string[] = [];
      await applyWith(db, REPAIR, { log: (line: string) => again.push(line) });
      assert.ok(again.every((line) => line.startsWith("skip ")));
      await db.end();
      runSchema(target.toString());
    } finally {
      await db.end().catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined);
      await admin.end();
    }
  });
});
