import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { sendBusinessNotifyEmail } from "../../src/lib/business-notifications";
import { authorizeGmailCron } from "../../src/product/gmail/cron-auth";
import {
  getGmailStatus,
  getGmailStore,
  resetGmailRuntimeForTests,
} from "../../src/product/gmail/runtime";
import {
  getSaasStore,
  resetSaasRuntimeForTests,
} from "../../src/product/saas/runtime";
import { resetNotificationRuntimeForTests } from "../../src/product/notifications/runtime";
import { POST as push } from "../../src/app/api/webhooks/gmail/route";
import { createHarness, TEST_ENV } from "../support/gmail-harness";
const names = [
  "NODE_ENV",
  "DATABASE_URL",
  "SAAS_DURABLE_STORE",
  "MISSED_CALL_DURABLE_STORE",
  "SAAS_REQUIRE_DURABLE",
  "MISSED_CALL_OPS_SECRET",
  "CRON_SECRET",
  "GMAIL_SYNC_SECRET",
  "GMAIL_WEBHOOK_TOKEN",
  "GMAIL_PUBSUB_TOPIC",
  "GOOGLE_GMAIL_CLIENT_ID",
  "GOOGLE_GMAIL_CLIENT_SECRET",
  "NEXT_PUBLIC_SITE_URL",
  "TRADECATCH_E2E",
  "GMAIL_TEST_GOOGLE_BASE",
  "AUTH_SECRET",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
];
const original = new Map(names.map((n) => [n, process.env[n]]));
beforeEach(() => {
  for (const n of names) delete process.env[n];
  Object.assign(process.env, {
    NODE_ENV: "production",
    AUTH_SECRET: TEST_ENV.authSecret,
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    TRADECATCH_E2E: "1",
    GMAIL_TEST_GOOGLE_BASE: "http://fake.google",
    GMAIL_WEBHOOK_TOKEN: "unit-webhook",
    GMAIL_PUBSUB_TOPIC: "projects/unit/topics/gmail",
    GOOGLE_GMAIL_CLIENT_ID: "test-id",
    GOOGLE_GMAIL_CLIENT_SECRET: "test-secret",
  });
  resetGmailRuntimeForTests();
  resetSaasRuntimeForTests();
  resetNotificationRuntimeForTests();
  mock.method(console, "warn", () => {});
  mock.method(console, "error", () => {});
});
afterEach(() => {
  mock.restoreAll();
  resetGmailRuntimeForTests();
  resetSaasRuntimeForTests();
  resetNotificationRuntimeForTests();
  for (const [n, v] of original) {
    if (v === undefined) delete process.env[n];
    else process.env[n] = v;
  }
});
describe("Gmail delivery boundaries", () => {
  it("does not mistake a Resend API error or missing message ID for a successful email", async () => {
    process.env.RESEND_API_KEY = "re_test_only";
    process.env.RESEND_FROM_EMAIL = "test@example.test";
    let response = Response.json(
      { name: "validation_error", message: "rejected", statusCode: 422 },
      { status: 422 },
    );
    mock.method(globalThis, "fetch", async () => response.clone());
    const input = {
      toEmail: "test@example.test",
      subject: "test",
      title: "test",
      lines: [],
    };
    assert.equal((await sendBusinessNotifyEmail(input)).sent, false);
    response = Response.json({});
    assert.equal((await sendBusinessNotifyEmail(input)).sent, false);
    response = Response.json({ id: "email_test" });
    assert.equal((await sendBusinessNotifyEmail(input)).sent, true);
  });
  it("limits the dedicated scheduler credential to a proper Bearer token", () => {
    process.env.GMAIL_SYNC_SECRET = "unit-gmail-cron";
    const req = (value?: string) =>
      new Request("https://example.test/api/gmail/sync/tick", {
        headers: value ? { authorization: value } : {},
      });
    assert.equal(authorizeGmailCron(req()), false);
    assert.equal(authorizeGmailCron(req("unit-gmail-cron")), false);
    assert.equal(authorizeGmailCron(req("Bearer wrong")), false);
    assert.equal(authorizeGmailCron(req("Bearer unit-gmail-cron")), true);
  });
  it("retries failed/throttled Gmail pushes, reports an active watch only after registration, and keeps failed syncs from advancing freshness", async () => {
    const created = await getSaasStore().createOrganizationWithOwner({
      name: "Staging",
      ownerEmail: "owner@example.test",
      ownerName: "Owner",
      accountType: "production",
    });
    const owner = {
      organizationId: created.organization.id,
      userId: created.user.id,
    };
    const h = createHarness(getGmailStore());
    const account = await h.connect("owner@gmail.com", owner);
    let fail = true;
    let watchFails = false;
    const google = h.google.fetchImpl();
    mock.method(
      globalThis,
      "fetch",
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (fail)
          return Response.json(
            { error: { message: "temporary" } },
            { status: 503 },
          );
        if (watchFails && String(input).endsWith("/watch"))
          return Response.json(
            { error: { message: "unconfigured topic" } },
            { status: 403 },
          );
        return google(input, init);
      },
    );
    const request = () =>
      new NextRequest(
        "http://localhost:3000/api/webhooks/gmail?token=unit-webhook",
        {
          method: "POST",
          body: JSON.stringify({
            message: {
              data: Buffer.from(
                JSON.stringify({
                  emailAddress: "owner@gmail.com",
                  historyId: h.google.mailbox("owner@gmail.com").historyId,
                }),
              ).toString("base64"),
            },
          }),
        },
      );
    assert.equal((await push(request())).status, 503);
    assert.equal((await h.account(owner)).lastSyncAt, null);
    assert.equal((await push(request())).status, 503);
    fail = false;
    await h.store.updateAccount(account.id, {
      lastAttemptAt: null,
      nextSyncAt: null,
    });
    assert.equal((await push(request())).status, 200);
    const active = await getGmailStatus(owner.organizationId, owner.userId);
    assert.equal(active.pushConfigured, true);
    assert.equal(active.pushEnabled, true);
    assert.ok(active.lastSyncAt);
    assert.equal((await push(request())).status, 200);
    watchFails = true;
    await h.store.updateAccount(account.id, {
      lastAttemptAt: null,
      nextSyncAt: null,
      watchExpiration: "2000-01-01T00:00:00Z",
      historyId: null,
    });
    assert.equal((await push(request())).status, 200);
    const fallback = await getGmailStatus(owner.organizationId, owner.userId);
    assert.equal(fallback.pushConfigured, true);
    assert.equal(fallback.pushEnabled, false);
    assert.ok(fallback.lastSyncAt);
  });
});
