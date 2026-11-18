/**
 * KAN-17 on real SQL: the automation store and a whole send, run on an in-process
 * PostgreSQL (PGlite) with the shipped schema.
 *
 * What the in-memory tests cannot prove, and this does: the insert-only seeding
 * (`ON CONFLICT DO NOTHING`), the row-locked toggle and settings save, the claim and the
 * ten-minute stale reset, the write-ahead `sendStartedAt` marker and its compare-and-set,
 * revival of jobs canceled by a disable, and the idempotency unique keys.
 *
 * PGlite has a single connection, so two statements never truly overlap here: the
 * interleaving of two real connections (and `FOR UPDATE SKIP LOCKED` under contention)
 * is NOT proved by this file. Skips when PGlite is not installed
 * (`npm i --no-save @electric-sql/pglite`).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { SmsDeliveryError } from "../../src/product/missed-call/twilio";
import { createPostgresAutomationStore } from "../../src/product/sms-automation/postgres-store";
import { createAutomationService, type OrgSnapshot } from "../../src/product/sms-automation/service";
import { TEMPLATE_KEYS, type AutomationType, type JobRecord } from "../../src/product/sms-automation/types";
import { createPglite, pgliteAvailable, poolOf, type PgliteDb } from "../support/pglite-pool";

const ORG = "org_pg_a";
const OTHER = "org_pg_b";
const T0 = "2026-01-21T15:00:00.000Z";
const MIN = 60_000;

const orgSnapshot = (id: string): OrgSnapshot => ({
  id,
  name: "Montreal Plumbing Pro",
  status: "active",
  timezone: "America/Toronto",
  localeDefault: "en",
  phoneE164: "+15145551000",
  accountType: "live",
});

describe("sms automation on real SQL (PGlite)", { skip: !pgliteAvailable() && "PGlite not installed" }, () => {
  let db: PgliteDb;
  let pool: ReturnType<typeof poolOf>;
  let clock = new Date(T0);
  const texts: string[] = [];
  let providerFails: (() => never) | null = null;

  const store = () => createPostgresAutomationStore(pool);
  const service = () =>
    createAutomationService({
      store: store(),
      sms: {
        async send(message) {
          providerFails?.();
          texts.push(message.toE164);
          return { sid: `SM${texts.length}` };
        },
      },
      now: () => clock,
      smsMode: "live",
      async loadOrg(id) {
        return orgSnapshot(id);
      },
      async smsFrom() {
        return "+15145550000";
      },
    });

  before(async () => {
    db = await createPglite();
    pool = poolOf(db);
    await db.exec("CREATE TABLE IF NOT EXISTS mc_schema_migrations (id TEXT PRIMARY KEY)");
    await db.exec("CREATE TABLE IF NOT EXISTS tc_organizations (id TEXT PRIMARY KEY)");
    await db.exec(readFileSync(path.join(process.cwd(), "src", "product", "sms-automation", "schema.sql"), "utf8"));
  });
  after(async () => {
    await db.close();
  });
  beforeEach(async () => {
    for (const table of [
      "tc_sms_executions",
      "tc_sms_automation_events",
      "tc_sms_jobs",
      "tc_sms_consent",
      "tc_sms_suppressions",
      "tc_sms_webhook_events",
      "tc_sms_templates",
      "tc_sms_automations",
      "tc_organizations",
    ]) {
      await db.exec(`DELETE FROM ${table}`);
    }
    await db.exec(`INSERT INTO tc_organizations (id) VALUES ('${ORG}'), ('${OTHER}')`);
    clock = new Date(T0);
    texts.length = 0;
    providerFails = null;
  });

  async function automation(type: AutomationType, org = ORG) {
    return (await service().list(org)).find((row) => row.type === type)!;
  }

  async function missedCallJob(callId = "call_1", phone = "+15145550100") {
    const svc = service();
    const row = await automation("missed_call_recovery");
    await svc.activate(ORG, row.id);
    const result = await svc.scheduleMissedCall({
      organizationId: ORG,
      callId,
      callerE164: phone,
      disposition: "missed",
    });
    assert.equal(result.scheduled, true);
    return { svc, row, job: result.job as JobRecord };
  }

  const jobRow = async (id: string) =>
    (await db.query("SELECT * FROM tc_sms_jobs WHERE id = $1", [id])).rows[0] as Record<string, unknown>;

  it("seeds a new business once: five automations, every template in both languages, all off", async () => {
    const rows = await service().list(ORG);
    assert.equal(rows.length, 5);
    assert.ok(rows.every((row) => !row.enabled));
    const { rows: templates } = await db.query("SELECT count(*)::int AS n FROM tc_sms_templates WHERE organization_id = $1", [ORG]);
    assert.equal(templates[0]!.n, TEMPLATE_KEYS.length * 2);
  });

  it("opening the page again, even all at once, never resets a switch, a setting or a template", async () => {
    const svc = service();
    const row = await automation("quote_followup");
    await svc.update(ORG, row.id, { initialDelayMinutes: 7 });
    await svc.activate(ORG, row.id);
    const [template] = await svc.listTemplates(ORG);
    const body = "Hi, this is {{business_name}}. Custom wording. Reply STOP to opt out.";
    await svc.updateTemplate(ORG, template!.id, { body });
    await Promise.all([
      ...Array.from({ length: 6 }, () => service().list(ORG)),
      ...Array.from({ length: 3 }, () => service().listTemplates(ORG)),
    ]);
    const after = await automation("quote_followup");
    assert.equal(after.enabled, true);
    assert.equal(after.config.initialDelayMinutes, 7);
    assert.equal((await svc.listTemplates(ORG)).find((t) => t.id === template!.id)!.body, body);
    const { rows } = await db.query("SELECT count(*)::int AS n FROM tc_sms_automations WHERE organization_id = $1", [ORG]);
    assert.equal(rows[0]!.n, 5);
  });

  it("the switch is set, not toggled: repeating it reports no change", async () => {
    const row = await automation("missed_call_recovery");
    const s = store();
    const first = await s.setAutomationEnabled(ORG, row.id, true, T0);
    const second = await s.setAutomationEnabled(ORG, row.id, true, T0);
    const off = await s.setAutomationEnabled(ORG, row.id, false, T0);
    assert.equal(first?.changed, true);
    assert.equal(second?.changed, false);
    assert.equal(second?.automation.enabled, true);
    assert.equal(off?.changed, true);
    assert.equal(off?.automation.enabled, false);
  });

  it("another business's id changes nothing and is reported as not found", async () => {
    const row = await automation("missed_call_recovery");
    await service().list(OTHER);
    const s = store();
    assert.equal(await s.setAutomationEnabled(OTHER, row.id, true, T0), null);
    assert.equal(await s.updateAutomationConfig(OTHER, row.id, (c) => c.config, T0), null);
    assert.equal(await s.getAutomation(OTHER, row.id), null);
    assert.equal((await automation("missed_call_recovery")).enabled, false);
  });

  it("a save replaces the settings under a lock and keeps the switch", async () => {
    const row = await automation("quote_followup");
    const svc = service();
    await svc.activate(ORG, row.id);
    const saved = await svc.update(ORG, row.id, { initialDelayMinutes: 90 });
    assert.equal(saved.enabled, true);
    assert.equal(saved.config.initialDelayMinutes, 90);
    // A refused change leaves everything as it was, and the transaction is released.
    await assert.rejects(() => svc.update(ORG, row.id, { maxAttempts: 9 }), /Invalid settings/);
    const stored = await automation("quote_followup");
    assert.equal(stored.config.initialDelayMinutes, 90);
    assert.equal(stored.config.maxAttempts, row.config.maxAttempts);
    await svc.update(ORG, row.id, { initialDelayMinutes: 91 });
    assert.equal((await automation("quote_followup")).config.initialDelayMinutes, 91);
  });

  it("a toggle and a save at the same moment both stick", async () => {
    const row = await automation("missed_call_recovery");
    await Promise.all([
      service().update(ORG, row.id, { initialDelayMinutes: 9 }),
      service().activate(ORG, row.id),
    ]);
    const stored = await automation("missed_call_recovery");
    assert.equal(stored.enabled, true);
    assert.equal(stored.config.initialDelayMinutes, 9);
  });

  it("a database failure while enabling is raised and the switch stays off", async () => {
    const row = await automation("missed_call_recovery");
    pool.failNext?.(/UPDATE tc_sms_automations/);
    await assert.rejects(() => service().activate(ORG, row.id), /simulated database failure/);
    assert.equal((await automation("missed_call_recovery")).enabled, false);
    assert.equal((await service().activate(ORG, row.id)).enabled, true);
  });

  it("a whole missed call: one job, one text, logged; the same call again adds nothing", async () => {
    const { svc, job } = await missedCallJob();
    const again = await svc.scheduleMissedCall({
      organizationId: ORG,
      callId: "call_1",
      callerE164: "+15145550100",
      disposition: "missed",
    });
    assert.equal(again.scheduled, false);
    assert.equal(again.reason, "duplicate");
    clock = new Date(Date.parse(T0) + 3 * MIN);
    await Promise.all([svc.processDue({ organizationId: ORG }), service().processDue({ organizationId: ORG })]);
    assert.equal(texts.length, 1);
    const stored = await jobRow(job.id);
    assert.equal(stored.status, "submitted");
    assert.equal(stored.provider_message_sid, "SM1");
    const executions = await svc.executions(ORG);
    assert.equal(executions.length, 1);
    assert.equal(executions[0]!.status, "success");
    assert.equal((await svc.executions(OTHER)).length, 0);
    const counted = await automation("missed_call_recovery");
    assert.equal(counted.successCount, 1);
  });

  it("a temporary provider failure is retried later and sent once", async () => {
    const { svc, job } = await missedCallJob("call_retry");
    clock = new Date(Date.parse(T0) + 3 * MIN);
    providerFails = () => {
      throw new SmsDeliveryError("retry", "http_503");
    };
    await svc.processDue({ organizationId: ORG });
    assert.equal((await jobRow(job.id)).status, "pending");
    assert.equal(texts.length, 0);
    assert.equal((await svc.processDue({ organizationId: ORG })).processed, 0);
    providerFails = null;
    clock = new Date(clock.getTime() + 3 * MIN);
    await svc.processDue({ organizationId: ORG });
    assert.equal(texts.length, 1);
    assert.equal((await jobRow(job.id)).status, "submitted");
    const logged = (await svc.executions(ORG)).map((e) => e.status);
    assert.ok(logged.includes("retry"), "the failed attempt is in the log");
    assert.ok(logged.includes("success"), "and so is the one that worked");
  });

  it("claim: a job is handed to exactly one caller, and only when due", async () => {
    const { job } = await missedCallJob("call_claim");
    const s = store();
    assert.equal(await s.claimNext({ nowIso: T0, organizationId: ORG }), null, "not due yet");
    const due = new Date(Date.parse(T0) + 3 * MIN).toISOString();
    const [a, b] = await Promise.all([
      s.claimNext({ nowIso: due, organizationId: ORG }),
      s.claimNext({ nowIso: due, organizationId: ORG }),
    ]);
    assert.equal([a, b].filter(Boolean).length, 1);
    assert.equal((a ?? b)!.id, job.id);
    assert.equal((await jobRow(job.id)).status, "processing");
  });

  it("a stale claim is released if nothing was started, and flagged uncertain if a send had begun", async () => {
    const first = await missedCallJob("call_stale_a", "+15145550101");
    const second = await missedCallJob("call_stale_b", "+15145550102");
    const s = store();
    const due = new Date(Date.parse(T0) + 3 * MIN).toISOString();
    const claimedA = await s.claimNext({ nowIso: due, organizationId: ORG });
    const claimedB = await s.claimNext({ nowIso: due, organizationId: ORG });
    assert.ok(claimedA && claimedB);
    // Whichever was claimed second: the second worker got as far as the provider.
    assert.equal(await s.beginSend(claimedB!, due), true);
    const later = new Date(Date.parse(due) + 11 * MIN).toISOString();
    const reclaimed = await s.claimNext({ nowIso: later, organizationId: ORG });
    assert.equal(reclaimed?.id, claimedA!.id, "the untouched job goes back in the queue and is claimed again");
    const stuck = await jobRow(claimedB!.id);
    assert.equal(stuck.status, "uncertain");
    assert.equal(stuck.last_error, "provider_outcome_unreconciled");
    assert.equal(texts.length, 0);
    assert.ok(first.job && second.job);
  });

  it("beginSend only succeeds for the worker that still holds the job", async () => {
    const { svc, row } = await missedCallJob("call_cas");
    const s = store();
    const due = new Date(Date.parse(T0) + 3 * MIN).toISOString();
    const claimed = (await s.claimNext({ nowIso: due, organizationId: ORG }))!;
    // Turned off after the claim, before the send: the job is canceled, and cannot start.
    const stopped = await svc.deactivate(ORG, row.id);
    assert.equal(stopped.canceled, 1);
    assert.equal(await s.beginSend(claimed, due), false);
    assert.equal((await jobRow(claimed.id)).status, "canceled");
  });

  it("once a send has begun, disabling neither cancels nor hides the job", async () => {
    const { svc, row } = await missedCallJob("call_inflight");
    const s = store();
    const due = new Date(Date.parse(T0) + 3 * MIN).toISOString();
    const claimed = (await s.claimNext({ nowIso: due, organizationId: ORG }))!;
    assert.equal(await s.beginSend(claimed, due), true);
    assert.equal(await s.beginSend(claimed, due), true, "the same holder may confirm again");
    const stopped = await svc.deactivate(ORG, row.id);
    assert.equal(stopped.canceled, 0);
    assert.equal((await jobRow(claimed.id)).status, "processing");
    // An uncertain job is left alone by a disable as well.
    await db.exec(`UPDATE tc_sms_jobs SET status = 'uncertain' WHERE id = '${claimed.id}'`);
    assert.equal((await svc.deactivate(ORG, row.id)).canceled, 0);
    assert.equal((await jobRow(claimed.id)).status, "uncertain");
  });

  it("turning an automation off and on again brings back only what the switch canceled", async () => {
    const svc = service();
    const row = await automation("quote_followup");
    await svc.update(ORG, row.id, { initialDelayMinutes: 0, secondDelayMinutes: 60 });
    await svc.activate(ORG, row.id);
    const made = await svc.scheduleQuoteFollowUps({
      organizationId: ORG,
      threadId: "thr_pg",
      phoneE164: "+15145550100",
      quoteSentAt: T0,
    });
    assert.equal(made.jobs.length, 2);
    await svc.deactivate(ORG, row.id);
    const { rows: off } = await db.query("SELECT count(*)::int AS n FROM tc_sms_jobs WHERE status = 'canceled' AND cancel_reason = 'automation_disabled'");
    assert.equal(off[0]!.n, 2);
    // One of them was canceled for another reason and must stay canceled.
    await db.exec(`UPDATE tc_sms_jobs SET cancel_reason = 'quote_accepted' WHERE id = '${made.jobs[1]!.id}'`);
    await svc.activate(ORG, row.id);
    const again = await svc.scheduleQuoteFollowUps({
      organizationId: ORG,
      threadId: "thr_pg",
      phoneE164: "+15145550100",
      quoteSentAt: T0,
    });
    assert.equal(again.jobs.length, 1);
    const { rows: states } = await db.query("SELECT status, cancel_reason FROM tc_sms_jobs ORDER BY idempotency_key");
    assert.deepEqual(states.map((r) => r.status), ["pending", "canceled"]);
    assert.equal(states[1]!.cancel_reason, "quote_accepted");
    const { rows: total } = await db.query("SELECT count(*)::int AS n FROM tc_sms_jobs");
    assert.equal(total[0]!.n, 2, "revived, not duplicated");
  });

  it("the execution log lists the newest first and honors the limit", async () => {
    const s = store();
    const row = await automation("missed_call_recovery");
    const { job } = await missedCallJob("call_log");
    for (let i = 0; i < 4; i++) {
      await s.addExecution({
        id: `ex_${i}`,
        organizationId: ORG,
        automationId: row.id,
        jobId: job.id,
        status: i % 2 ? "failure" : "success",
        result: "r",
        simulated: false,
        at: new Date(Date.parse(T0) + i * MIN).toISOString(),
      });
    }
    const list = await s.listExecutions(ORG, 3);
    assert.deepEqual(list.map((e) => e.id), ["ex_3", "ex_2", "ex_1"]);
    assert.equal((await s.listExecutions(OTHER, 10)).length, 0);
  });

  it("a webhook event is claimed once", async () => {
    const s = store();
    assert.equal(await s.claimWebhook("twilio_status", "evt_1"), true);
    assert.equal(await s.claimWebhook("twilio_status", "evt_1"), false);
    assert.equal(await s.claimWebhook("twilio_sms", "evt_1"), true);
  });
});
