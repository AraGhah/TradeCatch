import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  assertFeature,
  featuresForPlan,
  orgHasFeature,
} from "../../src/product/saas/entitlements";
import {
  resolveEffectiveEntitlements,
  assertEffectiveFeature,
} from "../../src/product/billing/entitlementService";
import { createMemoryBillingStore } from "../../src/product/billing/memory-store";
import { createSubscriptionService } from "../../src/product/billing/subscriptionService";
import { createUsageService } from "../../src/product/billing/usageService";
import { createBillingService } from "../../src/product/billing/billingService";
import { createWebhookHandler } from "../../src/product/billing/stripe/webhookHandler";
import { createMemoryStripePort } from "../../src/product/billing/stripe/stripeClient";
import { createEmptySubscription } from "../../src/product/billing/store";
import type { BusinessSubscription } from "../../src/product/billing/types";
import type Stripe from "stripe";

const PRICE_ENV = {
  STRIPE_PRICE_STARTER_MONTHLY: "price_starter_m",
  STRIPE_PRICE_GROWTH_MONTHLY: "price_growth_m",
  STRIPE_PRICE_AI_RECEPTIONIST_MONTHLY: "price_ai_m",
  STRIPE_PRICE_STARTER_ANNUAL: "price_starter_y",
  STRIPE_PRICE_GROWTH_ANNUAL: "price_growth_y",
  STRIPE_PRICE_AI_RECEPTIONIST_ANNUAL: "price_ai_y",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  BILLING_GRACE_PERIOD_DAYS: "3",
};

describe("billing entitlements catalog", () => {
  it("keeps quote follow-ups off Starter and AI features on AI plan only", () => {
    assert.equal(orgHasFeature("starter", "QUOTE_FOLLOW_UP"), false);
    assert.equal(orgHasFeature("growth", "QUOTE_FOLLOW_UP"), true);
    assert.equal(orgHasFeature("starter", "AI_PHONE_ANSWERING"), false);
    assert.equal(orgHasFeature("growth", "AI_PHONE_ANSWERING"), false);
    assert.equal(orgHasFeature("ai_receptionist", "AI_PHONE_ANSWERING"), true);
    assert.equal(orgHasFeature("ai_receptionist", "ADVANCED_ANALYTICS"), true);
    assert.equal(assertFeature("starter", "AI_CALL_TRANSFER").ok, false);
    assert.ok(featuresForPlan("growth").every((f) => orgHasFeature("ai_receptionist", f)));
  });
});

describe("effective entitlements + grace", () => {
  it("falls back to organization plan when there is no Stripe subscription", () => {
    const entitlements = resolveEffectiveEntitlements({
      businessId: "org_a",
      organizationPlan: "growth",
      subscription: null,
    });
    assert.equal(entitlements.accessMode, "manual");
    assert.equal(entitlements.plan, "growth");
    assert.equal(assertEffectiveFeature(entitlements, "APPOINTMENT_BOOKING").ok, true);
    assert.equal(assertEffectiveFeature(entitlements, "AI_PHONE_ANSWERING").ok, false);
  });

  it("keeps features during past_due grace period", () => {
    const now = new Date("2026-10-16T12:00:00.000Z");
    const sub: BusinessSubscription = {
      ...createEmptySubscription("org_a", "ai_receptionist", now.toISOString()),
      stripeSubscriptionId: "sub_1",
      stripeCustomerId: "cus_1",
      status: "past_due",
      gracePeriodEndsAt: "2026-10-18T12:00:00.000Z",
      updatedAt: now.toISOString(),
    };
    const entitlements = resolveEffectiveEntitlements({
      businessId: "org_a",
      organizationPlan: "starter",
      subscription: sub,
      now,
    });
    assert.equal(entitlements.accessMode, "grace");
    assert.equal(assertEffectiveFeature(entitlements, "AI_PHONE_ANSWERING").ok, true);
  });

  it("restricts paid AI after grace ends but keeps starter recovery", () => {
    const now = new Date("2026-10-20T12:00:00.000Z");
    const sub: BusinessSubscription = {
      ...createEmptySubscription("org_a", "ai_receptionist", "2026-10-10T12:00:00.000Z"),
      stripeSubscriptionId: "sub_1",
      status: "past_due",
      gracePeriodEndsAt: "2026-10-18T12:00:00.000Z",
      updatedAt: "2026-10-10T12:00:00.000Z",
    };
    const entitlements = resolveEffectiveEntitlements({
      businessId: "org_a",
      organizationPlan: "ai_receptionist",
      subscription: sub,
      now,
    });
    assert.equal(entitlements.accessMode, "restricted");
    assert.equal(assertEffectiveFeature(entitlements, "AI_PHONE_ANSWERING").ok, false);
    assert.equal(assertEffectiveFeature(entitlements, "MISSED_CALL_RECOVERY").ok, true);
  });
});

describe("usage limits", () => {
  it("dedupes usage records and blocks new AI sessions at hard zero allowance", async () => {
    const store = createMemoryBillingStore();
    const usage = createUsageService({
      store,
      now: () => new Date("2026-10-16T12:00:00.000Z"),
    });

    const first = await usage.recordUsage({
      businessId: "org_u",
      metric: "sms_segments",
      quantity: 10,
      source: "test",
      externalId: "sms_1",
      plan: "starter",
    });
    assert.equal(first.recorded, true);

    const dup = await usage.recordUsage({
      businessId: "org_u",
      metric: "sms_segments",
      quantity: 10,
      source: "test",
      externalId: "sms_1",
      plan: "starter",
    });
    assert.equal(dup.recorded, false);
    assert.equal(dup.reason, "duplicate");

    const ai = await usage.evaluateLimit({
      businessId: "org_u",
      metric: "ai_call_minutes",
      additional: 5,
      plan: "starter",
    });
    assert.equal(ai.allow, false);
    assert.equal(ai.action, "block_new_sessions");
  });
});

describe("checkout + webhook lifecycle (memory Stripe)", () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const [k, v] of Object.entries(PRICE_ENV)) {
      prev[k] = process.env[k];
      process.env[k] = v;
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("creates checkout with approved price ids and activates only after webhook", async () => {
    const store = createMemoryBillingStore();
    const stripe = createMemoryStripePort();
    const plansUpdated: Array<"starter" | "growth" | "ai_receptionist"> = [];
    const subscriptions = createSubscriptionService({
      store,
      now: () => new Date("2026-10-16T12:00:00.000Z"),
      updateOrganizationPlan: async (_id, plan) => {
        plansUpdated.push(plan);
      },
    });
    const usage = createUsageService({ store });
    const billing = createBillingService({
      store,
      subscriptions,
      usage,
      stripe,
      now: () => new Date("2026-10-16T12:00:00.000Z"),
    });

    const checkout = await billing.createCheckout({
      businessId: "org_bill",
      organizationPlan: "starter",
      plan: "growth",
      interval: "month",
      customerEmail: "owner@example.com",
      customerName: "Owner",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      idempotencyKey: "idem_1",
    });
    assert.equal(checkout.ok, true);
    if (!checkout.ok) return;
    assert.match(checkout.url, /checkout\.stripe\.test/);
    // Success URL alone must not unlock Growth.
    assert.deepEqual(plansUpdated, []);

    const subId = "sub_test_1";
    const nowSec = Math.floor(Date.parse("2026-10-16T12:00:00.000Z") / 1000);
    stripe.subscriptions.set(subId, {
      id: subId,
      object: "subscription",
      customer: [...stripe.customers.keys()][0],
      status: "active",
      currency: "cad",
      current_period_start: nowSec,
      current_period_end: nowSec + 30 * 24 * 3600,
      trial_end: null,
      cancel_at_period_end: false,
      canceled_at: null,
      latest_invoice: "in_1",
      metadata: { businessId: "org_bill", plan: "growth", interval: "month" },
      items: {
        object: "list",
        data: [
          {
            id: "si_1",
            object: "subscription_item",
            price: {
              id: "price_growth_m",
              object: "price",
              unit_amount: 75000,
              recurring: { interval: "month" },
            },
          },
        ],
      },
    } as unknown as Stripe.Subscription);

    const handler = createWebhookHandler({
      store,
      subscriptions,
      stripe,
      env: process.env,
      now: () => new Date("2026-10-16T12:00:00.000Z"),
    });

    const event: Stripe.Event = {
      id: "evt_1",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: checkout.sessionId,
          object: "checkout.session",
          mode: "subscription",
          customer: [...stripe.customers.keys()][0],
          subscription: subId,
          client_reference_id: "org_bill",
          metadata: {
            businessId: "org_bill",
            plan: "growth",
            interval: "month",
          },
        } as unknown as Stripe.Checkout.Session,
      },
    } as Stripe.Event;

    const verified = await handler.verifyAndParse(
      JSON.stringify(event),
      `t=1,v1=${PRICE_ENV.STRIPE_WEBHOOK_SECRET}`,
    );
    assert.equal(verified.ok, true);
    if (!verified.ok) return;

    const processed = await handler.processEvent(verified.event);
    assert.equal(processed.duplicate, false);
    assert.equal(processed.businessId, "org_bill");
    assert.ok(plansUpdated.some((p) => p === "growth"));

    const dup = await handler.processEvent(verified.event);
    assert.equal(dup.duplicate, true);

    const entitlements = await subscriptions.getEffective("org_bill", "starter");
    assert.equal(entitlements.plan, "growth");
    assert.equal(assertEffectiveFeature(entitlements, "QUOTE_FOLLOW_UP").ok, true);
  });

  it("rejects invalid webhook signatures", async () => {
    const store = createMemoryBillingStore();
    const stripe = createMemoryStripePort();
    const subscriptions = createSubscriptionService({
      store,
      updateOrganizationPlan: async () => undefined,
    });
    const handler = createWebhookHandler({
      store,
      subscriptions,
      stripe,
      env: process.env,
    });
    const bad = await handler.verifyAndParse("{}", "t=1,v1=wrong");
    assert.equal(bad.ok, false);
    if (bad.ok) return;
    assert.equal(bad.status, 400);
  });

  it("records payment failure with grace period", async () => {
    const store = createMemoryBillingStore();
    const subscriptions = createSubscriptionService({
      store,
      now: () => new Date("2026-10-16T12:00:00.000Z"),
      updateOrganizationPlan: async () => undefined,
    });
    await store.saveSubscription({
      ...createEmptySubscription(
        "org_fail",
        "growth",
        "2026-10-01T00:00:00.000Z",
      ),
      stripeSubscriptionId: "sub_fail",
      stripeCustomerId: "cus_fail",
      status: "active",
    });
    const failed = await subscriptions.markPaymentFailed({
      businessId: "org_fail",
      invoiceId: "in_fail",
      stripeEventId: "evt_fail",
    });
    assert.ok(failed);
    assert.equal(failed!.status, "past_due");
    assert.ok(failed!.gracePeriodEndsAt);
  });

  it("prevents duplicate active checkout for same plan", async () => {
    const store = createMemoryBillingStore();
    const stripe = createMemoryStripePort();
    const subscriptions = createSubscriptionService({
      store,
      updateOrganizationPlan: async () => undefined,
    });
    await store.saveSubscription({
      ...createEmptySubscription(
        "org_dup",
        "growth",
        "2026-10-01T00:00:00.000Z",
      ),
      stripeSubscriptionId: "sub_live",
      status: "active",
      plan: "growth",
    });
    const billing = createBillingService({
      store,
      subscriptions,
      usage: createUsageService({ store }),
      stripe,
    });
    const result = await billing.createCheckout({
      businessId: "org_dup",
      organizationPlan: "growth",
      plan: "growth",
      interval: "month",
      customerEmail: "a@example.com",
      customerName: "A",
      successUrl: "https://example.com/s",
      cancelUrl: "https://example.com/c",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 409);
  });
});

describe("account isolation", () => {
  it("does not return another business subscription by id confusion", async () => {
    const store = createMemoryBillingStore();
    await store.saveSubscription({
      ...createEmptySubscription("org_1", "growth", "2026-10-01T00:00:00.000Z"),
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "active",
    });
    await store.saveSubscription({
      ...createEmptySubscription("org_2", "starter", "2026-10-01T00:00:00.000Z"),
      stripeCustomerId: "cus_2",
      stripeSubscriptionId: "sub_2",
      status: "active",
    });
    const a = await store.getSubscription("org_1");
    const b = await store.getSubscription("org_2");
    assert.equal(a?.stripeCustomerId, "cus_1");
    assert.equal(b?.stripeCustomerId, "cus_2");
    assert.equal(await store.getBusinessByStripeCustomer("cus_1"), "org_1");
    const invoices = await store.listInvoices("org_1");
    assert.equal(invoices.length, 0);
  });
});
