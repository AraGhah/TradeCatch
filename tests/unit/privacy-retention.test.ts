import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { purgeExpiredRecords } from "../../src/product/missed-call/retention";
import {
  closePgPool,
  createPostgresStore,
} from "../../src/product/missed-call/postgres-store";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { createMissedCallEngine } from "../../src/product/missed-call/engine";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import { PHRASES } from "../../src/product/receptionist/prompts";
import { renderTwiml } from "../../src/product/receptionist/voice";

it("voicemail announces recording and the option to leave before recording in both languages", () => {
  for (const lang of ["en", "fr"] as const) {
    const notice = PHRASES.voicemailIntro[lang];
    assert.match(
      notice,
      lang === "en"
        ? /will be recorded.*hang up before the beep/
        : /sera enregistré.*raccrochez avant le bip/,
    );
    const xml = renderTwiml(
      {
        sessionId: null,
        verbs: [
          { verb: "say", text: notice, language: lang, voice: "alice" },
          { verb: "record", next: "voicemail", maxLengthSeconds: 120 },
        ],
      },
      () => "https://example.test/callback",
    );
    assert.ok(xml.indexOf("</Say>") < xml.indexOf("<Record"));
  }
});

const database = process.env.NOTIFICATION_TEST_DATABASE_URL;
describe(
  "privacy retention on isolated PostgreSQL",
  { skip: !database },
  () => {
    let admin: Pool, db: Pool, scoped: string;
    const schema = "privacy_" + randomUUID().replaceAll("-", "");
    const now = new Date(),
      old = new Date(now.getTime() - 900 * 86400000).toISOString();
    before(async () => {
      const url = new URL(database!);
      assert.equal(url.hostname, "127.0.0.1");
      assert.equal(url.pathname, "/tc003_staging");
      assert.equal(url.search, "");
      admin = new Pool({ connectionString: database });
      await admin.query(`CREATE SCHEMA ${schema}`);
      scoped = database + `?options=-c%20search_path%3D${schema}`;
      db = new Pool({ connectionString: scoped });
      await db.query(
        readFileSync("src/product/missed-call/schema.sql", "utf8"),
      );
      await db.query(
        readFileSync("src/lib/book-audit-notifications.sql", "utf8"),
      );
    });
    after(async () => {
      await closePgPool();
      await db?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin.end();
      }
    });
    beforeEach(async () => {
      await db.query("TRUNCATE mc_clients,mc_book_audit_leads CASCADE");
      await db.query(
        "INSERT INTO mc_clients(id,payload) VALUES ('privacy_client','{}')",
      );
    });
    async function booking(id = "expired", date = old) {
      await db.query(
        `INSERT INTO mc_book_audit_leads(id,email,phone,company,preferred_language,service_consent,marketing_consent,consent_wording,consent_source,consent_at,payload,created_at)
      VALUES($1,'synthetic@example.invalid','+15145550123','Synthetic','fr',true,false,'Agreed','test',now(),'{"name":"Synthetic","preferredLanguage":"fr"}',$2)`,
        [id, date],
      );
      await db.query(
        "INSERT INTO mc_book_audit_notifications(lead_id,channel) VALUES($1,'notify_email'),($1,'customer_email'),($1,'crm')",
        [id],
      );
    }
    async function sms(id: string, status: string) {
      await db.query(
        "INSERT INTO mc_outbound_messages(id,client_account_id,to_e164,from_e164,body,detail,status,last_error,created_at,updated_at) VALUES($1,'privacy_client','+15145550123','+15145550124','Private message','Private detail',$2,'Provider private error',$3,now())",
        [id, status, old],
      );
    }
    it("scrubs dead/error-bearing SMS, expired call data and an isolated undelivered booking; retains fresh data", async () => {
      await booking();
      await booking("recent", now.toISOString());
      await sms("dead", "dead");
      await sms("failed", "undelivered");
      await db.query(
        "INSERT INTO mc_calls(id,client_account_id,caller_e164,called_at,disposition,payload) VALUES('old_call','privacy_client','+15145550123',$1,'missed','{\"recordingUrl\":\"https://example.invalid/private\",\"name\":\"Private name\"}')",
        [old],
      );
      await db.query(
        "INSERT INTO mc_workflows(id,client_account_id,call_id,caller_e164,status,dedupe_key,escalation_stage,outcome,payload,created_at,updated_at) VALUES('old_workflow','privacy_client','old_call','+15145550123','completed','privacy_client:+15145550123:bucket','primary','closed','{\"dedupeKey\":\"privacy_client:+15145550123:bucket\",\"extraContact\":\"+15145550123\",\"technicianAlerts\":[{\"phone\":\"+15145550124\"}]}',$1,$1)",
        [old],
      );
      await db.query(
        "INSERT INTO mc_leads(id,client_account_id,workflow_id,caller_e164,payload,created_at,updated_at) VALUES('old_lead','privacy_client','old_workflow','+15145550123','{\"name\":\"Private name\"}',$1,$1)",
        [old],
      );
      const result = await purgeExpiredRecords(db, {
        retentionMonths: 24,
        now,
      });
      assert.equal(result.notificationJobsRemoved, 3);
      assert.equal(result.callsAnonymized, 1);
      const workflow = (
        await db.query(
          "SELECT dedupe_key,payload,retention_state FROM mc_workflows WHERE id='old_workflow'",
        )
      ).rows[0];
      assert.equal(workflow.dedupe_key, "purged:old_workflow");
      assert.equal(workflow.retention_state, "purged");
      assert.equal(JSON.stringify(workflow).includes("+15145550123"), false);
      assert.equal(workflow.payload.extraContact, undefined);
      assert.equal(
        (await db.query("SELECT caller_e164 FROM mc_leads WHERE id='old_lead'"))
          .rows[0].caller_e164,
        "+10000000000",
      );
      const records = (
        await db.query("SELECT * FROM mc_outbound_messages ORDER BY id")
      ).rows;
      for (const r of records) {
        assert.equal(r.body, "[redacted]");
        assert.equal(r.to_e164, "+10000000000");
        assert.equal(r.from_e164, "+10000000000");
        assert.equal(r.detail, null);
        assert.equal(r.last_error, "retention_archive");
      }
      const lead = (
        await db.query("SELECT * FROM mc_book_audit_leads WHERE id='expired'")
      ).rows[0];
      assert.equal(lead.email, "[redacted]");
      assert.equal(lead.email_sent, false);
      assert.equal(lead.crm_forwarded, false);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM mc_book_audit_notifications WHERE lead_id='expired'",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await db.query(
            "SELECT email FROM mc_book_audit_leads WHERE id='recent'",
          )
        ).rows[0].email,
        "synthetic@example.invalid",
      );
      const call = (await db.query("SELECT caller_e164,payload FROM mc_calls"))
        .rows[0];
      assert.equal(call.caller_e164, "+10000000000");
      assert.equal(call.payload.recordingUrl, undefined);
      assert.equal(
        (await purgeExpiredRecords(db, { retentionMonths: 24, now }))
          .piiAnonymized,
        0,
      );
    });
    it("retains calls and leads attached to active workflows", async () => {
      await db.query(
        "INSERT INTO mc_calls(id,client_account_id,caller_e164,called_at,disposition,payload) VALUES('active_call','privacy_client','+15145550123',$1,'missed','{}')",
        [old],
      );
      await db.query(
        "INSERT INTO mc_workflows(id,client_account_id,call_id,caller_e164,status,dedupe_key,escalation_stage,outcome,payload,created_at,updated_at) VALUES('active_workflow','privacy_client','active_call','+15145550123','awaiting_customer','active:key','primary','pending','{}',$1,$1)",
        [old],
      );
      await db.query(
        "INSERT INTO mc_leads(id,client_account_id,workflow_id,caller_e164,payload,created_at,updated_at) VALUES('active_lead','privacy_client','active_workflow','+15145550123','{}',$1,$1)",
        [old],
      );
      await purgeExpiredRecords(db, { retentionMonths: 24, now });
      for (const table of ["mc_calls", "mc_leads"])
        assert.equal(
          (await db.query(`SELECT caller_e164 FROM ${table}`)).rows[0]
            .caller_e164,
          "+15145550123",
        );
    });

    it("defers leased notifications and active SMS sends", async () => {
      await booking();
      await sms("sending", "sending");
      await db.query(
        "UPDATE mc_book_audit_notifications SET leased_until=now()+interval '1 hour' WHERE lead_id='expired'",
      );
      await purgeExpiredRecords(db, { retentionMonths: 24, now });
      assert.equal(
        (await db.query("SELECT email FROM mc_book_audit_leads")).rows[0].email,
        "synthetic@example.invalid",
      );
      assert.equal(
        (await db.query("SELECT body FROM mc_outbound_messages")).rows[0].body,
        "Private message",
      );
    });
    it("rolls back queue cancellation and prior scrubbing if any section fails", async () => {
      await booking();
      await sms("dead", "dead");
      await db.query(
        "ALTER TABLE mc_book_audit_leads ADD CONSTRAINT reject_fixture_redaction CHECK(email <> '[redacted]')",
      );
      try {
        await assert.rejects(() =>
          purgeExpiredRecords(db, { retentionMonths: 24, now }),
        );
        assert.equal(
          (await db.query("SELECT email FROM mc_book_audit_leads")).rows[0]
            .email,
          "synthetic@example.invalid",
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM mc_book_audit_notifications",
            )
          ).rows[0].n,
          3,
        );
        assert.equal(
          (await db.query("SELECT body,last_error FROM mc_outbound_messages"))
            .rows[0].last_error,
          "Provider private error",
        );
      } finally {
        await db.query(
          "ALTER TABLE mc_book_audit_leads DROP CONSTRAINT reject_fixture_redaction",
        );
      }
    });
    for (const [index, word] of ["STOP", "ARRÊT", " ARRE\u0302T "].entries()) {
      it(`persists ${word.trim()} opt-out across a new engine/store`, async () => {
        const client = demoClientAccount();
        const store = createPostgresStore(scoped);
        await store.saveClient(client);
        const smsPort = createMemorySmsPort();
        const engine = createMissedCallEngine({
          store,
          sms: smsPort,
          clock: { now: () => now },
        });
        const caller = `+1514555012${index}`;
        await engine.handleInboundSms({
          fromE164: caller,
          toE164: client.smsFromNumber,
          body: word,
        });
        const restarted = createPostgresStore(scoped);
        assert.equal(await restarted.isSmsSuppressed(client.id, caller), true);
        const next = createMissedCallEngine({
          store: restarted,
          sms: smsPort,
          clock: { now: () => now },
        });
        const result = await next.handleCallEvent({
          clientAccountId: client.id,
          callerE164: caller,
          answered: false,
          abandoned: false,
          calledAt: now,
        });
        assert.equal(result.smsSent, false);
        assert.equal(result.suppressedReason, "opt_out");
        assert.equal(smsPort.sent.length, 0);
      });
    }
  },
);
