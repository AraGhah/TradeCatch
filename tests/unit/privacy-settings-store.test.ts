/**
 * Privacy settings storage: the same contract runs against the in-memory store
 * and the Postgres store on PGlite (real SQL, including migration 040 and its
 * backfill). PGlite suites skip when it is not installed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  createMemoryPrivacyStore,
  createPostgresPrivacyStore,
  type PrivacyAuditRow,
  type PrivacySettingsStore,
  type PrivacyUpdate,
} from "../../src/product/privacy/store";
import { NEW_BUSINESS_DEFAULTS } from "../../src/product/privacy/settings";
import { createPglite, pgliteAvailable, poolOf, type PgliteDb } from "../support/pglite-pool";

const MIGRATION = readFileSync(
  path.join(process.cwd(), "src", "product", "privacy", "privacy-settings.sql"),
  "utf8",
);
const SECURITY_SCHEMA = readFileSync(
  path.join(process.cwd(), "src", "product", "security", "schema.sql"),
  "utf8",
);

/** The tables migration 040 reads, as the earlier migrations create them. */
async function baseSchema(db: PgliteDb) {
  await db.exec(`
    CREATE TABLE mc_schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE tc_organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT 'x', missed_call_client_id TEXT);
    CREATE TABLE rc_profiles (organization_id TEXT PRIMARY KEY REFERENCES tc_organizations (id),
      settings JSONB NOT NULL DEFAULT '{}'::jsonb);
    CREATE TABLE tc_memberships (id TEXT PRIMARY KEY, organization_id TEXT, user_id TEXT, role TEXT);
  `);
  await db.exec(SECURITY_SCHEMA);
}

let auditId = 0;
function update(
  organizationId: string,
  expectedVersion: number,
  patch: PrivacyUpdate["patch"],
  actorUserId = "user_owner",
): PrivacyUpdate {
  auditId += 1;
  return {
    organizationId,
    expectedVersion,
    patch,
    actorUserId,
    at: new Date(Date.UTC(2026, 10, 14, 12, 0, auditId)).toISOString(),
    auditId: `aud_${auditId}`,
  };
}

type Harness = {
  store: PrivacySettingsStore;
  audits(): Promise<{ organizationId: string; detail: string }[]>;
  breakNextWrite(): void;
};

function contract(name: string, make: () => Promise<Harness>, skip = false) {
  describe(`privacy settings store contract: ${name}`, { skip }, () => {
    it("a business that never saved gets the privacy-preserving defaults at version 0", async () => {
      const { store } = await make();
      const settings = await store.get("org_new");
      assert.equal(settings.version, 0);
      assert.equal(settings.callRecordingEnabled, false);
      assert.equal(settings.analyticsEnabled, false);
      assert.equal(settings.customerDataRetentionDays, 90);
      assert.equal(settings.saveCallTranscripts, NEW_BUSINESS_DEFAULTS.saveCallTranscripts);
    });

    it("each setting saves independently, persists, and is audited with old and new values", async () => {
      const h = await make();
      const fields = [
        ["callRecordingEnabled", true],
        ["saveCallTranscripts", false],
        ["saveSmsHistory", false],
        ["customerDataRetentionDays", 180],
        ["analyticsEnabled", true],
      ] as const;
      let version = 0;
      for (const [field, value] of fields) {
        const before = await h.store.get("org_a");
        const result = await h.store.update(update("org_a", version, { [field]: value }));
        assert.ok(result.ok, `${field} save refused`);
        version = result.settings.version;
        const after = await h.store.get("org_a");
        assert.equal(after[field], value, `${field} not stored`);
        // Everything else is exactly what it was.
        for (const [other] of fields) {
          if (other !== field) assert.equal(after[other], before[other], `${field} rewrote ${other}`);
        }
      }
      assert.equal(version, fields.length);
      const audits = await h.audits();
      assert.equal(audits.filter((a) => a.organizationId === "org_a").length, fields.length);
      assert.ok(audits.some((a) => a.detail.includes("callRecordingEnabled:false→true")));
    });

    it("refuses a save made against an older version, changes nothing and writes no audit", async () => {
      const h = await make();
      const first = await h.store.update(update("org_a", 0, { saveSmsHistory: false }));
      assert.ok(first.ok);
      const stale = await h.store.update(update("org_a", 0, { saveSmsHistory: true }));
      assert.equal(stale.ok, false);
      assert.ok(!stale.ok && stale.current.saveSmsHistory === false);
      assert.equal((await h.store.get("org_a")).saveSmsHistory, false);
      assert.equal((await h.audits()).length, 1);
    });

    it("two saves racing from the same version: exactly one wins, the latest confirmed value persists", async () => {
      const h = await make();
      const results = await Promise.all([
        h.store.update(update("org_a", 0, { analyticsEnabled: true })),
        h.store.update(update("org_a", 0, { analyticsEnabled: false, callRecordingEnabled: true })),
      ]);
      const winners = results.filter((r) => r.ok);
      assert.equal(winners.length, 1);
      const stored = await h.store.get("org_a");
      const winner = winners[0]!;
      assert.ok(winner.ok);
      assert.deepEqual(
        [stored.analyticsEnabled, stored.callRecordingEnabled, stored.version],
        [winner.settings.analyticsEnabled, winner.settings.callRecordingEnabled, 1],
      );
      // Rapid successive saves, each from the last confirmed version.
      let version = stored.version;
      for (const value of [true, false, true, false, true]) {
        const r = await h.store.update(update("org_a", version, { saveCallTranscripts: value }));
        assert.ok(r.ok);
        version = r.settings.version;
      }
      assert.equal((await h.store.get("org_a")).saveCallTranscripts, true);
    });

    it("one business's save never touches another's", async () => {
      const h = await make();
      await h.store.update(update("org_b", 0, { callRecordingEnabled: true, customerDataRetentionDays: 180 }));
      const a = await h.store.update(update("org_a", 0, { callRecordingEnabled: false, customerDataRetentionDays: 30 }));
      assert.ok(a.ok);
      const b = await h.store.get("org_b");
      assert.equal(b.callRecordingEnabled, true);
      assert.equal(b.customerDataRetentionDays, 180);
      assert.equal(b.version, 1);
      const many = await h.store.getMany(["org_a", "org_b", "org_c"]);
      assert.equal(many.get("org_a")?.customerDataRetentionDays, 30);
      assert.equal(many.get("org_b")?.customerDataRetentionDays, 180);
      assert.equal(many.get("org_c")?.version, 0);
    });

    it("a failed write leaves the stored value and the audit log unchanged", async () => {
      const h = await make();
      await h.store.update(update("org_a", 0, { analyticsEnabled: true }));
      h.breakNextWrite();
      await assert.rejects(h.store.update(update("org_a", 1, { analyticsEnabled: false })));
      const stored = await h.store.get("org_a");
      assert.equal(stored.analyticsEnabled, true);
      assert.equal(stored.version, 1);
      assert.equal((await h.audits()).length, 1);
    });
  });
}

contract("memory", async () => {
  const rows: PrivacyAuditRow[] = [];
  let failNext = false;
  const store = createMemoryPrivacyStore((row) => {
    if (failNext) {
      failNext = false;
      throw new Error("simulated failure");
    }
    rows.push(row);
  });
  return {
    store,
    audits: async () => rows.map((r) => ({ organizationId: r.organizationId, detail: r.detail })),
    breakNextWrite: () => {
      failNext = true;
    },
  };
});

const available = pgliteAvailable();

contract(
  "postgres (PGlite)",
  async () => {
    const db = await createPglite();
    await baseSchema(db);
    await db.exec(`INSERT INTO tc_organizations (id) VALUES ('org_a'), ('org_b'), ('org_c'), ('org_new')`);
    // Migration 040 on a database whose organizations predate it, then
    // recorded, then the rows those organizations got are cleared so the
    // contract starts from "never saved" like the memory store.
    await db.exec(MIGRATION);
    await db.exec(`DELETE FROM tc_privacy_settings`);
    const pool = poolOf(db);
    return {
      store: createPostgresPrivacyStore(pool),
      audits: async () =>
        (
          await db.query(
            `SELECT organization_id, detail FROM tc_audit_logs WHERE action = 'privacy_settings_updated' ORDER BY created_at`,
          )
        ).rows.map((r) => ({ organizationId: String(r.organization_id), detail: String(r.detail) })),
      breakNextWrite: () => pool.failNext!(/INSERT INTO tc_audit_logs/),
    };
  },
  !available,
);

describe("migration 040 (PGlite)", { skip: !available }, () => {
  it("keeps every existing business's current behavior and honors the recording switch it had", async () => {
    const db = await createPglite();
    await baseSchema(db);
    await db.exec(`
      INSERT INTO tc_organizations (id) VALUES ('org_plain'), ('org_privacy_on'), ('org_phone_on'), ('org_phone_off');
      INSERT INTO tc_recording_permissions (organization_id, recording_enabled, retention_days) VALUES ('org_privacy_on', true, 45);
      INSERT INTO rc_profiles (organization_id, settings) VALUES
        ('org_phone_on', '{"phoneSettings":{"callRecordingEnabled":true}}'),
        ('org_phone_off', '{"phoneSettings":{"callRecordingEnabled":false}}');
    `);
    await db.exec(MIGRATION);
    await db.query(`INSERT INTO mc_schema_migrations (id) VALUES ('040_privacy_settings')`);
    const rows = new Map(
      (await db.query(`SELECT * FROM tc_privacy_settings`)).rows.map((r) => [String(r.organization_id), r]),
    );
    assert.equal(rows.size, 4);
    assert.equal(rows.get("org_plain")?.call_recording_enabled, false);
    assert.equal(rows.get("org_privacy_on")?.call_recording_enabled, true);
    assert.equal(rows.get("org_phone_on")?.call_recording_enabled, true);
    assert.equal(rows.get("org_phone_off")?.call_recording_enabled, false);
    for (const row of rows.values()) {
      assert.equal(row.save_call_transcripts, true);
      assert.equal(row.save_sms_history, true);
      assert.equal(row.analytics_enabled, true);
      assert.equal(row.customer_data_retention_days, null, "an existing business's data would be removed sooner");
      assert.equal(row.version, 1);
    }

    // An owner saves after the migration; a business is created; db:schema runs again.
    await db.exec(`UPDATE tc_privacy_settings SET analytics_enabled = false, version = 2 WHERE organization_id = 'org_plain'`);
    await db.exec(`INSERT INTO tc_organizations (id) VALUES ('org_created_later')`);
    await db.exec(MIGRATION);
    const plain = (await db.query(`SELECT analytics_enabled, version FROM tc_privacy_settings WHERE organization_id = 'org_plain'`)).rows[0];
    assert.deepEqual([plain?.analytics_enabled, plain?.version], [false, 2]);
    const later = await db.query(`SELECT 1 FROM tc_privacy_settings WHERE organization_id = 'org_created_later'`);
    assert.equal(later.rows.length, 0, "a business created after 040 must get the new-business defaults, not legacy values");
    const store = createPostgresPrivacyStore(poolOf(db));
    const created = await store.get("org_created_later");
    assert.deepEqual(
      [created.callRecordingEnabled, created.analyticsEnabled, created.customerDataRetentionDays, created.version],
      [false, false, 90, 0],
    );
  });

  it("rejects a retention period other than 30, 90 or 180 days", async () => {
    const db = await createPglite();
    await baseSchema(db);
    await db.exec(`INSERT INTO tc_organizations (id) VALUES ('org_a')`);
    await db.exec(MIGRATION);
    await assert.rejects(
      db.query(
        `INSERT INTO tc_privacy_settings (organization_id, call_recording_enabled, save_call_transcripts, save_sms_history,
           customer_data_retention_days, analytics_enabled) VALUES ('org_a', false, true, true, 45, false)
         ON CONFLICT (organization_id) DO UPDATE SET customer_data_retention_days = 45`,
      ),
    );
  });
});
