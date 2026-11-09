/**
 * Migration 038 moves the referral rewards to $50 (Essential) and $75
 * (Professional). It runs the REAL schema and migration SQL on PGlite, an
 * in-process PostgreSQL, and proves the part that matters to customers: rewards
 * already earned keep the amount they were earned at.
 *
 * PGlite is optional tooling and is not an app dependency; the suite skips
 * itself when it is not installed:  npm i --no-save @electric-sql/pglite
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import type { Pool } from "pg";
import { createPostgresReferralStore } from "../../src/product/referrals/postgres-store";

const requireFromRepo = createRequire(path.join(process.cwd(), "package.json"));
let available = true;
try {
  requireFromRepo.resolve("@electric-sql/pglite");
} catch {
  available = false;
}

type Db = {
  exec(sql: string): Promise<unknown>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  close(): Promise<void>;
};

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");
const SCHEMA = read("src", "product", "referrals", "schema.sql");
const LAUNCH_SQL = read("src", "product", "saas", "launch-plans.sql");
// 036 also widens plan checks on tables this referral-only database does not have.
const LAUNCH_REFERRAL_SQL = LAUNCH_SQL.slice(
  LAUNCH_SQL.indexOf("-- 2. Referral settings"),
  LAUNCH_SQL.lastIndexOf("COMMIT;"),
);
const MIGRATION_038 = read("src", "product", "referrals", "rewards-by-plan.sql");
const NOW = "2026-10-20T12:00:00.000Z";

async function freshDb(): Promise<Db> {
  const specifier = "@electric-sql/pglite";
  const { PGlite } = (await import(specifier)) as { PGlite: new () => Db };
  const db = new PGlite();
  await db.exec("CREATE TABLE tc_organizations (id TEXT PRIMARY KEY);");
  // The runner's record of applied migrations; production always has it, and
  // 038 consults it so a repeated `npm run db:schema` never rewrites settings.
  await db.exec(
    "CREATE TABLE mc_schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());",
  );
  await db.exec(SCHEMA);
  await db.exec(LAUNCH_REFERRAL_SQL);
  await db.exec("INSERT INTO tc_organizations (id) VALUES ('org_ref'), ('org_new');");
  return db;
}

async function saveSettings(db: Db, essential: number, professional: number) {
  await db.query(
    `INSERT INTO tc_referral_settings (id, program_enabled, reward_starter_cents, reward_growth_cents,
       reward_receptionist_cents, eligible_plans, hold_days, require_referrer_active, fulfillment_method,
       reward_essential_cents, reward_professional_cents, reward_website_bonus_cents)
     VALUES (1, true, 6500, 6500, 6500, ARRAY['essential','professional']::text[], 30, true, 'manual', $1, $2, 3500)`,
    [essential, professional],
  );
}

const poolOf = (db: Db) =>
  ({ query: (sql: string, params?: unknown[]) => db.query(sql, params) }) as unknown as Pool;

describe("migration 038: referral rewards by plan (real PostgreSQL via PGlite)", { skip: !available }, () => {
  it("moves launch-default settings to $50 / $75 and leaves earned rewards at their original amount", async () => {
    const db = await freshDb();
    try {
      await saveSettings(db, 6500, 6500);
      // A reward earned under the old $65 amount, in each state a reward can be in.
      await db.query(
        `INSERT INTO tc_referrals (id, referrer_organization_id, referred_organization_id, referrer_business_name,
           referred_business_name, code, status, review_flags, registered_at, updated_at)
         VALUES ('ref_1', 'org_ref', 'org_new', 'Plomberie Tremblay', 'Toitures Gagnon', 'ABCDEFGHJK', 'qualified', '{}', $1, $1)`,
        [NOW],
      );
      await db.query(
        `INSERT INTO tc_referral_rewards (id, referral_id, kind, referrer_organization_id, referred_organization_id,
           plan, amount_cents, currency, status, livemode, qualifying_session_id, eligible_at, review_flags, created_at, updated_at)
         VALUES ('rwd_old', 'ref_1', 'plan', 'org_ref', 'org_new', 'professional', 6500, 'CAD', 'approved', true, 'cs_old', $1, '{}', $1, $1)`,
        [NOW],
      );

      await db.exec(MIGRATION_038);

      const store = createPostgresReferralStore(poolOf(db));
      const settings = await store.getSettings();
      assert.equal(settings.rewardsCents.essential, 5000);
      assert.equal(settings.rewardsCents.professional, 7500);
      // Everything else about the program is untouched.
      assert.equal(settings.websiteBonusCents, 3500);
      assert.equal(settings.holdDays, 30);
      assert.equal(settings.fulfillmentMethod, "manual");
      assert.deepEqual(settings.eligiblePlans, ["essential", "professional"]);

      const { rows } = await db.query(`SELECT amount_cents, status FROM tc_referral_rewards WHERE id = 'rwd_old'`);
      assert.equal(rows[0]?.amount_cents, 6500, "an earned reward keeps the amount it was earned at");
      assert.equal(rows[0]?.status, "approved");
    } finally {
      await db.close();
    }
  });

  it("leaves a settings row an administrator customised alone", async () => {
    const db = await freshDb();
    try {
      await saveSettings(db, 4000, 6000);
      await db.exec(MIGRATION_038);
      const settings = await createPostgresReferralStore(poolOf(db)).getSettings();
      assert.equal(settings.rewardsCents.essential, 4000);
      assert.equal(settings.rewardsCents.professional, 6000);
    } finally {
      await db.close();
    }
  });

  it("does not rewrite settings again once 038 is recorded (repeated db:schema runs)", async () => {
    const db = await freshDb();
    try {
      await saveSettings(db, 6500, 6500);
      await db.exec(MIGRATION_038); // first application: launch defaults -> $50 / $75
      await db.exec("INSERT INTO mc_schema_migrations (id) VALUES ('038_referral_rewards_by_plan')");
      // An administrator later chooses $65 / $65 on purpose.
      await db.query(
        "UPDATE tc_referral_settings SET reward_essential_cents = 6500, reward_professional_cents = 6500 WHERE id = 1",
      );
      await db.exec(MIGRATION_038); // the runner re-applies every file on each run
      const settings = await createPostgresReferralStore(poolOf(db)).getSettings();
      assert.equal(settings.rewardsCents.essential, 6500);
      assert.equal(settings.rewardsCents.professional, 6500);
    } finally {
      await db.close();
    }
  });

  it("changes the column defaults, so a row created later starts at $50 / $75", async () => {
    const db = await freshDb();
    try {
      await db.exec(MIGRATION_038);
      await db.query(
        `INSERT INTO tc_referral_settings (id, program_enabled, reward_starter_cents, reward_growth_cents,
           reward_receptionist_cents, eligible_plans, hold_days, require_referrer_active, fulfillment_method)
         VALUES (1, true, 6500, 6500, 6500, ARRAY['essential','professional']::text[], 30, true, 'none')`,
      );
      const { rows } = await db.query(
        `SELECT reward_essential_cents AS e, reward_professional_cents AS p FROM tc_referral_settings WHERE id = 1`,
      );
      assert.deepEqual([rows[0]?.e, rows[0]?.p], [5000, 7500]);
    } finally {
      await db.close();
    }
  });

  it("is safe to run twice, and with no settings row at all", async () => {
    const db = await freshDb();
    try {
      await db.exec(MIGRATION_038);
      await db.exec(MIGRATION_038);
      const settings = await createPostgresReferralStore(poolOf(db)).getSettings();
      // No row: the application defaults apply.
      assert.equal(settings.rewardsCents.essential, 5000);
      assert.equal(settings.rewardsCents.professional, 7500);
    } finally {
      await db.close();
    }
  });
});
