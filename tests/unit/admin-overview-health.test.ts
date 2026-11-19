import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { resetBillingEventsForTests, recordBillingEvent } from "../../src/product/admin-console/billing-db";
import { integrationConfig, loadSystemHealth } from "../../src/product/admin-console/health";
import { buildOverview, resetOverviewCacheForTests, type OverviewInputs } from "../../src/product/admin-console/overview";
import type { StripeHttp } from "../../src/product/admin-console/stripe-admin";
import { createReliabilityService, type Probe } from "../../src/product/reliability/service";
import { createMemoryReliabilityStore } from "../../src/product/reliability/store";

const NOW = new Date("2026-11-18T12:00:00Z");

const okProbes: Probe[] = [
  { service: "api", status: "healthy", state: "operational", detail: "Process responded" },
  { service: "database", status: "healthy", state: "operational", detail: "SELECT 1 succeeded" },
  { service: "jobs", status: "healthy", state: "operational", detail: "cron invoked" },
];

function reliability(probes: Probe[] = okProbes) {
  return createReliabilityService({
    store: createMemoryReliabilityStore(),
    now: () => NOW,
    environment: () => "production",
    probe: async () => probes,
  });
}

describe("integration configuration", () => {
  it("reports only presence, never a value", () => {
    const env = {
      TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
      TWILIO_AUTH_TOKEN: "super-secret-token",
      STRIPE_SECRET_KEY: "sk_live_secret",
      STRIPE_WEBHOOK_SECRET: "whsec_secret",
      BLAND_API_KEY: "bland-secret",
    };
    const config = integrationConfig(env);
    const byKey = Object.fromEntries(config.map((c) => [c.key, c]));
    assert.equal(byKey.twilio.configured, true);
    assert.equal(byKey.stripe.configured, true);
    assert.equal(byKey.bland.configured, true);
    assert.equal(byKey.resend.configured, false);
    const text = JSON.stringify(config);
    for (const secret of ["super-secret-token", "sk_live_secret", "whsec_secret", "bland-secret", env.TWILIO_ACCOUNT_SID]) {
      assert.ok(!text.includes(secret), `${secret} leaked`);
    }
  });

  it("warns when Stripe has a key but no webhook secret, and is honest that Cloudflare analytics are not connected", () => {
    const config = Object.fromEntries(integrationConfig({ STRIPE_SECRET_KEY: "sk_live_x" }).map((c) => [c.key, c]));
    assert.match(config.stripe.detail, /no webhook signing secret/);
    assert.equal(config.cloudflare.configured, false);
    assert.match(config.cloudflare.detail, /not connected/);
  });

  it("is unconfigured when nothing is set", () => {
    assert.ok(integrationConfig({}).every((c) => c.configured === false));
  });
});

describe("system health", () => {
  it("shows database connectivity and overall status from the probes", async () => {
    const health = await loadSystemHealth(reliability(), {}, {}, NOW);
    assert.equal(health.overall, "healthy");
    assert.deepEqual(health.database, { state: "operational", status: "healthy", detail: "SELECT 1 succeeded" });
    assert.equal(health.generatedAt, NOW.toISOString());
  });

  it("shows an unavailable database as unavailable, and the platform as not healthy", async () => {
    const down = okProbes.map((p) =>
      p.service === "database" ? { ...p, status: "unavailable" as const, state: "configured" as const, detail: "Database check failed" } : p,
    );
    const health = await loadSystemHealth(reliability(down), {}, {}, NOW);
    assert.equal(health.database.status, "unavailable");
    assert.equal(health.overall, "unavailable");
  });

  it("shows API and webhook failures with their diagnostics, newest first", async () => {
    const service = reliability();
    await service.recordError({ service: "stripe", operation: "webhook.invoice.payment_failed", errorCode: "sync_failed", severity: "high", retryable: true, detail: "Event evt_1 could not be synchronized" });
    await service.recordError({ service: "twilio_sms", operation: "sms.send", errorCode: "provider_5xx", severity: "medium", retryable: true });
    const health = await loadSystemHealth(service, {}, {}, NOW);
    assert.equal(health.errors.length, 2);
    assert.equal(health.webhookFailures.length, 1);
    assert.equal(health.webhookFailures[0].operation, "webhook.invoice.payment_failed");
    assert.match(health.webhookFailures[0].detail ?? "", /evt_1/);
    assert.equal(health.totals.webhookFailures, 1);
    assert.equal(health.totals.openErrors, 2);
  });

  it("redacts secrets from recorded diagnostics", async () => {
    const service = reliability();
    await service.recordError({
      service: "stripe", operation: "webhook.x", errorCode: "sync_failed", severity: "high", retryable: true,
      detail: "key sk_live_abcdefghijklmnop failed for owner@acme.ca with Bearer abc.def.ghi", // secret-scan: allow
    });
    const health = await loadSystemHealth(service, {}, {}, NOW);
    const text = JSON.stringify(health);
    assert.ok(!text.includes("sk_live_abcdefghijklmnop")); // secret-scan: allow
    assert.ok(!text.includes("abc.def.ghi"));
  });

  it("filters by business, service, status and date", async () => {
    const service = reliability();
    await service.recordError({ organizationId: "org_a", service: "twilio_sms", operation: "sms.send", errorCode: "x", severity: "medium", retryable: true });
    await service.recordError({ organizationId: "org_b", service: "stripe", operation: "webhook.x", errorCode: "y", severity: "medium", retryable: true });
    assert.equal((await loadSystemHealth(service, { organizationId: "org_a" }, {}, NOW)).errors.length, 1);
    assert.equal((await loadSystemHealth(service, { service: "stripe" }, {}, NOW)).errors.length, 1);
    assert.equal((await loadSystemHealth(service, { status: "resolved" }, {}, NOW)).errors.length, 0);
    assert.equal((await loadSystemHealth(service, { from: "2026-11-18", to: "2026-11-18" }, {}, NOW)).errors.length, 2);
    assert.equal((await loadSystemHealth(service, { from: "2026-11-19" }, {}, NOW)).errors.length, 0);
    assert.equal((await loadSystemHealth(service, { to: "2026-11-17" }, {}, NOW)).errors.length, 0);
  });

  it("lists failed jobs and counts them", async () => {
    const service = reliability();
    await service.recordFailedOperation({ organizationId: "org_a", service: "twilio_sms", operation: "sms.followup", idempotencyKey: "k1", retryable: true, error: "timeout", simulated: false });
    const health = await loadSystemHealth(service, {}, {}, NOW);
    assert.equal(health.failedOperations.length, 1);
    assert.equal(health.jobs.failed, 1);
    assert.equal(health.totals.failedOperations, 1);
    assert.equal((await loadSystemHealth(service, { organizationId: "org_b" }, {}, NOW)).failedOperations.length, 0);
  });

  it("opens an incident after repeated failures and shows it", async () => {
    const service = reliability();
    for (let i = 0; i < 3; i += 1) {
      await service.recordError({ service: "stripe", operation: "webhook.x", errorCode: "sync_failed", severity: "high", retryable: true });
    }
    const health = await loadSystemHealth(service, {}, {}, NOW);
    assert.equal(health.totals.openIncidents, 1);
    assert.equal(health.incidents[0].service, "stripe");
  });
});

describe("overview", () => {
  beforeEach(() => {
    resetBillingEventsForTests();
    resetOverviewCacheForTests();
  });

  const platform = { businesses: 12, activeSubscriptions: 9, suspended: 2, mrr: 2241, calls: 340 };
  const base = (over: Partial<OverviewInputs> = {}): OverviewInputs => ({
    platform,
    stripe: { configured: false, reason: "no key" },
    reliability: reliability(),
    db: null,
    pendingWebsiteRequests: 0,
    deniedAdminAttempts24h: 0,
    subscriptionRows: [],
    now: NOW,
    ...over,
  });

  it("reports the platform's customers, subscriptions, calls and honest revenue source", async () => {
    const overview = await buildOverview(base());
    assert.equal(overview.kpis.customers, 12);
    assert.equal(overview.kpis.activeSubscriptions, 9);
    assert.equal(overview.kpis.suspended, 2);
    assert.equal(overview.kpis.calls, 340);
    assert.equal(overview.kpis.mrr.amountCad, 2241);
    // No Stripe key: the figure is the catalog's, and it says so.
    assert.equal(overview.kpis.mrr.source, "catalog");
    assert.match(overview.kpis.mrr.note ?? "", /not configured/);
    assert.equal(overview.generatedAt, NOW.toISOString());
  });

  it("takes MRR from Stripe when it is configured", async () => {
    const http: StripeHttp = {
      get: async () => ({
        data: [
          { id: "sub_1", status: "active", livemode: true, customer: "cus_1", items: { data: [{ id: "si_1", price: { id: "p1", currency: "cad", unit_amount: 24999, recurring: { interval: "month" } } }] } },
          { id: "sub_2", status: "past_due", livemode: true, customer: "cus_2", items: { data: [{ id: "si_2", price: { id: "p2", currency: "cad", unit_amount: 34999, recurring: { interval: "month" } } }] } },
          { id: "sub_3", status: "canceled", livemode: true, customer: "cus_3", items: { data: [{ id: "si_3", price: { id: "p1", currency: "cad", unit_amount: 24999, recurring: { interval: "month" } } }] } },
        ],
        has_more: false,
      }),
      post: async () => {
        throw new Error("overview must never write to Stripe");
      },
    };
    const overview = await buildOverview(base({ stripe: { configured: true, livemode: true, http } }));
    assert.equal(overview.kpis.mrr.source, "stripe");
    assert.equal(overview.kpis.mrr.amountCad, 599.98);
    assert.equal(overview.kpis.mrr.note, null);
  });

  it("falls back to the catalog, labelled, when Stripe cannot be reached", async () => {
    const http: StripeHttp = {
      get: async () => {
        throw new Error("network");
      },
      post: async () => ({}),
    };
    const overview = await buildOverview(base({ stripe: { configured: true, livemode: true, http } }));
    assert.equal(overview.kpis.mrr.source, "catalog");
    assert.match(overview.kpis.mrr.note ?? "", /could not be reached/);
  });

  it("surfaces failed payments, past-due subscriptions, webhook failures, jobs and pending website requests as alerts", async () => {
    resetBillingEventsForTests();
    await recordBillingEvent(
      {
        eventId: "evt_pf", eventType: "invoice.payment_failed", livemode: true, customerId: "cus_1",
        subscriptionId: "sub_1", invoiceId: "in_1", amountCents: 24999, currency: "CAD",
        attemptCount: 2, nextAttemptAt: null, outcome: "failed",
      },
      null,
      new Date("2026-11-17T10:00:00Z"),
    );
    const service = reliability();
    await service.recordError({ service: "stripe", operation: "webhook.invoice.paid", errorCode: "sync_failed", severity: "high", retryable: true });
    await service.recordFailedOperation({ service: "twilio_sms", operation: "sms.followup", idempotencyKey: "k", retryable: true, error: "timeout", simulated: false });

    const overview = await buildOverview(
      base({
        reliability: service,
        pendingWebsiteRequests: 3,
        deniedAdminAttempts24h: 2,
        subscriptionRows: [
          { subscriptionId: "sub_9", organizationId: "org_1", customerId: "cus_1", livemode: true, status: "past_due", plan: "essential", cancelAtPeriodEnd: false, currentPeriodEnd: null, latestInvoiceId: null, syncedAt: "2026-11-10T00:00:00.000Z" },
        ],
      }),
    );
    const kinds = overview.alerts.map((a) => a.kind);
    for (const kind of ["failed_payment", "past_due_subscription", "webhook_failure", "failed_job", "website_request", "suspicious_admin_activity"] as const) {
      assert.ok(kinds.includes(kind), `missing alert: ${kind}`);
    }
    assert.equal(overview.kpis.failedPayments30d, 1);
    assert.equal(overview.kpis.pastDueSubscriptions, 1);
    assert.equal(overview.kpis.pendingWebsiteRequests, 3);
    // Most severe first.
    assert.equal(overview.alerts[0].severity, "critical");
    const order = { critical: 0, warning: 1, info: 2 };
    const severities = overview.alerts.map((a) => order[a.severity]);
    assert.deepEqual(severities, [...severities].sort((a, b) => a - b));
  });

  it("raises no alerts, and says zero, when everything is healthy", async () => {
    const overview = await buildOverview(base());
    assert.deepEqual(overview.alerts, []);
    assert.equal(overview.kpis.failedPayments30d, 0);
    assert.equal(overview.kpis.openAlerts, 0);
  });

  it("counts only failures in the last 30 days", async () => {
    await recordBillingEvent(
      { eventId: "evt_old", eventType: "invoice.payment_failed", livemode: true, customerId: "cus_1", subscriptionId: null, invoiceId: "in_old", amountCents: 100, currency: "CAD", attemptCount: 1, nextAttemptAt: null, outcome: "failed" },
      null,
      new Date("2026-09-01T00:00:00Z"),
    );
    assert.equal((await buildOverview(base())).kpis.failedPayments30d, 0);
  });

  it("still produces an overview when the health service is down", async () => {
    const broken = {
      overview: async () => {
        throw new Error("down");
      },
      listErrors: async () => [],
      jobs: async () => ({ pending: 0, failed: 0, dead: 0, resolved: 0 }),
    } as unknown as ReturnType<typeof reliability>;
    const overview = await buildOverview(base({ reliability: broken }));
    assert.equal(overview.kpis.customers, 12);
  });
});
