/**
 * `npm run db:schema` re-applies every migration file on each run, so every file
 * must be repeatable and no data statement may overwrite what customers saved
 * after the first run. This runs the real script, twice, against a fresh
 * database it creates on the server named by SCHEMA_RUNNER_TEST_DATABASE_URL
 * (a disposable local server only, never a shared or production one). The suite
 * skips itself when the variable is not set.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { Client } from "pg";

const serverUrl = process.env.SCHEMA_RUNNER_TEST_DATABASE_URL?.trim();

function runSchema(databaseUrl: string) {
  const result = spawnSync(process.execPath, ["scripts/apply-missed-call-schema.js"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(result.status, 0, `db:schema failed: ${result.stderr || result.stdout}`);
}

describe("db:schema is repeatable (real PostgreSQL)", { skip: !serverUrl }, () => {
  it("runs twice and leaves settings customers saved after the first run untouched", async () => {
    const admin = new Client({ connectionString: serverUrl });
    await admin.connect();
    const name = `tc_schema_runner_${randomBytes(4).toString("hex")}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const target = new URL(serverUrl!);
    target.pathname = `/${name}`;
    const db = new Client({ connectionString: target.toString() });
    try {
      runSchema(target.toString());

      await db.connect();
      // Saved by an owner after the first run.
      await db.query(
        `INSERT INTO tc_notification_preferences (organization_id, user_id, settings_json, updated_at)
         VALUES ('org-keep', 'user-keep', '{"dailySummary": true}'::jsonb, now())`,
      );
      // An administrator who chose $65 / $65 on purpose after migration 038 was recorded.
      await db.query(
        `INSERT INTO tc_referral_settings (id, program_enabled, reward_starter_cents, reward_growth_cents,
           reward_receptionist_cents, eligible_plans, hold_days, require_referrer_active, fulfillment_method,
           reward_essential_cents, reward_professional_cents)
         VALUES (1, true, 6500, 6500, 6500, ARRAY['essential','professional']::text[], 30, true, 'manual', 6500, 6500)`,
      );

      runSchema(target.toString());

      const prefs = await db.query(
        `SELECT settings_json->>'dailySummary' AS daily FROM tc_notification_preferences WHERE organization_id = 'org-keep'`,
      );
      assert.equal(prefs.rows[0]?.daily, "true", "a repeated run switched a daily summary off");
      const rewards = await db.query(
        `SELECT reward_essential_cents AS e, reward_professional_cents AS p FROM tc_referral_settings WHERE id = 1`,
      );
      assert.deepEqual([rewards.rows[0]?.e, rewards.rows[0]?.p], [6500, 6500]);

      const recorded = await db.query(`SELECT id FROM mc_schema_migrations`);
      const ids = new Set(recorded.rows.map((row) => row.id));
      for (const id of ["037_password_auth", "038_referral_rewards_by_plan", "039_auth_sessions", "030_billing_v2"]) {
        assert.ok(ids.has(id), `${id} not recorded`);
      }
      const objects = await db.query(
        `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_name IN
                  ('tc_user_passwords','tc_password_tokens','tc_usage_overage_confirmations','tc_usage_overage_invoices',
                   'tc_refresh_tokens','tc_account_recovery_requests'))::int AS tables,
                (SELECT count(*) FROM information_schema.columns
                  WHERE table_name = 'tc_org_settings' AND column_name = 'quote_followup_approved_at')::int AS col`,
      );
      assert.equal(objects.rows[0]?.tables, 6);
      assert.equal(objects.rows[0]?.col, 1);
    } finally {
      await db.end().catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined);
      await admin.end();
    }
  });
});
