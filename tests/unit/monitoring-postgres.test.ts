/**
 * KAN-28 on real SQL: the reliability store, the incident engine and the alert
 * outbox run on an in-process PostgreSQL (PGlite) with the shipped schema files
 * (014 reliability + 063 monitoring).
 *
 * What the in-memory tests cannot prove, and this does: the migration applies
 * cleanly on top of 014 (and again, and over rows that predate it), the partial
 * unique index that allows one live incident per fingerprint, the reopen / touch
 * / create path, the outbox idempotency key and lease, bucket upserts, pruning,
 * and that the engine behaves the same on SQL as it does in memory.
 *
 * PGlite has a single connection, so two statements never truly overlap: real
 * connection interleaving (and FOR UPDATE SKIP LOCKED under contention) is NOT
 * proved by this file. Skips when PGlite is not installed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { deliverDueAlerts } from "../../src/product/reliability/alerts";
import { createIncidentEngine } from "../../src/product/reliability/incidents";
import { createPostgresReliabilityStore } from "../../src/product/reliability/postgres-store";
import { DEFAULT_THRESHOLDS } from "../../src/product/reliability/thresholds";
import { incidentState, type BucketDelta } from "../../src/product/reliability/types";
import { createPglite, pgliteAvailable, poolOf, type PgliteDb } from "../support/pglite-pool";

const MIN = 60_000;
const T0 = Date.parse("2026-11-20T15:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const sql = (file: string) =>
  readFileSync(path.join(process.cwd(), "src", "product", "reliability", file), "utf8");

describe("monitoring on real SQL (PGlite)", { skip: !pgliteAvailable() && "PGlite not installed" }, () => {
  let db: PgliteDb;
  let pool: ReturnType<typeof poolOf>;
  let clock = T0;
  const store = () => createPostgresReliabilityStore(pool);
  const engine = () =>
    createIncidentEngine({ store: store(), thresholds: DEFAULT_THRESHOLDS, now: () => new Date(clock) });

  const report = (over: Partial<Parameters<ReturnType<typeof engine>["report"]>[0]> = {}) =>
    engine().report({
      fingerprint: "stripe:webhook_failures",
      service: "stripe",
      category: "webhook_failures",
      priority: "high",
      title: "Stripe webhooks are failing",
      summary: "Webhook deliveries could not be processed.",
      quietMs: 15 * MIN,
      correlationId: "req_1",
      simulated: false,
      ...over,
    });

  before(async () => {
    db = await createPglite();
    await db.exec(`
      CREATE TABLE mc_schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE mc_ops_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    `);
    await db.exec(sql("schema.sql"));
    // A row written by the 014 code before this migration existed.
    await db.exec(`INSERT INTO tc_system_incidents (id, service, severity, title, status, correlation_id, created_at)
      VALUES ('inc_legacy', 'jobs', 'high', 'Old incident', 'open', 'c_old', '2026-11-01T00:00:00Z')`);
    await db.exec(sql("monitoring.sql"));
    pool = poolOf(db);
  });
  after(async () => {
    await db.close();
  });
  beforeEach(async () => {
    clock = T0;
    await db.exec(`DELETE FROM tc_alert_deliveries; DELETE FROM tc_incident_events; DELETE FROM tc_system_errors;
      DELETE FROM tc_monitor_probes; DELETE FROM tc_monitor_buckets; DELETE FROM mc_ops_meta;
      DELETE FROM tc_system_incidents WHERE id <> 'inc_legacy'`);
  });

  describe("migration 063", () => {
    it("applies again without error (idempotent), keeps pre-existing rows valid and reads them as before", async () => {
      await db.exec(sql("monitoring.sql"));
      await db.exec(sql("monitoring.sql"));
      const legacy = await store().getIncident("inc_legacy");
      assert.equal(legacy?.status, "open");
      assert.equal(legacy?.priority, "high", "priority falls back to severity");
      assert.equal(legacy?.occurrenceCount, 1);
      assert.equal(legacy?.fingerprint, undefined);
      assert.equal((await store().listRecoverableIncidents(iso(T0 + 999 * MIN))).length, 0, "legacy rows are never auto-resolved");
    });

    it("allows one live incident per fingerprint and any number of resolved ones", async () => {
      const insert = (id: string, status: string) =>
        db.query(
          `INSERT INTO tc_system_incidents (id, service, severity, title, status, correlation_id, fingerprint)
           VALUES ($1,'stripe','high','t',$2,'c','fp:one')`,
          [id, status],
        );
      await insert("i1", "open");
      await assert.rejects(() => insert("i2", "investigating"), /duplicate key|unique/i);
      await insert("i3", "resolved");
      await insert("i4", "resolved");
    });
  });

  describe("incident lifecycle (same behavior as the in-memory store)", () => {
    it("MON-10 groups repeated errors into one incident with a count and one alert", async () => {
      for (let i = 0; i < 12; i += 1) await report();
      const rows = (await store().listIncidents()).filter((r) => r.fingerprint);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].occurrenceCount, 12);
      assert.equal((await store().listAlertDeliveries()).length, 1);
    });

    it("merges business scope to platform-wide when two businesses report the same fingerprint", async () => {
      await report({ organizationId: "biz-1" });
      assert.equal((await store().listIncidents()).find((r) => r.fingerprint)?.organizationId, "biz-1");
      await report({ organizationId: "biz-2" });
      assert.equal((await store().listIncidents()).find((r) => r.fingerprint)?.organizationId, undefined);
    });

    it("MON-11 resolves after the quiet period and sends one recovery notice", async () => {
      await report();
      clock += 10 * MIN;
      assert.equal((await engine().sweepRecovered()).length, 0);
      clock += 10 * MIN;
      assert.equal((await engine().sweepRecovered()).length, 1);
      const incident = (await store().listIncidents()).find((r) => r.fingerprint)!;
      assert.equal(incidentState(incident.status), "resolved");
      assert.equal(incident.resolvedBy, "auto");
      await engine().sweepRecovered();
      assert.deepEqual(
        (await store().listAlertDeliveries()).map((a) => a.kind).sort(),
        ["opened", "recovered"],
      );
    });

    it("reopens a just-resolved incident without a second alert, then opens a new one after the window", async () => {
      await report();
      clock += 20 * MIN;
      await engine().sweepRecovered();
      clock += 2 * MIN;
      assert.equal((await report()).outcome, "reopened");
      assert.equal((await store().listIncidents()).filter((r) => r.fingerprint).length, 1);
      assert.equal((await store().listAlertDeliveries()).filter((a) => a.kind === "opened").length, 1);
      clock += 20 * MIN;
      await engine().sweepRecovered();
      clock += 60 * MIN;
      assert.equal((await report()).outcome, "created");
      assert.equal((await store().listIncidents()).filter((r) => r.fingerprint).length, 2);
    });

    it("escalates priority and severity together and alerts once more", async () => {
      await report({ priority: "warning", fingerprint: "api:error_rate", service: "api" });
      await report({ priority: "critical", fingerprint: "api:error_rate", service: "api", title: "Widespread server errors" });
      await report({ priority: "warning", fingerprint: "api:error_rate", service: "api" });
      const incident = (await store().listIncidents()).find((r) => r.fingerprint === "api:error_rate")!;
      assert.equal(incident.priority, "critical");
      assert.equal(incident.severity, "critical");
      assert.equal(incident.title, "Widespread server errors", "a later, calmer report does not downgrade it");
      assert.deepEqual((await store().listAlertDeliveries()).map((a) => a.kind).sort(), ["escalated", "opened"]);
    });

    it("acknowledges once with the actor recorded, and resolving twice is harmless", async () => {
      await report();
      const id = (await store().listIncidents()).find((r) => r.fingerprint)!.id;
      const acked = await engine().acknowledge(id, "admin@example.test");
      assert.equal(incidentState(acked.status), "acknowledged");
      assert.equal(acked.acknowledgedBy, "admin@example.test");
      await engine().acknowledge(id, "admin@example.test");
      const events = await store().listIncidentEvents(id);
      assert.equal(events.filter((e) => e.kind === "acknowledged").length, 1);
      assert.equal(events.find((e) => e.kind === "acknowledged")?.actor, "admin@example.test");
      assert.equal((await engine().resolve(id, "admin@example.test")).status, "resolved");
      assert.equal((await engine().resolve(id, "admin@example.test")).status, "resolved");
    });

    it("storm control caps alerts, sends one digest, and still records every incident", async () => {
      for (let i = 0; i < 15; i += 1)
        await report({ fingerprint: `svc${i}:failure`, service: `svc${i}` });
      const alerts = await store().listAlertDeliveries();
      assert.equal(alerts.filter((a) => a.kind === "opened").length, DEFAULT_THRESHOLDS.alerts.storm.maxAlerts);
      assert.equal(alerts.filter((a) => a.kind === "digest").length, 1);
      assert.equal((await store().listIncidents()).filter((r) => r.fingerprint).length, 15);
    });
  });

  describe("MON-12 alert outbox on SQL", () => {
    const deliver = (notify: Parameters<typeof deliverDueAlerts>[0]["notify"]) =>
      deliverDueAlerts({
        store: store(),
        notify,
        now: () => new Date(clock),
        thresholds: DEFAULT_THRESHOLDS,
        siteUrl: "https://example.test",
      });

    it("ignores a duplicate idempotency key", async () => {
      const row = {
        id: "a1",
        incidentId: null,
        kind: "digest" as const,
        priority: "high" as const,
        status: "pending" as const,
        attempts: 0,
        nextAttemptAt: iso(T0),
        idempotencyKey: "k1",
        createdAt: iso(T0),
      };
      assert.equal(await store().enqueueAlert(row), true);
      assert.equal(await store().enqueueAlert({ ...row, id: "a2" }), false);
      assert.equal((await store().listAlertDeliveries()).length, 1);
    });

    it("records a failure as a short code, retries after the backoff, and then sends", async () => {
      await report();
      let calls = 0;
      const flaky = async () => {
        calls += 1;
        if (calls === 1) throw new Error("password=hunter2 refused");
      };
      assert.deepEqual([(await deliver(flaky)).sent, (await deliver(flaky)).failed], [0, 0], "second run is before the backoff");
      const failed = await store().listAlertDeliveries({ failedOnly: true });
      assert.equal(failed.length, 1);
      assert.equal(failed[0].lastError, "send_failed");
      assert.equal(JSON.stringify(failed[0]).includes("hunter2"), false);
      clock += DEFAULT_THRESHOLDS.alerts.retry.backoffMs[0] + 1;
      assert.equal((await deliver(flaky)).sent, 1);
      const summary = await store().alertSummary(iso(clock));
      assert.equal(summary.sentLast24h, 1);
      assert.equal(summary.pending, 0);
    });

    it("exhausts after the maximum attempts and records an incident event", async () => {
      await report();
      for (let i = 0; i < DEFAULT_THRESHOLDS.alerts.retry.maxAttempts + 2; i += 1) {
        await deliver(async () => {
          throw new Error("down");
        });
        clock += 2 * 60 * MIN;
      }
      const [row] = await store().listAlertDeliveries();
      assert.equal(row.status, "exhausted");
      assert.equal(row.attempts, DEFAULT_THRESHOLDS.alerts.retry.maxAttempts);
      assert.equal((await store().alertSummary(iso(clock))).exhausted, 1);
      const id = (await store().listIncidents()).find((r) => r.fingerprint)!.id;
      assert.ok((await store().listIncidentEvents(id)).some((e) => e.kind === "admin_notification_exhausted"));
    });

    it("leases a claimed row so a second run does not pick it up", async () => {
      await report();
      const first = await store().claimDueAlerts(iso(clock), 5, 60_000);
      const second = await store().claimDueAlerts(iso(clock), 5, 60_000);
      assert.equal(first.length, 1);
      assert.equal(second.length, 0);
      assert.equal((await store().claimDueAlerts(iso(clock + 61_000), 5, 60_000)).length, 1, "lease expiry makes it claimable again");
    });
  });

  describe("measurements and retention", () => {
    const bucket = (at: number, over: Partial<BucketDelta> = {}): BucketDelta => ({
      at: iso(at),
      scope: "api",
      total: 10,
      s2xx: 8,
      s3xx: 0,
      s401: 0,
      s403: 0,
      s429: 0,
      s4xxOther: 0,
      s5xx: 2,
      lat: [5, 3, 2, 0, 0, 0, 0],
      ...over,
    });

    it("adds to an existing minute bucket instead of replacing it", async () => {
      await store().addBuckets([bucket(T0), bucket(T0 + MIN, { scope: "page" })]);
      await store().addBuckets([bucket(T0, { total: 5, s2xx: 5, s5xx: 0, lat: [5, 0, 0, 0, 0, 0, 0] })]);
      const rows = await store().listBuckets(iso(T0 - MIN));
      const api = rows.find((r) => r.scope === "api")!;
      assert.equal(api.total, 15);
      assert.equal(api.s2xx, 13);
      assert.equal(api.s5xx, 2);
      assert.deepEqual(api.lat, [10, 3, 2, 0, 0, 0, 0]);
      assert.equal(rows.length, 2);
    });

    it("stores and lists probe results newest first", async () => {
      await store().saveProbe({ target: "website", ok: true, statusCode: 200, durationMs: 120, at: iso(T0) });
      await store().saveProbe({ target: "database", ok: false, durationMs: 2500, at: iso(T0 + MIN) });
      const rows = await store().listProbes(iso(T0 - MIN));
      assert.deepEqual(rows.map((r) => r.target), ["database", "website"]);
      assert.equal(rows[0].ok, false);
      assert.equal(rows[0].statusCode, undefined);
    });

    it("keeps meta values and counts errors by fingerprint", async () => {
      await store().setMeta("monitor_last_run", "1", iso(T0));
      await store().setMeta("monitor_last_run", "2", iso(T0 + MIN));
      assert.deepEqual(await store().getMeta("monitor_last_run"), { value: "2", updatedAt: iso(T0 + MIN) });
      assert.equal(await store().getMeta("missing"), null);
      const base = {
        requestId: "r",
        service: "stripe",
        operation: "webhook",
        errorCode: "x",
        retryable: false,
        attemptCount: 1,
        status: "open" as const,
        environment: "test",
        simulated: false,
        fingerprint: "stripe:webhook_failures",
      };
      await store().saveError({ ...base, id: "e1", severity: "high", createdAt: iso(T0) });
      await store().saveError({ ...base, id: "e2", severity: "high", createdAt: iso(T0 + 5 * MIN) });
      await store().saveError({ ...base, id: "e3", severity: "low", createdAt: iso(T0 + 6 * MIN) });
      await store().saveError({ ...base, id: "e4", severity: "high", createdAt: iso(T0), fingerprint: "other" });
      assert.equal(await store().countErrors("stripe:webhook_failures", iso(T0 - MIN)), 2, "low severity and other fingerprints do not count");
      assert.equal(await store().countErrors("stripe:webhook_failures", iso(T0 + MIN)), 1);
      assert.equal((await store().listErrors({ fingerprint: "stripe:webhook_failures" })).length, 3);
    });

    it("MON-14: an old incident that is still active is never crowded out of the list by newer resolved ones", async () => {
      const old = T0 - 30 * 24 * 60 * MIN;
      await db.exec(`INSERT INTO tc_system_incidents (id, service, severity, title, status, correlation_id, fingerprint, created_at)
        VALUES ('inc_old_active', 'stripe', 'high', 'Still active', 'open', 'c', 'fp:old-active', '${iso(old)}')`);
      await db.exec(`INSERT INTO tc_system_incidents (id, service, severity, title, status, correlation_id, fingerprint, created_at, resolved_at)
        SELECT 'inc_resolved_' || n, 'stripe', 'high', 'Resolved', 'resolved', 'c', 'fp:resolved-' || n,
               ('${iso(T0)}'::timestamptz - (n || ' minutes')::interval), ('${iso(T0)}'::timestamptz - (n || ' minutes')::interval)
        FROM generate_series(1, 520) AS n`);
      const listed = await store().listIncidents();
      assert.equal(listed.length, 500, "the list stays bounded");
      assert.ok(listed.some((i) => i.id === "inc_old_active"), "the active incident is still shown");
      const firstResolved = listed.findIndex((i) => i.status === "resolved");
      assert.ok(
        listed.slice(firstResolved).every((i) => i.status === "resolved"),
        "every active incident comes before any resolved one",
      );
    });

    it("prunes only what is past its retention and leaves live data alone", async () => {
      const old = T0 - 400 * 24 * 60 * MIN;
      await store().addBuckets([bucket(T0 - 100 * 60 * MIN), bucket(T0)]);
      await store().saveProbe({ target: "website", ok: true, durationMs: 1, at: iso(T0 - 100 * 60 * MIN) });
      await store().saveProbe({ target: "website", ok: true, durationMs: 1, at: iso(T0) });
      await db.exec(`INSERT INTO tc_system_incidents (id, service, severity, title, status, correlation_id, fingerprint, resolved_at, last_seen_at)
        VALUES ('inc_old', 's', 'high', 't', 'resolved', 'c', 'fp:old', '${iso(old)}', '${iso(old)}'),
               ('inc_live', 's', 'high', 't', 'open', 'c', 'fp:live', NULL, '${iso(old)}')`);
      await store().enqueueAlert({ id: "ad_old", incidentId: null, kind: "digest", priority: "high", status: "sent", attempts: 1, nextAttemptAt: iso(old), idempotencyKey: "ko", createdAt: iso(old) });
      await store().enqueueAlert({ id: "ad_pending", incidentId: null, kind: "digest", priority: "high", status: "pending", attempts: 0, nextAttemptAt: iso(T0), idempotencyKey: "kp", createdAt: iso(old) });
      const removed = await store().prune(iso(T0), DEFAULT_THRESHOLDS.retention);
      assert.equal(removed.buckets, 1);
      assert.equal(removed.probes, 1);
      assert.equal(removed.incidents, 1);
      assert.equal(removed.deliveries, 1);
      assert.ok(await store().getIncident("inc_live"), "an unresolved incident is never pruned");
      assert.ok(await store().getIncident("inc_legacy"));
      assert.equal(await store().getIncident("inc_old"), null);
      assert.equal((await store().listAlertDeliveries()).some((a) => a.id === "ad_pending"), true, "a pending alert is never pruned");
    });
  });
});
