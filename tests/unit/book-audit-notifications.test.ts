import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  it,
  mock,
} from "node:test";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { POST as submitBooking } from "../../src/app/api/book-audit/route";
import { POST as tick } from "../../src/app/api/book-audit/notifications/tick/route";
import { persistBookAuditLead } from "../../src/lib/book-audit-leads";
import {
  getBookAuditNotificationStatus,
  processBookAuditNotifications,
} from "../../src/lib/book-audit-notifications";
import { reportError } from "../../src/lib/errors";
import { authorizeOpsRequest } from "../../src/lib/ops-auth";
import { closePgPool } from "../../src/product/missed-call/postgres-store";
import type { BookAuditPayload } from "../../src/lib/validation/book-audit";

const managed = [
  "NODE_ENV",
  "DATABASE_URL",
  "MISSED_CALL_DURABLE_STORE",
  "SAAS_DURABLE_STORE",
  "MISSED_CALL_OPS_SECRET",
  "CRON_SECRET",
  "TURNSTILE_SECRET_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "RESEND_NOTIFY_EMAIL",
  "LEADS_WEBHOOK_URL",
  "ERROR_WEBHOOK_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "CF_TRUSTED",
  "VERCEL_ENV",
  "BOOK_AUDIT_RETRY_SECRET",
];
const original = new Map(managed.map((key) => [key, process.env[key]]));
beforeEach(() => {
  managed.forEach((key) => delete process.env[key]);
  Object.assign(process.env, {
    NODE_ENV: "production",
    MISSED_CALL_OPS_SECRET: "tc002-test-ops",
    CF_TRUSTED: "1",
  });
  mock.method(console, "error", () => {});
  mock.method(console, "warn", () => {});
  mock.method(console, "info", () => {});
});
afterEach(() => {
  mock.restoreAll();
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
after(closePgPool);

const request = (headers: Record<string, string> = {}, data?: unknown) =>
  new NextRequest("http://localhost/api/book-audit/notifications/tick", {
    method: "POST",
    headers: {
      ...headers,
      ...(data ? { "content-type": "application/json" } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
const auth = {
  authorization: "Bearer tc002-test-ops",
  "x-ops-actor": "tc002-staging-test",
};

describe("booking notification worker boundaries", () => {
  it("refuses unauthenticated requests", async () =>
    assert.equal((await tick(request())).status, 401));
  it("requires an attributable operator", async () =>
    assert.equal(
      (await tick(request({ authorization: auth.authorization }))).status,
      403,
    ));
  it("rejects oversized batches", async () =>
    assert.equal((await tick(request(auth, { limit: 1000 }))).status, 400));
  it("refuses temporary memory storage", async () =>
    assert.equal((await tick(request(auth))).status, 503));
  it("does not mark a rejected administrator webhook as delivered", async () => {
    process.env.ERROR_WEBHOOK_URL = "https://monitor.example.com";
    mock.method(
      globalThis,
      "fetch",
      async () => new Response(null, { status: 503 }),
    );
    assert.equal(await reportError(new Error("Synthetic TC002 alert")), false);
  });
  it("scopes the dedicated retry secret to the booking worker", async () => {
    process.env.BOOK_AUDIT_RETRY_SECRET = "tc002-dedicated-test";
    const retry = request({
      authorization: "Bearer tc002-dedicated-test",
      "x-ops-actor": "tc002-test",
    });
    assert.equal(authorizeOpsRequest(retry), false);
    assert.equal((await tick(retry)).status, 503); // Auth passed; no database is configured.
  });
  it("accepts an empty stream as default scheduler options", async () => {
    const empty = new NextRequest(
      "http://localhost/api/book-audit/notifications/tick",
      { method: "POST", headers: auth, body: "" },
    );
    assert.notEqual(empty.body, null);
    assert.equal((await tick(empty)).status, 503); // Reaches the storage guard, not a JSON error.
  });
  it("still rejects malformed nonempty JSON", async () => {
    const malformed = new NextRequest(
      "http://localhost/api/book-audit/notifications/tick",
      { method: "POST", headers: auth, body: "{" },
    );
    assert.equal((await tick(malformed)).status, 400);
  });
  it("still bounds raw streamed retry input", async () => {
    const oversized = new NextRequest(
      "http://localhost/api/book-audit/notifications/tick",
      { method: "POST", headers: auth, body: "x".repeat(3000) },
    );
    assert.equal((await tick(oversized)).status, 413);
  });
});

const testUrl = process.env.BOOK_AUDIT_TEST_DATABASE_URL;
// Destructive cleanup is restricted to an explicitly named local staging DB.
const localStaging =
  testUrl &&
  ["127.0.0.1", "localhost"].includes(new URL(testUrl).hostname) &&
  new URL(testUrl).pathname === "/tc002_staging";
describe(
  "booking notification PostgreSQL integration",
  {
    skip:
      !localStaging &&
      "set BOOK_AUDIT_TEST_DATABASE_URL to a local tc002_staging database",
  },
  () => {
    let db: Pool;
    let sequence = 0;
    before(async () => {
      db = new Pool({ connectionString: testUrl });
      const source = readFileSync("src/product/missed-call/schema.sql", "utf8");
      await db.query(
        source.match(
          /CREATE TABLE IF NOT EXISTS mc_book_audit_leads \([\s\S]*?\n\);/,
        )![0],
      );
      await db.query(
        readFileSync("src/lib/book-audit-notifications.sql", "utf8"),
      );
    });
    after(async () => {
      await closePgPool();
      await db.end();
    });
    beforeEach(async () => {
      Object.assign(process.env, {
        DATABASE_URL: testUrl,
        MISSED_CALL_DURABLE_STORE: "1",
        RESEND_API_KEY: "re_tc002_test",
        RESEND_FROM_EMAIL: "test@example.com",
        RESEND_NOTIFY_EMAIL: "admin@example.com",
        LEADS_WEBHOOK_URL: "https://crm.example.com",
        ERROR_WEBHOOK_URL: "https://monitor.example.com",
      });
      await db.query("TRUNCATE mc_book_audit_leads CASCADE");
      mock.method(globalThis, "fetch", async () =>
        Response.json({ message: "simulated outage" }, { status: 503 }),
      );
    });
    function payload(): BookAuditPayload {
      return {
        firstName: "TC002",
        lastName: "Synthetic",
        company: "Fictional Staging Plumbing",
        trade: "Plumbing",
        email: "customer@example.com",
        phone: "514-555-0100",
        city: "Laval",
        preferredLanguage: "en",
        serviceConsent: true,
        marketingConsent: false,
        consentWording: "Test consent",
        consentSource: "book-audit",
        companyWebsite: "",
        turnstileToken: "test-only",
      };
    }
    async function save() {
      const result = await persistBookAuditLead({
        idempotencyKey: randomUUID(),
        payload: payload(),
        consent: {
          wording: "Test consent",
          source: "test",
          at: new Date().toISOString(),
        },
        emailSent: false,
        crmForwarded: false,
      });
      assert.ok(result);
      return result.id;
    }
    async function due(id: string) {
      await db.query(
        "UPDATE mc_book_audit_notifications SET next_attempt_at = now() - interval '1 second' WHERE lead_id=$1",
        [id],
      );
    }

    it("commits three durable jobs with the lead and rolls back if the outbox insert fails", async () => {
      const id = await save();
      assert.equal(
        (
          await db.query(
            "SELECT * FROM mc_book_audit_notifications WHERE lead_id=$1",
            [id],
          )
        ).rowCount,
        3,
      );
      await db.query(
        "ALTER TABLE mc_book_audit_notifications ADD CONSTRAINT tc002_reject_jobs CHECK (channel = 'admin_alert') NOT VALID",
      );
      try {
        await assert.rejects(save);
      } finally {
        await db.query(
          "ALTER TABLE mc_book_audit_notifications DROP CONSTRAINT tc002_reject_jobs",
        );
      }
      assert.equal(
        (await db.query("SELECT id FROM mc_book_audit_leads")).rowCount,
        1,
      );
    });
    it("processes the queue from an empty scheduled POST stream", async () => {
      await save();
      const scheduled = new NextRequest(
        "http://localhost/api/book-audit/notifications/tick",
        {
          method: "POST",
          headers: {
            authorization: auth.authorization,
            "x-vercel-cron": "cloudflare",
          },
          body: "",
        },
      );
      const response = await tick(scheduled);
      assert.equal(response.status, 200);
      assert.equal(
        ((await response.json()) as { attempted: number }).attempted,
        3,
      );
    });

    it("acknowledges a saved lead separately from three failed notification channels", async () => {
      const response = await submitBooking(
        new NextRequest("http://localhost/api/book-audit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": `192.0.2.${++sequence}`,
          },
          body: JSON.stringify({ ...payload(), idempotencyKey: randomUUID() }),
        }),
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        leadSaved: boolean;
        notificationsDelivered: boolean;
        notificationsStatus: string;
      };
      assert.equal(body.leadSaved, true);
      assert.equal(body.notificationsDelivered, false);
      assert.equal(body.notificationsStatus, "pending");
      assert.equal(
        (await db.query("SELECT id FROM mc_book_audit_leads")).rowCount,
        1,
      );
      const jobs = await db.query(
        "SELECT attempts, delivered_at, next_attempt_at > now() AS delayed FROM mc_book_audit_notifications",
      );
      assert.equal(jobs.rowCount, 3);
      assert.ok(
        jobs.rows.every(
          (j) => j.attempts === 1 && !j.delivered_at && j.delayed,
        ),
      );
    });

    it("retries only failed channels with stable keys and separately repairs customer email", async () => {
      const id = await save();
      const requests: { channel: string; key: string }[] = [];
      let customerWorks = false;
      mock.method(
        globalThis,
        "fetch",
        async (url: unknown, options?: RequestInit) => {
          const body = JSON.parse(String(options?.body));
          const channel = String(url).includes("crm")
            ? "crm"
            : body.to?.includes("admin@example.com")
              ? "notify_email"
              : "customer_email";
          requests.push({
            channel,
            key: new Headers(options?.headers).get("idempotency-key") || "",
          });
          return Response.json(
            { id: "test-email" },
            {
              status:
                channel === "customer_email" && !customerWorks ? 503 : 200,
            },
          );
        },
      );
      await processBookAuditNotifications({ leadId: id });
      assert.equal(
        (await getBookAuditNotificationStatus(id)).customerEmailSent,
        false,
      );
      customerWorks = true;
      await due(id);
      await processBookAuditNotifications({ leadId: id });
      const status = await getBookAuditNotificationStatus(id);
      assert.equal(status.notificationsDelivered, true);
      assert.equal(
        requests.filter((r) => r.channel === "notify_email").length,
        1,
      );
      assert.equal(requests.filter((r) => r.channel === "crm").length, 1);
      const customer = requests.filter((r) => r.channel === "customer_email");
      assert.equal(customer.length, 2);
      assert.equal(customer[0].key, `book-audit/${id}/customer_email`);
      assert.equal(customer[0].key, customer[1].key);
    });

    it("honors retry delays and escalates persistent failure through a retried admin alert", async () => {
      const id = await save();
      await processBookAuditNotifications({
        leadId: id,
        send: async () => false,
      });
      assert.equal(
        (
          await processBookAuditNotifications({
            leadId: id,
            send: async () => false,
          })
        ).attempted,
        0,
      );
      for (let attempt = 0; attempt < 2; attempt++) {
        await due(id);
        await processBookAuditNotifications({
          leadId: id,
          send: async () => false,
        });
      }
      const alert = await db.query(
        "SELECT * FROM mc_book_audit_notifications WHERE lead_id=$1 AND channel='admin_alert'",
        [id],
      );
      assert.equal(alert.rowCount, 1);
      assert.equal(alert.rows[0].delivered_at, null);
      await due(id);
      let alerts = 0;
      await processBookAuditNotifications({
        leadId: id,
        send: async (job) => {
          if (job.channel === "admin_alert") alerts++;
          return job.channel === "admin_alert";
        },
      });
      assert.equal(alerts, 1);
      await due(id);
      await processBookAuditNotifications({
        leadId: id,
        send: async (job) => {
          if (job.channel === "admin_alert") alerts++;
          return false;
        },
      });
      assert.equal(alerts, 1);
      assert.ok(
        (
          await db.query(
            "SELECT delivered_at FROM mc_book_audit_notifications WHERE lead_id=$1 AND channel='admin_alert'",
            [id],
          )
        ).rows[0].delivered_at,
      );
    });

    it("keeps email queued when the provider returns no send acknowledgment", async () => {
      const id = await save();
      mock.method(globalThis, "fetch", async () => Response.json({}));
      await processBookAuditNotifications({ leadId: id });
      const status = await getBookAuditNotificationStatus(id);
      assert.equal(status.emailSent, false);
      assert.equal(status.customerEmailSent, false);
      assert.equal(status.notificationsDelivered, false);
      assert.equal(status.crmForwarded, true);
    });

    it("leases concurrent work once and recovers abandoned claims", async () => {
      const id = await save();
      const channels: string[] = [];
      await Promise.all(
        Array.from({ length: 6 }, () =>
          processBookAuditNotifications({
            leadId: id,
            send: async (job) => {
              channels.push(job.channel);
              await new Promise((resolve) => setTimeout(resolve, 10));
              return true;
            },
          }),
        ),
      );
      assert.deepEqual(channels.sort(), [
        "crm",
        "customer_email",
        "notify_email",
      ]);
      const abandoned = await save();
      await db.query(
        "UPDATE mc_book_audit_notifications SET lease_token='abandoned', leased_until=now()+interval '1 minute' WHERE lead_id=$1",
        [abandoned],
      );
      assert.equal(
        (
          await processBookAuditNotifications({
            leadId: abandoned,
            send: async () => true,
          })
        ).attempted,
        0,
      );
      await db.query(
        "UPDATE mc_book_audit_notifications SET leased_until=now()-interval '1 second' WHERE lead_id=$1",
        [abandoned],
      );
      assert.equal(
        (
          await processBookAuditNotifications({
            leadId: abandoned,
            send: async () => true,
          })
        ).delivered,
        3,
      );
    });

    it("retries an administrator webhook until it acknowledges the alert", async () => {
      const id = await save();
      await db.query(
        "UPDATE mc_book_audit_notifications SET attempts=2 WHERE lead_id=$1",
        [id],
      );
      await processBookAuditNotifications({ leadId: id });
      let alert = await db.query(
        "SELECT delivered_at, attempts FROM mc_book_audit_notifications WHERE lead_id=$1 AND channel='admin_alert'",
        [id],
      );
      assert.equal(alert.rowCount, 1);
      assert.equal(alert.rows[0].delivered_at, null);
      assert.equal(alert.rows[0].attempts, 1);
      await due(id);
      let alerts = 0;
      mock.method(globalThis, "fetch", async (url: unknown) => {
        if (String(url).includes("monitor.example.com")) {
          alerts++;
          return new Response(null, { status: 204 });
        }
        return Response.json({ message: "still unavailable" }, { status: 503 });
      });
      await processBookAuditNotifications({ leadId: id });
      alert = await db.query(
        "SELECT delivered_at FROM mc_book_audit_notifications WHERE lead_id=$1 AND channel='admin_alert'",
        [id],
      );
      assert.ok(alert.rows[0].delivered_at);
      assert.equal(alerts, 1);
    });

    it("backfills historical failures without inventing customer-email delivery", async () => {
      const id = await save();
      await db.query(
        "UPDATE mc_book_audit_leads SET email_sent=true WHERE id=$1",
        [id],
      );
      await db.query(
        "DELETE FROM mc_book_audit_notifications WHERE lead_id=$1",
        [id],
      );
      const migration = readFileSync(
        "src/lib/book-audit-notifications.sql",
        "utf8",
      );
      await db.query(migration);
      await db.query(migration);
      const jobs = await db.query(
        "SELECT channel, delivered_at FROM mc_book_audit_notifications WHERE lead_id=$1",
        [id],
      );
      assert.equal(jobs.rowCount, 2);
      assert.ok(
        jobs.rows.find((j) => j.channel === "notify_email").delivered_at,
      );
      assert.equal(
        jobs.rows.find((j) => j.channel === "crm").delivered_at,
        null,
      );
      assert.equal(
        (await getBookAuditNotificationStatus(id)).customerEmailSent,
        false,
      );
    });

    it("fences an expired worker from completing a newer lease", async () => {
      const id = await save();
      await processBookAuditNotifications({
        leadId: id,
        limit: 1,
        send: async (job) => {
          await db.query(
            "UPDATE mc_book_audit_notifications SET lease_token='new-owner' WHERE lead_id=$1 AND channel=$2",
            [id, job.channel],
          );
          return true;
        },
      });
      const jobs = await db.query(
        "SELECT delivered_at FROM mc_book_audit_notifications WHERE lead_id=$1",
        [id],
      );
      assert.ok(jobs.rows.every((j) => j.delivered_at === null));
    });

    it("deduplicates saved leads and does not overwrite the stored notification recipient", async () => {
      const key = randomUUID();
      const input = {
        idempotencyKey: key,
        payload: payload(),
        consent: {
          wording: "Test",
          source: "test",
          at: new Date().toISOString(),
        },
        emailSent: false,
        crmForwarded: false,
      };
      const results = await Promise.all(
        Array.from({ length: 5 }, () => persistBookAuditLead(input)),
      );
      assert.equal(results.filter((r) => !r?.duplicate).length, 1);
      await persistBookAuditLead({
        ...input,
        payload: { ...payload(), email: "forged@example.com" },
      });
      assert.equal(
        (await db.query("SELECT email FROM mc_book_audit_leads")).rows[0].email,
        "customer@example.com",
      );
      assert.equal(
        (await db.query("SELECT * FROM mc_book_audit_notifications")).rowCount,
        3,
      );
    });

    it("denies public-role queue changes even when table privileges are granted", async () => {
      const id = await save();
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query("CREATE ROLE tc002_public_test NOLOGIN");
        await client.query(
          "GRANT SELECT, INSERT, UPDATE, DELETE ON mc_book_audit_notifications TO tc002_public_test",
        );
        await client.query("SET LOCAL ROLE tc002_public_test");
        assert.equal(
          (await client.query("SELECT * FROM mc_book_audit_notifications"))
            .rowCount,
          0,
        );
        assert.equal(
          (
            await client.query(
              "UPDATE mc_book_audit_notifications SET delivered_at=now() WHERE lead_id=$1",
              [id],
            )
          ).rowCount,
          0,
        );
        await assert.rejects(
          client.query(
            "INSERT INTO mc_book_audit_notifications (lead_id,channel) VALUES ($1,'admin_alert')",
            [id],
          ),
        );
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });
  },
);
