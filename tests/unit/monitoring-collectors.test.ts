/**
 * KAN-28 collectors on the REAL product schemas (PGlite): receptionist, SMS
 * automation, scheduling, Stripe billing, notifications, missed-call,
 * reliability and the 063 monitoring migration. Only tc_organizations is a stub
 * (the real one drags in unrelated tables); it carries the columns the queries
 * read (status, account_type).
 *
 * Proves the SQL against the real column names and status vocabularies, that
 * test/demo/simulated data never raises an alert, that a normal caller hang-up
 * is not a failure (MON-05), and that one broken signal degrades alone.
 * Skips when PGlite is not installed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { collectSignals, probeDatabase } from "../../src/product/reliability/collectors";
import { createPostgresReliabilityStore } from "../../src/product/reliability/postgres-store";
import { evaluateSignals } from "../../src/product/reliability/rules";
import { DEFAULT_THRESHOLDS as T } from "../../src/product/reliability/thresholds";
import { createPglite, pgliteAvailable, poolOf, type PgliteDb } from "../support/pglite-pool";

const NOW = new Date("2026-11-20T15:00:00.000Z");
const MIN = 60_000;
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MIN).toISOString();
const schema = (...segments: string[]) =>
  readFileSync(path.join(process.cwd(), "src", "product", ...segments), "utf8");

describe("monitoring collectors on real SQL (PGlite)", { skip: !pgliteAvailable() && "PGlite not installed" }, () => {
  let db: PgliteDb;
  let pool: ReturnType<typeof poolOf>;
  let seq = 0;
  const id = (prefix: string) => `${prefix}_${(seq += 1)}`;

  before(async () => {
    db = await createPglite();
    await db.exec(`
      CREATE TABLE mc_schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE mc_ops_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE tc_organizations (
        id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT 'x', slug TEXT NOT NULL DEFAULT 's',
        plan TEXT NOT NULL DEFAULT 'starter', status TEXT NOT NULL DEFAULT 'active',
        account_type TEXT NOT NULL DEFAULT 'production',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE tc_memberships (id TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'owner');
    `);
    for (const file of [
      ["receptionist", "schema.sql"],
      ["sms-automation", "schema.sql"],
      ["scheduling", "schema.sql"],
      ["scheduling", "060-confirmation-recovery.sql"],
      ["scheduling", "061-calcom.sql"],
      ["scheduling", "062-google-sync.sql"],
      ["saas", "stripe-billing.sql"],
      ["notifications", "schema.sql"],
      ["missed-call", "schema.sql"],
      ["reliability", "schema.sql"],
      ["reliability", "monitoring.sql"],
    ])
      await db.exec(schema(...file));
    pool = poolOf(db);
  });
  after(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.exec(`
      DELETE FROM rc_call_sessions; DELETE FROM tc_sms_executions; DELETE FROM tc_sms_jobs; DELETE FROM tc_sms_automations;
      DELETE FROM mc_outbound_messages; DELETE FROM mc_clients; DELETE FROM tc_notification_deliveries;
      DELETE FROM tc_calendar_connections; DELETE FROM tc_system_errors; DELETE FROM tc_stripe_subscriptions;
      DELETE FROM tc_stripe_customers; DELETE FROM tc_organizations;
      INSERT INTO tc_organizations (id, status, account_type) VALUES
        ('org_live', 'active', 'production'), ('org_pilot', 'active', 'pilot'), ('org_demo', 'active', 'demo'),
        ('org_suspended', 'suspended', 'production');
    `);
  });

  const collect = () => collectSignals(pool, NOW, T);

  async function call(status: string, startedMinutesAgo: number, over: { outcome?: string; finalized?: boolean; updatedMinutesAgo?: number } = {}) {
    await db.query(
      `INSERT INTO rc_call_sessions (id, call_sid, config_id, client_account_id, from_e164, status, outcome, started_at, finalized_at, data, updated_at)
       VALUES ($1,$2,'cfg','client','+15145550100',$3,$4,$5,$6,'{}'::jsonb,$7)`,
      [
        id("rcs"),
        id("CA"),
        status,
        over.outcome ?? null,
        ago(startedMinutesAgo),
        over.finalized === false ? null : ago(startedMinutesAgo - 1),
        ago(over.updatedMinutesAgo ?? startedMinutesAgo),
      ],
    );
  }

  describe("calls", () => {
    it("MON-04: failed sessions in the window are counted against the total", async () => {
      for (let i = 0; i < 4; i += 1) await call("failed", 5 + i);
      for (let i = 0; i < 3; i += 1) await call("completed", 4 + i, { outcome: "message_taken" });
      await call("failed", 120); // outside the window
      const { signals } = await collect();
      assert.equal(signals.calls.failedSessions, 4);
      assert.equal(signals.calls.totalSessions, 7);
      assert.ok(evaluateSignals(signals, T).some((f) => f.fingerprint === "receptionist:calls_failed" && f.priority === "high"));
    });

    it("MON-05: callers who simply hang up are not failures, however many there are", async () => {
      for (let i = 0; i < 12; i += 1) await call("completed", 3 + (i % 8), { outcome: "caller_hung_up" });
      const { signals } = await collect();
      assert.equal(signals.calls.failedSessions, 0);
      assert.equal(signals.calls.hungUpSessions, 12);
      assert.deepEqual(evaluateSignals(signals, T), []);
    });

    it("counts calls with no final status only after the stale period, and not finished ones", async () => {
      for (let i = 0; i < 3; i += 1) await call("in_progress", 60, { finalized: false, updatedMinutesAgo: 45 });
      await call("in_progress", 4, { finalized: false, updatedMinutesAgo: 1 }); // a live call
      await call("completed", 60, { outcome: "message_taken", updatedMinutesAgo: 45 }); // finalized long ago
      const { signals } = await collect();
      assert.equal(signals.calls.staleUnfinalized, 3);
      assert.ok(evaluateSignals(signals, T).some((f) => f.fingerprint === "receptionist:calls_without_final_status"));
    });
  });

  describe("text messages (MON-06)", () => {
    async function automation() {
      await db.query(`INSERT INTO tc_sms_automations (id, organization_id, type) VALUES ('auto1', 'org_live', 'missed_call_followup') ON CONFLICT DO NOTHING`);
    }
    async function job(status: string, over: { simulated?: boolean; updatedMinutesAgo?: number; scheduledMinutesAgo?: number; attempts?: number; claimedMinutesAgo?: number } = {}) {
      await automation();
      await db.query(
        `INSERT INTO tc_sms_jobs (id, organization_id, automation_id, automation_type, idempotency_key, scheduled_at, status, attempts, claimed_at, customer_phone_e164, simulated, updated_at)
         VALUES ($1,'org_live','auto1','missed_call_followup',$2,$3,$4,$5,$6,'+15145550101',$7,$8)`,
        [
          id("job"),
          id("idem"),
          ago(over.scheduledMinutesAgo ?? 10),
          status,
          over.attempts ?? 0,
          over.claimedMinutesAgo === undefined ? null : ago(over.claimedMinutesAgo),
          over.simulated ?? false,
          ago(over.updatedMinutesAgo ?? 5),
        ],
      );
    }

    it("adds failures and totals across automation jobs, missed-call texts and owner alerts, skipping simulated ones", async () => {
      for (let i = 0; i < 4; i += 1) await job("failed");
      for (let i = 0; i < 3; i += 1) await job("delivered");
      await job("failed", { simulated: true });
      await job("failed", { updatedMinutesAgo: 90 });
      await job("pending");
      await db.query(`INSERT INTO mc_clients (id, payload) VALUES ('mc1', '{}'::jsonb)`);
      for (const status of ["failed", "undelivered", "sent", "queued"])
        await db.query(
          `INSERT INTO mc_outbound_messages (id, client_account_id, to_e164, from_e164, body, status, updated_at) VALUES ($1,'mc1','+15145550102','+15145550103','b',$2,$3)`,
          [id("om"), status, ago(3)],
        );
      for (const [status, simulated] of [["failed", false], ["dead", false], ["delivered", false], ["failed", true]] as const)
        await db.query(
          `INSERT INTO tc_notification_deliveries (id, notification_id, organization_id, channel, status, idempotency_key, simulated, updated_at) VALUES ($1,'n1','org_live','sms',$2,$3,$4,$5)`,
          [id("nd"), status, id("k"), simulated, ago(2)],
        );
      await db.query(
        `INSERT INTO tc_notification_deliveries (id, notification_id, organization_id, channel, status, idempotency_key, simulated, updated_at) VALUES ('nd_email','n1','org_live','email','failed','kemail',false,$1)`,
        [ago(2)],
      );
      const { signals } = await collect();
      // jobs: 4 failed + 3 delivered = 7 total/4 failed; outbound: 3 attempted (queued excluded)/2 failed; notifications: 3/2
      assert.deepEqual(signals.sms, { failed: 8, total: 13 });
    });

    it("raises the right priority from real counts", async () => {
      for (let i = 0; i < 6; i += 1) await job("failed");
      for (let i = 0; i < 6; i += 1) await job("delivered");
      const warning = evaluateSignals((await collect()).signals, T).find((f) => f.fingerprint === "sms:delivery_failures");
      assert.equal(warning?.priority, "warning");
    });

    it("finds stuck jobs (pending long overdue, or processing without progress) and ignores recent and simulated ones", async () => {
      for (let i = 0; i < 3; i += 1) await job("pending", { scheduledMinutesAgo: 60 });
      for (let i = 0; i < 2; i += 1) await job("processing", { scheduledMinutesAgo: 70, claimedMinutesAgo: 50 });
      await job("pending", { scheduledMinutesAgo: 5 });
      await job("pending", { scheduledMinutesAgo: 60, simulated: true });
      await job("processing", { scheduledMinutesAgo: 8, claimedMinutesAgo: 2 });
      const { signals } = await collect();
      assert.equal(signals.automations.stuckJobs, 5);
      assert.ok(evaluateSignals(signals, T).some((f) => f.fingerprint === "automations:stuck_jobs"));
    });

    it("finds jobs that gave up after retrying, and jobs that sent more than once", async () => {
      await automation();
      for (let i = 0; i < 3; i += 1) await job("failed", { attempts: 2 });
      await job("failed", { attempts: 1 });
      await job("sent");
      const sentJob = (await db.query(`SELECT id FROM tc_sms_jobs WHERE status = 'sent'`)).rows[0].id as string;
      for (let i = 0; i < 2; i += 1)
        await db.query(
          `INSERT INTO tc_sms_executions (id, organization_id, automation_id, job_id, status, simulated, at) VALUES ($1,'org_live','auto1',$2,'success',false,$3)`,
          [id("ex"), sentJob, ago(10)],
        );
      const { signals } = await collect();
      assert.equal(signals.automations.retryExhausted, 3);
      assert.equal(signals.automations.duplicateExecutions, 1);
      const fingerprints = evaluateSignals(signals, T).map((f) => f.fingerprint);
      assert.ok(fingerprints.includes("automations:duplicate_execution"));
      assert.ok(fingerprints.includes("automations:retry_exhausted"));
    });
  });

  describe("calendar (MON-07)", () => {
    const connection = (org: string, status: string) =>
      db.query(`INSERT INTO tc_calendar_connections (organization_id, status) VALUES ($1,$2)`, [org, status]);

    it("lists live businesses whose connection expired or errored, not demo, suspended or healthy ones", async () => {
      await connection("org_live", "expired");
      await connection("org_pilot", "error");
      await connection("org_demo", "expired");
      await connection("org_suspended", "expired");
      const { signals } = await collect();
      assert.deepEqual(signals.calendar.credentialProblemBusinesses, ["org_live", "org_pilot"]);
      const finding = evaluateSignals(signals, T).find((f) => f.fingerprint === "google_calendar:credentials_invalid");
      assert.equal(finding?.affectedBusinesses, 2);
      assert.equal(finding?.organizationId, undefined, "two businesses is platform-scope");
    });

    it("names the business when exactly one is affected", async () => {
      await connection("org_live", "expired");
      const finding = evaluateSignals((await collect()).signals, T).find((f) => f.fingerprint === "google_calendar:credentials_invalid");
      assert.equal(finding?.organizationId, "org_live");
    });

    it("counts recorded calendar failures in the window, excluding simulated and low-severity ones", async () => {
      const store = createPostgresReliabilityStore(pool);
      const base = { requestId: "r", operation: "book_appointment", errorCode: "CALENDAR_UNAVAILABLE", retryable: true, attemptCount: 1, status: "open" as const, environment: "test" };
      for (let i = 0; i < 5; i += 1) await store.saveError({ ...base, id: id("e"), service: "google_calendar", severity: "medium", simulated: false, createdAt: ago(5) });
      await store.saveError({ ...base, id: id("e"), service: "calcom", severity: "high", simulated: false, createdAt: ago(5) });
      await store.saveError({ ...base, id: id("e"), service: "google_calendar", severity: "medium", simulated: true, createdAt: ago(5) });
      await store.saveError({ ...base, id: id("e"), service: "google_calendar", severity: "low", simulated: false, createdAt: ago(5) });
      await store.saveError({ ...base, id: id("e"), service: "google_calendar", severity: "medium", simulated: false, createdAt: ago(120) });
      const { signals } = await collect();
      assert.equal(signals.calendar.failedSyncs, 6);
      assert.ok(evaluateSignals(signals, T).some((f) => f.fingerprint === "google_calendar:sync_failures"));
    });
  });

  describe("Stripe (MON-08)", () => {
    it("counts repeated webhook sync failures and signature failures separately, excluding simulated ones", async () => {
      const store = createPostgresReliabilityStore(pool);
      const base = { requestId: "r", retryable: true, attemptCount: 1, status: "open" as const, environment: "test", service: "stripe" };
      for (let i = 0; i < 3; i += 1)
        await store.saveError({ ...base, id: id("e"), operation: "webhook.invoice.payment_failed", errorCode: "sync_failed", severity: "high", simulated: false, createdAt: ago(4) });
      await store.saveError({ ...base, id: id("e"), operation: "webhook.invoice.paid", errorCode: "sync_failed", severity: "high", simulated: true, createdAt: ago(4) });
      for (let i = 0; i < 4; i += 1)
        await store.saveError({ ...base, id: id("e"), operation: "webhook.signature", errorCode: "invalid_signature", severity: "low", simulated: false, createdAt: ago(4) });
      await store.saveError({ ...base, id: id("e"), operation: "checkout.create", errorCode: "x", severity: "high", simulated: false, createdAt: ago(4) });
      const { signals } = await collect();
      assert.equal(signals.stripe.webhookFailures, 3);
      assert.equal(signals.stripe.signatureFailures, 4);
      const finding = evaluateSignals(signals, T).find((f) => f.fingerprint === "stripe:webhook_failures");
      assert.equal(finding?.priority, "high");
    });

    it("flags a business with two live subscriptions, but not one active plus one cancelled, nor demo businesses", async () => {
      const customer = (org: string) =>
        db.query(`INSERT INTO tc_stripe_customers (organization_id, customer_id, livemode) VALUES ($1,$2,true)`, [org, `cus_${org}`]);
      const sub = (org: string, status: string) =>
        db.query(
          `INSERT INTO tc_stripe_subscriptions (subscription_id, organization_id, status, plan, cancel_at_period_end) VALUES ($1,$2,$3,'professional',false)`,
          [id("sub"), org, status],
        );
      await customer("org_live");
      await customer("org_pilot");
      await customer("org_demo");
      await sub("org_live", "active");
      await sub("org_live", "past_due");
      await sub("org_pilot", "active");
      await sub("org_pilot", "canceled");
      await sub("org_demo", "active");
      await sub("org_demo", "active");
      const { signals } = await collect();
      assert.equal(signals.stripe.inconsistentBilling, 1);
      assert.ok(evaluateSignals(signals, T).some((f) => f.fingerprint === "stripe:billing_inconsistent"));
    });
  });

  describe("a quiet, healthy platform", () => {
    it("measures every signal and raises nothing", async () => {
      await call("completed", 5, { outcome: "message_taken" });
      const { signals, degraded } = await collect();
      assert.deepEqual(degraded, []);
      assert.deepEqual(evaluateSignals(signals, T), []);
    });
  });

  describe("one broken signal degrades alone", () => {
    it("reports the signal as not measured and still measures the rest", async () => {
      await db.exec(`DROP TABLE tc_calendar_connections`);
      for (let i = 0; i < 4; i += 1) await call("failed", 5);
      const { signals, degraded } = await collect();
      assert.deepEqual(degraded, ["calendar_credentials"]);
      assert.equal(signals.calls.failedSessions, 4, "other collectors are unaffected");
      await db.exec(`CREATE TABLE tc_calendar_connections (
        organization_id TEXT PRIMARY KEY REFERENCES tc_organizations (id) ON DELETE CASCADE,
        provider TEXT NOT NULL DEFAULT 'google', status TEXT NOT NULL DEFAULT 'disconnected', calendar_id TEXT,
        calendar_summary TEXT, account_email TEXT, token_ciphertext TEXT, scope TEXT, expires_at TIMESTAMPTZ,
        last_error TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    });
  });

  describe("database probe", () => {
    it("is ok when it can read and write, and leaves a heartbeat row", async () => {
      const probe = await probeDatabase(pool, T);
      assert.deepEqual([probe.ok, probe.readOk, probe.writeOk], [true, true, true]);
      assert.ok((await db.query(`SELECT 1 FROM mc_ops_meta WHERE key = 'monitor_write_probe'`)).rows.length === 1);
    });

    it("rides out a single dropped connection but reports an outage when every attempt fails", async () => {
      const flaky = poolOf(db);
      flaky.failNext?.(/SELECT 1/);
      assert.equal((await probeDatabase(flaky, T)).ok, true, "second attempt succeeds");
      const dead = { query: async () => Promise.reject(new Error("connection refused")) } as unknown as ReturnType<typeof poolOf>;
      const probe = await probeDatabase(dead, T);
      assert.deepEqual([probe.ok, probe.readOk, probe.writeOk], [false, false, false]);
    });

    it("tells a read-only database (reads work, writes fail) from a dead one", async () => {
      const readOnly = {
        query: async (sql: string) => {
          if (/INSERT/.test(sql)) throw new Error("cannot execute INSERT in a read-only transaction");
          return { rows: [{ "?column?": 1 }] };
        },
      } as unknown as ReturnType<typeof poolOf>;
      const probe = await probeDatabase(readOnly, T);
      assert.deepEqual([probe.ok, probe.readOk, probe.writeOk], [false, true, false]);
    });

    it("gives up on a query that never answers instead of hanging the monitor", async () => {
      const hung = { query: () => new Promise(() => undefined) } as unknown as ReturnType<typeof poolOf>;
      const fast = { ...T, database: { ...T.database, probeTimeoutMs: 15, probeAttempts: 2 } };
      const started = Date.now();
      assert.equal((await probeDatabase(hung, fast)).ok, false);
      assert.ok(Date.now() - started < 1000);
    });
  });
});
