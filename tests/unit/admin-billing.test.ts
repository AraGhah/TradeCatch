import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  billingEventFromWebhook,
  countRecentFailedPayments,
  listBillingEvents,
  organizationsByCustomers,
  recordBillingEvent,
  resetBillingEventsForTests,
} from "../../src/product/admin-console/billing-db";
import { driftOf, loadInvoices, loadSubscriptions } from "../../src/product/admin-console/billing-views";
import {
  SUBSCRIPTION_CONFIRM,
  StripeHttpError,
  changeSubscription,
  configuredPriceId,
  listStripeInvoices,
  listStripeSubscriptions,
  loadPlanPrices,
  monthlyRecurringCents,
  planPriceMap,
  resolveStripe,
  summarizeOutstanding,
  type StripeHttp,
  type SubscriptionChangeDeps,
} from "../../src/product/admin-console/stripe-admin";
import { createMemorySaasStore } from "../../src/product/saas/memory-store";
import type { AdminDb } from "../../src/product/admin-console/db";
import { openAdminConsoleDb, pgliteAvailable, poolOf, type Db } from "./support/pglite-db";

const ENV = {
  STRIPE_TEST_PRICE_ESSENTIAL: "price_ess",
  STRIPE_TEST_PRICE_PROFESSIONAL: "price_pro",
  STRIPE_PRICE_ESSENTIAL: "price_live_ess",
  STRIPE_PRICE_PROFESSIONAL: "price_live_pro",
};

const price = (id: string, cents: number, over: Record<string, unknown> = {}) => ({
  id,
  active: true,
  currency: "cad",
  unit_amount: cents,
  type: "recurring",
  recurring: { interval: "month" },
  ...over,
});

const subscription = (over: Record<string, unknown> = {}, priceId = "price_ess", cents = 24999) => ({
  id: "sub_ABC12345",
  status: "active",
  livemode: false,
  customer: {
    id: "cus_1",
    email: "owner@acme.ca",
    name: "Owner",
    metadata: { organization_id: "org_1" },
  },
  cancel_at_period_end: false,
  current_period_end: 1_790_000_000,
  latest_invoice: "in_1",
  created: 1_780_000_000,
  items: { data: [{ id: "si_1", price: price(priceId, cents) }] },
  ...over,
});

type Call = { path: string; query?: Record<string, string | string[]> };
type Post = { path: string; form: Record<string, string>; key: string };

/** A Stripe that records everything it is asked. Tests assert on what was NOT called too. */
function fakeStripe(opts: {
  get?: (path: string, query?: Record<string, string | string[]>) => unknown;
  post?: (path: string, form: Record<string, string>, key: string) => unknown;
}) {
  const gets: Call[] = [];
  const posts: Post[] = [];
  const http: StripeHttp = {
    async get(path, query) {
      gets.push({ path, query });
      if (!opts.get) throw new Error("unexpected GET " + path);
      return opts.get(path, query);
    },
    async post(path, form, key) {
      posts.push({ path, form, key });
      if (!opts.post) throw new Error("unexpected POST " + path);
      return opts.post(path, form, key);
    },
  };
  return { http, gets, posts };
}

describe("resolving which Stripe account the console talks to", () => {
  it("is unconfigured without a key", () => {
    const ctx = resolveStripe({});
    assert.equal(ctx.configured, false);
  });

  it("uses test mode for a test key and live mode for a live key, preferring live", () => {
    const test = resolveStripe({ STRIPE_TEST_SECRET_KEY: "sk_test_abc" });
    assert.ok(test.configured && test.livemode === false);
    const live = resolveStripe({ STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_TEST_SECRET_KEY: "sk_test_abc" });
    assert.ok(live.configured && live.livemode === true);
    // Like the billing sync, a test key is accepted from either variable.
    const fallback = resolveStripe({ STRIPE_SECRET_KEY: "sk_test_abc" });
    assert.ok(fallback.configured && fallback.livemode === false);
  });

  it("rejects anything that is not a secret or restricted key of that mode", () => {
    for (const bad of ["pk_live_abc", "pk_test_abc", "rk_live_abc", "whsec_abc", "garbage", " "]) {
      assert.equal(resolveStripe({ STRIPE_SECRET_KEY: bad }).configured, false, bad);
    }
    // A live key in the test slot is not a test key.
    assert.equal(resolveStripe({ STRIPE_TEST_SECRET_KEY: "sk_live_abc" }).configured, false);
  });

  it("maps configured price ids to plans, per mode", () => {
    assert.equal(planPriceMap(false, ENV).get("price_pro"), "professional");
    assert.equal(planPriceMap(true, ENV).get("price_live_ess"), "essential");
    assert.equal(configuredPriceId("essential", false, ENV), "price_ess");
    assert.equal(configuredPriceId("professional", true, ENV), "price_live_pro");
    assert.equal(configuredPriceId("essential", false, {}), null);
  });
});

describe("plan prices as Stripe actually has them", () => {
  it("shows Stripe's amount beside the catalog's and says whether they match", async () => {
    const { http } = fakeStripe({
      get: (path) =>
        path === "prices/price_ess"
          ? price("price_ess", 24999, { product: { name: "TradeCatch Essential" } })
          : price("price_pro", 34900),
    });
    const [essential, professional] = await loadPlanPrices(http, false, ENV);
    assert.equal(essential.plan, "essential");
    assert.equal(essential.unitAmountCents, 24999);
    assert.equal(essential.productName, "TradeCatch Essential");
    // Essential in Stripe is the catalog's $249.99, so they agree.
    assert.equal(essential.catalogMonthlyCad, 249.99);
    assert.equal(essential.matchesCatalog, true);
    // Professional was left at an old $349.00 in Stripe while the catalog says $349.99:
    // the console must show the disagreement instead of hiding it.
    assert.equal(professional.unitAmountCents, 34900);
    assert.equal(professional.catalogMonthlyCad, 349.99);
    assert.equal(professional.matchesCatalog, false);
  });

  it("reports a missing or unreadable price instead of inventing one", async () => {
    const { http } = fakeStripe({
      get: (path) => {
        if (path.endsWith("price_ess")) throw new StripeHttpError(404, "resource_missing");
        throw new StripeHttpError(500, null);
      },
    });
    const [essential, professional] = await loadPlanPrices(http, false, ENV);
    assert.equal(essential.unitAmountCents, null);
    assert.match(essential.error ?? "", /no price/i);
    assert.match(professional.error ?? "", /could not be read/i);
    const [unset] = await loadPlanPrices(http, false, {});
    assert.match(unset.error ?? "", /No Stripe price id/);
  });
});

describe("reading subscriptions and invoices from Stripe", () => {
  it("normalizes subscriptions and maps the price to a plan", async () => {
    const { http, gets } = fakeStripe({
      get: () => ({ data: [subscription(), subscription({ id: "sub_PRO99999", status: "past_due" }, "price_pro", 34900)], has_more: true }),
    });
    const page = await listStripeSubscriptions(http, false, { status: "all", limit: 2 }, ENV);
    assert.deepEqual(page.rows.map((s) => [s.id, s.plan, s.status, s.unitAmountCents]), [
      ["sub_ABC12345", "essential", "active", 24999],
      ["sub_PRO99999", "professional", "past_due", 34900],
    ]);
    assert.equal(page.rows[0].currency, "CAD");
    assert.equal(page.rows[0].currentPeriodEnd, new Date(1_790_000_000 * 1000).toISOString());
    assert.equal(page.hasMore, true);
    assert.equal(page.nextCursor, "sub_PRO99999");
    assert.equal(gets[0].path, "subscriptions");
    assert.equal(gets[0].query?.status, "all");
  });

  it("keeps card details out of what it returns", async () => {
    const withCard = subscription({
      default_payment_method: { id: "pm_1", card: { last4: "4242", brand: "visa" } },
    });
    const { http } = fakeStripe({ get: () => ({ data: [withCard] }) });
    const page = await listStripeSubscriptions(http, false, {}, ENV);
    assert.doesNotMatch(JSON.stringify(page), /4242|visa|pm_1|card/);
  });

  it("totals what is outstanding and overdue by currency, open invoices only", async () => {
    const now = new Date("2026-11-18T12:00:00Z");
    const day = (d: string) => Math.floor(Date.parse(d) / 1000);
    const { http } = fakeStripe({
      get: () => ({
        data: [
          { id: "in_1", status: "open", currency: "cad", amount_due: 24999, amount_paid: 0, amount_remaining: 24999, due_date: day("2026-11-01T00:00:00Z"), customer: "cus_1" },
          { id: "in_2", status: "open", currency: "cad", amount_due: 34900, amount_paid: 0, amount_remaining: 34900, due_date: day("2026-12-01T00:00:00Z"), customer: "cus_2" },
          { id: "in_3", status: "paid", currency: "cad", amount_due: 24999, amount_paid: 24999, amount_remaining: 0, customer: "cus_1" },
          { id: "in_4", status: "void", currency: "cad", amount_due: 5000, amount_paid: 0, amount_remaining: 5000, customer: "cus_1" },
        ],
      }),
    });
    const { rows } = await listStripeInvoices(http, {});
    assert.deepEqual(summarizeOutstanding(rows, now), [
      { currency: "CAD", outstandingCents: 59899, overdueCents: 24999, openInvoices: 2 },
    ]);
  });

  it("computes monthly recurring revenue from billing subscriptions only", async () => {
    const { http } = fakeStripe({
      get: () => ({
        data: [
          subscription(),
          subscription({ id: "sub_PRO99999" }, "price_pro", 34900),
          subscription({ id: "sub_GONE9999", status: "canceled" }),
          subscription({ id: "sub_TRIAL999", status: "incomplete" }),
        ],
      }),
    });
    const { rows } = await listStripeSubscriptions(http, false, {}, ENV);
    assert.deepEqual(monthlyRecurringCents(rows), [{ currency: "CAD", cents: 59899 }]);
  });
});

describe("changing a subscription", () => {
  const confirmPlan = SUBSCRIPTION_CONFIRM.change_plan;
  let synced: { subscriptionId: string; customerId: string; livemode: boolean }[];
  let recordedPlan: "essential" | "professional" | null;

  const deps = (
    stripe: ReturnType<typeof fakeStripe>,
    over: Partial<SubscriptionChangeDeps> = {},
  ): SubscriptionChangeDeps => ({
    http: stripe.http,
    livemode: false,
    env: ENV,
    now: () => new Date("2026-11-18T12:00:10Z"),
    organizationForCustomer: async (id) => (id === "cus_1" ? "org_1" : null),
    synchronize: async (s) => {
      synced.push(s);
      return { synchronized: true };
    },
    organizationPlan: async () => recordedPlan,
    ...over,
  });

  /** A Stripe holding one essential subscription that applies a plan change when told. */
  function stripeOn(initial = subscription()) {
    let current = initial as ReturnType<typeof subscription>;
    return fakeStripe({
      get: (path) => {
        if (path.startsWith("subscriptions/")) return current;
        if (path === "prices/price_pro") return price("price_pro", 34900);
        if (path === "prices/price_ess") return price("price_ess", 24999);
        throw new StripeHttpError(404, "resource_missing");
      },
      post: (path, form) => {
        if (form["items[0][price]"] === "price_pro") {
          current = { ...current, items: { data: [{ id: "si_1", price: price("price_pro", 34900) }] } };
        }
        if (form.cancel_at_period_end) {
          current = { ...current, cancel_at_period_end: form.cancel_at_period_end === "true" };
        }
        return current;
      },
    });
  }

  beforeEach(() => {
    synced = [];
    recordedPlan = "professional";
  });

  it("moves Essential to Professional on the existing subscription, with no proration and no new charge", async () => {
    const stripe = stripeOn();
    const result = await changeSubscription(
      { subscriptionId: "sub_ABC12345", action: "change_plan", targetPlan: "professional", confirm: confirmPlan },
      deps(stripe),
    );
    assert.ok(result.ok);
    assert.equal(result.before.plan, "essential");
    assert.equal(result.after.plan, "professional");
    assert.equal(result.organizationId, "org_1");
    assert.equal(result.synchronized, true);
    assert.equal(result.entitlementsUpdated, true);

    // Exactly one write, to the existing subscription, and nothing that could bill anyone.
    assert.equal(stripe.posts.length, 1);
    const [post] = stripe.posts;
    assert.equal(post.path, "subscriptions/sub_ABC12345");
    assert.equal(post.form["items[0][id]"], "si_1");
    assert.equal(post.form["items[0][price]"], "price_pro");
    assert.equal(post.form.proration_behavior, "none");
    assert.equal(post.form.payment_behavior, "error_if_incomplete");
    assert.ok(post.key.startsWith("tc-admin-plan:sub_ABC12345:"));
    for (const p of stripe.posts) {
      assert.doesNotMatch(p.path, /invoices|charges|payment_intents|checkout|customers|^subscriptions$/);
    }
    assert.deepEqual(synced, [{ subscriptionId: "sub_ABC12345", customerId: "cus_1", livemode: false }]);
  });

  it("reports when entitlements did not follow, so the administrator knows to resync", async () => {
    recordedPlan = "essential";
    const stripe = stripeOn();
    const result = await changeSubscription(
      { subscriptionId: "sub_ABC12345", action: "change_plan", targetPlan: "professional", confirm: confirmPlan },
      deps(stripe, { synchronize: async () => ({ synchronized: false }) }),
    );
    assert.ok(result.ok);
    assert.equal(result.synchronized, false);
    assert.equal(result.entitlementsUpdated, false);
  });

  it("still succeeds, flagged unsynchronized, when the database sync throws after Stripe changed", async () => {
    const stripe = stripeOn();
    const result = await changeSubscription(
      { subscriptionId: "sub_ABC12345", action: "change_plan", targetPlan: "professional", confirm: confirmPlan },
      deps(stripe, {
        synchronize: async () => {
          throw new Error("db down");
        },
      }),
    );
    assert.ok(result.ok);
    assert.equal(result.synchronized, false);
    assert.equal(stripe.posts.length, 1);
  });

  it("makes a double click one Stripe update: same idempotency key, and the second is refused as already done", async () => {
    const stripe = stripeOn();
    const input = {
      subscriptionId: "sub_ABC12345",
      action: "change_plan" as const,
      targetPlan: "professional" as const,
      confirm: confirmPlan,
    };
    const first = await changeSubscription(input, deps(stripe));
    const second = await changeSubscription(input, deps(stripe));
    assert.ok(first.ok);
    assert.deepEqual(second, { ok: false, error: "same_plan" });
    assert.equal(stripe.posts.length, 1);

    // Two clicks racing before either is read back carry the same key, so Stripe collapses them.
    const racing = fakeStripe({
      get: (path) => (path.startsWith("subscriptions/") ? subscription() : price("price_pro", 34900)),
      post: () => subscription({}, "price_pro", 34900),
    });
    await Promise.all([changeSubscription(input, deps(racing)), changeSubscription(input, deps(racing))]);
    assert.equal(racing.posts.length, 2);
    assert.equal(racing.posts[0].key, racing.posts[1].key);
  });

  it("changes nothing without the confirmation word, and does not even call Stripe", async () => {
    const stripe = stripeOn();
    for (const confirm of ["", "yes", "CHANGE", "change  plan"]) {
      const result = await changeSubscription(
        { subscriptionId: "sub_ABC12345", action: "change_plan", targetPlan: "professional", confirm },
        deps(stripe),
      );
      assert.deepEqual(result, { ok: false, error: "confirm" }, confirm);
    }
    assert.equal(stripe.gets.length + stripe.posts.length, 0);
  });

  it("is case-insensitive about the confirmation word", async () => {
    const stripe = stripeOn();
    const result = await changeSubscription(
      { subscriptionId: "sub_ABC12345", action: "change_plan", targetPlan: "professional", confirm: "  Change Plan " },
      deps(stripe),
    );
    assert.ok(result.ok);
  });

  it("refuses an id that is not a subscription id before any call", async () => {
    const stripe = stripeOn();
    for (const id of ["", "cus_1", "sub_", "sub_../customers", "sub_a b", "../subscriptions"]) {
      const result = await changeSubscription(
        { subscriptionId: id, action: "cancel_at_period_end", confirm: "cancel" },
        deps(stripe),
      );
      assert.deepEqual(result, { ok: false, error: "invalid_id" }, id);
    }
    assert.equal(stripe.gets.length + stripe.posts.length, 0);
  });

  it("will not touch a subscription that does not belong to a TradeCatch business", async () => {
    const stripe = stripeOn(subscription({ customer: { id: "cus_stranger", metadata: {} } }));
    const result = await changeSubscription(
      { subscriptionId: "sub_ABC12345", action: "cancel_at_period_end", confirm: "cancel" },
      deps(stripe),
    );
    assert.deepEqual(result, { ok: false, error: "not_managed" });
    assert.equal(stripe.posts.length, 0);
  });

  it("only changes subscriptions that are active or trialing", async () => {
    for (const status of ["past_due", "canceled", "incomplete", "unpaid", "paused"]) {
      const stripe = stripeOn(subscription({ status }));
      const result = await changeSubscription(
        { subscriptionId: "sub_ABC12345", action: "change_plan", targetPlan: "professional", confirm: confirmPlan },
        deps(stripe),
      );
      assert.deepEqual(result, { ok: false, error: "invalid_state" }, status);
      assert.equal(stripe.posts.length, 0, status);
    }
  });

  it("refuses a subscription with several items or in the other Stripe mode", async () => {
    const two = subscription();
    two.items.data.push({ id: "si_2", price: price("price_extra", 1000) });
    const multi = stripeOn(two);
    assert.deepEqual(
      await changeSubscription(
        { subscriptionId: "sub_ABC12345", action: "change_plan", targetPlan: "professional", confirm: confirmPlan },
        deps(multi),
      ),
      { ok: false, error: "invalid_state" },
    );
    const wrongMode = stripeOn(subscription({ livemode: true }));
    assert.deepEqual(
      await changeSubscription(
        { subscriptionId: "sub_ABC12345", action: "cancel_at_period_end", confirm: "cancel" },
        deps(wrongMode),
      ),
      { ok: false, error: "invalid_state" },
    );
    assert.equal(multi.posts.length + wrongMode.posts.length, 0);
  });

  it("refuses a change to the plan it is already on, and a plan with no usable monthly price", async () => {
    const same = stripeOn();
    assert.deepEqual(
      await changeSubscription(
        { subscriptionId: "sub_ABC12345", action: "change_plan", targetPlan: "essential", confirm: confirmPlan },
        deps(same),
      ),
      { ok: false, error: "same_plan" },
    );

    for (const bad of [
      price("price_pro", 34900, { active: false }),
      price("price_pro", 34900, { recurring: { interval: "year" } }),
      price("price_pro", 34900, { currency: "usd" }),
      price("price_pro", 34900, { type: "one_time", recurring: null }),
    ]) {
      const stripe = fakeStripe({
        get: (path) => (path.startsWith("subscriptions/") ? subscription() : bad),
        post: () => subscription(),
      });
      assert.deepEqual(
        await changeSubscription(
          { subscriptionId: "sub_ABC12345", action: "change_plan", targetPlan: "professional", confirm: confirmPlan },
          deps(stripe),
        ),
        { ok: false, error: "price_invalid" },
      );
      assert.equal(stripe.posts.length, 0);
    }

    const noPrice = stripeOn();
    assert.deepEqual(
      await changeSubscription(
        { subscriptionId: "sub_ABC12345", action: "change_plan", targetPlan: "professional", confirm: confirmPlan },
        deps(noPrice, { env: {} }),
      ),
      { ok: false, error: "price_not_configured" },
    );
  });

  it("cancels at the end of the period, and resumes", async () => {
    const stripe = stripeOn();
    const cancel = await changeSubscription(
      { subscriptionId: "sub_ABC12345", action: "cancel_at_period_end", confirm: "cancel" },
      deps(stripe),
    );
    assert.ok(cancel.ok);
    assert.equal(cancel.after.cancelAtPeriodEnd, true);
    assert.deepEqual(stripe.posts[0].form, { cancel_at_period_end: "true" });

    const again = await changeSubscription(
      { subscriptionId: "sub_ABC12345", action: "cancel_at_period_end", confirm: "cancel" },
      deps(stripe),
    );
    assert.deepEqual(again, { ok: false, error: "nothing_to_change" });

    const resume = await changeSubscription(
      { subscriptionId: "sub_ABC12345", action: "resume", confirm: "resume" },
      deps(stripe),
    );
    assert.ok(resume.ok);
    assert.equal(resume.after.cancelAtPeriodEnd, false);

    const notCancelling = await changeSubscription(
      { subscriptionId: "sub_ABC12345", action: "resume", confirm: "resume" },
      deps(stripe),
    );
    assert.deepEqual(notCancelling, { ok: false, error: "nothing_to_change" });
  });

  it("maps Stripe failures to refused (4xx) or unavailable (5xx / network), changing nothing", async () => {
    const refused = fakeStripe({
      get: (path) => (path.startsWith("subscriptions/") ? subscription() : price("price_pro", 34900)),
      post: () => {
        throw new StripeHttpError(402, "card_declined");
      },
    });
    assert.deepEqual(
      await changeSubscription(
        { subscriptionId: "sub_ABC12345", action: "change_plan", targetPlan: "professional", confirm: confirmPlan },
        deps(refused),
      ),
      { ok: false, error: "rejected" },
    );
    const down = fakeStripe({
      get: (path) => (path.startsWith("subscriptions/") ? subscription() : price("price_pro", 34900)),
      post: () => {
        throw new StripeHttpError(503, null);
      },
    });
    assert.deepEqual(
      await changeSubscription(
        { subscriptionId: "sub_ABC12345", action: "change_plan", targetPlan: "professional", confirm: confirmPlan },
        deps(down),
      ),
      { ok: false, error: "unavailable" },
    );
    const unreachable = fakeStripe({
      get: () => {
        throw new Error("network");
      },
    });
    assert.deepEqual(
      await changeSubscription(
        { subscriptionId: "sub_ABC12345", action: "cancel_at_period_end", confirm: "cancel" },
        deps(unreachable),
      ),
      { ok: false, error: "unavailable" },
    );
    const missing = fakeStripe({
      get: () => {
        throw new StripeHttpError(404, "resource_missing");
      },
    });
    assert.deepEqual(
      await changeSubscription(
        { subscriptionId: "sub_ABC12345", action: "cancel_at_period_end", confirm: "cancel" },
        deps(missing),
      ),
      { ok: false, error: "not_found" },
    );
  });
});

describe("payment outcomes from webhooks", () => {
  const failed = {
    id: "evt_failed_1",
    type: "invoice.payment_failed",
    livemode: false,
    data: {
      object: {
        id: "in_9",
        customer: "cus_1",
        parent: { subscription_details: { subscription: "sub_ABC12345" } },
        amount_due: 24999,
        currency: "cad",
        attempt_count: 2,
        next_payment_attempt: 1_790_100_000,
        // Things that must never be kept.
        payment_method_details: { card: { last4: "4242", brand: "visa" } },
        customer_email: "owner@acme.ca",
      },
    },
  };

  it("extracts what an administrator needs and nothing else", () => {
    const row = billingEventFromWebhook(failed);
    assert.deepEqual(row, {
      eventId: "evt_failed_1",
      eventType: "invoice.payment_failed",
      livemode: false,
      customerId: "cus_1",
      subscriptionId: "sub_ABC12345",
      invoiceId: "in_9",
      amountCents: 24999,
      currency: "CAD",
      attemptCount: 2,
      nextAttemptAt: new Date(1_790_100_000 * 1000).toISOString(),
      outcome: "failed",
    });
    assert.doesNotMatch(JSON.stringify(row), /4242|visa|owner@acme\.ca/);
  });

  it("classifies the invoice events and ignores everything else", () => {
    const outcome = (type: string) =>
      billingEventFromWebhook({ ...failed, type, data: { object: { id: "in_1", customer: "cus_1", amount_paid: 100 } } })?.outcome;
    assert.equal(outcome("invoice.payment_failed"), "failed");
    assert.equal(outcome("invoice.payment_action_required"), "action_required");
    assert.equal(outcome("invoice.paid"), "succeeded");
    assert.equal(outcome("invoice.payment_succeeded"), "succeeded");
    assert.equal(outcome("customer.subscription.updated"), undefined);
    assert.equal(billingEventFromWebhook(null), null);
    assert.equal(billingEventFromWebhook({ id: "x" }), null);
    assert.equal(billingEventFromWebhook({ ...failed, livemode: "yes" }), null);
  });

  describe("recording (in memory, no database)", () => {
    beforeEach(() => resetBillingEventsForTests());

    it("keeps one record per Stripe event, however often it is redelivered", async () => {
      const row = billingEventFromWebhook(failed)!;
      assert.deepEqual(await recordBillingEvent(row, null), { recorded: true });
      assert.deepEqual(await recordBillingEvent(row, null), { recorded: false });
      assert.equal((await listBillingEvents({}, null)).total, 1);
    });

    it("filters by outcome and date and counts recent failures", async () => {
      const now = new Date("2026-11-18T12:00:00Z");
      await recordBillingEvent(billingEventFromWebhook(failed)!, null, new Date("2026-11-17T09:00:00Z"));
      await recordBillingEvent(
        billingEventFromWebhook({ ...failed, id: "evt_old", data: { object: { ...failed.data.object, id: "in_old" } } })!,
        null,
        new Date("2026-09-01T09:00:00Z"),
      );
      await recordBillingEvent(
        billingEventFromWebhook({ id: "evt_ok", type: "invoice.paid", livemode: false, data: { object: { id: "in_ok", customer: "cus_1", amount_paid: 100 } } })!,
        null,
        now,
      );
      assert.equal((await listBillingEvents({ outcome: "failed" }, null)).total, 2);
      assert.equal((await listBillingEvents({ outcome: "succeeded" }, null)).total, 1);
      assert.equal((await listBillingEvents({ from: "2026-11-01" }, null)).total, 2);
      assert.equal((await listBillingEvents({ outcome: "failed", from: "2026-09-01", to: "2026-09-30" }, null)).total, 1);
      assert.equal(await countRecentFailedPayments(30, null, now), 1);
    });
  });
});

describe("payment outcomes in PostgreSQL", { skip: !pgliteAvailable }, () => {
  let db: Db;
  let pg: AdminDb;
  before(async () => {
    db = await openAdminConsoleDb();
    pg = poolOf(db);
    await db.exec(`
      CREATE TABLE tc_stripe_customers (organization_id TEXT PRIMARY KEY, customer_id TEXT UNIQUE NOT NULL, livemode BOOLEAN NOT NULL, synced_at TIMESTAMPTZ NOT NULL DEFAULT now());
      INSERT INTO tc_organizations (id, name, slug) VALUES ('org_1', 'Acme', 'acme'), ('org_2', 'Beta', 'beta');
      INSERT INTO tc_stripe_customers (organization_id, customer_id, livemode) VALUES ('org_1', 'cus_1', false), ('org_2', 'cus_2', false);
    `);
  });
  after(async () => {
    await db?.close();
  });

  const event = (id: string, customer: string, type = "invoice.payment_failed") =>
    billingEventFromWebhook({
      id,
      type,
      livemode: false,
      data: { object: { id: `in_${id}`, customer, amount_due: 24999, amount_paid: 24999, currency: "cad", attempt_count: 1 } },
    })!;

  it("records once per event, attributes it to the owning business, and filters by business", async () => {
    assert.deepEqual(await recordBillingEvent(event("evt_a", "cus_1"), pg), { recorded: true });
    assert.deepEqual(await recordBillingEvent(event("evt_a", "cus_1"), pg), { recorded: false });
    await recordBillingEvent(event("evt_b", "cus_2"), pg);
    await recordBillingEvent(event("evt_c", "cus_unknown"), pg);

    const all = await listBillingEvents({}, pg);
    assert.equal(all.total, 3);
    const mine = await listBillingEvents({ organizationId: "org_1" }, pg);
    assert.deepEqual(mine.rows.map((r) => r.eventId), ["evt_a"]);
    assert.equal(all.rows.find((r) => r.eventId === "evt_c")?.organizationId, null);
  });

  it("pages and filters in SQL", async () => {
    await recordBillingEvent(event("evt_d", "cus_1", "invoice.paid"), pg);
    const failedOnly = await listBillingEvents({ outcome: "failed" }, pg);
    assert.ok(failedOnly.rows.every((r) => r.outcome === "failed"));
    const page1 = await listBillingEvents({ limit: 2, offset: 0 }, pg);
    const page2 = await listBillingEvents({ limit: 2, offset: 2 }, pg);
    assert.equal(page1.rows.length, 2);
    assert.ok(page2.rows.length >= 1);
    assert.equal(new Set([...page1.rows, ...page2.rows].map((r) => r.eventId)).size, page1.rows.length + page2.rows.length);
    assert.equal(await countRecentFailedPayments(30, pg), 3);
  });

  it("looks up the owning business for several Stripe customers at once, ignoring bad ids", async () => {
    const map = await organizationsByCustomers(["cus_1", "cus_2", "cus_none", "x'; DROP TABLE tc_stripe_customers;--"], pg);
    assert.deepEqual([...map].sort(), [["cus_1", "org_1"], ["cus_2", "org_2"]]);
    // The table is still there.
    assert.equal((await db.query("SELECT count(*)::int AS n FROM tc_stripe_customers")).rows[0].n, 2);
  });
});

describe("subscriptions joined to businesses", () => {
  it("flags where Stripe and the recorded state disagree", () => {
    const recorded = {
      subscriptionId: "sub_1", organizationId: "org_1", customerId: "cus_1", livemode: false,
      status: "active", plan: "essential", cancelAtPeriodEnd: false, currentPeriodEnd: null,
      latestInvoiceId: null, syncedAt: "2026-11-01T00:00:00.000Z",
    };
    assert.deepEqual(driftOf({ status: "active", plan: "essential", cancelAtPeriodEnd: false }, recorded), []);
    assert.deepEqual(driftOf({ status: "past_due", plan: "essential", cancelAtPeriodEnd: false }, recorded), ["status"]);
    assert.deepEqual(
      driftOf({ status: "active", plan: "professional", cancelAtPeriodEnd: true }, recorded),
      ["plan", "cancellation"],
    );
    assert.deepEqual(driftOf({ status: "active", plan: "essential", cancelAtPeriodEnd: false }, undefined), ["not_recorded"]);
  });

  it("falls back to the recorded subscriptions, and says so, when Stripe is not configured", async () => {
    const store = createMemorySaasStore();
    const { organization } = await store.createOrganizationWithOwner({
      name: "Acme Plumbing", ownerEmail: "o@acme.ca", ownerName: "O", locale: "en", plan: "essential",
    });
    const result = await loadSubscriptions({
      stripe: { configured: false, reason: "No Stripe API key is configured on this server." },
      rows: [
        {
          subscriptionId: "sub_1", organizationId: organization.id, customerId: "cus_1", livemode: false,
          status: "past_due", plan: "essential", cancelAtPeriodEnd: false, currentPeriodEnd: null,
          latestInvoiceId: null, syncedAt: "2026-11-01T00:00:00.000Z",
        },
      ],
      store,
      status: "past_due",
    });
    assert.equal(result.source, "database");
    assert.equal(result.stripe.configured, false);
    assert.match(result.note ?? "", /not configured/);
    assert.equal(result.subscriptions[0].organization?.name, "Acme Plumbing");
    assert.equal(result.subscriptions[0].unitAmountCents, null);

    const none = await loadSubscriptions({
      stripe: { configured: false, reason: "x" }, rows: [], store, status: "active",
    });
    assert.deepEqual(none.subscriptions, []);
  });

  it("with Stripe, joins each subscription to its business and shows test mode plainly", async () => {
    const store = createMemorySaasStore();
    const { organization } = await store.createOrganizationWithOwner({
      name: "Acme Plumbing", ownerEmail: "o@acme.ca", ownerName: "O", locale: "en", plan: "essential",
    });
    const stripe = fakeStripe({
      get: (path) => {
        if (path.startsWith("prices/")) return price(path.slice(7), path.endsWith("ess") ? 24999 : 34900);
        return { data: [subscription({ id: "sub_ABC12345" })] };
      },
    });
    const result = await loadSubscriptions({
      stripe: { configured: true, livemode: false, http: stripe.http },
      rows: [
        {
          subscriptionId: "sub_ABC12345", organizationId: organization.id, customerId: "cus_1", livemode: false,
          status: "active", plan: "essential", cancelAtPeriodEnd: false, currentPeriodEnd: null,
          latestInvoiceId: null, syncedAt: "2026-11-01T00:00:00.000Z",
        },
      ],
      store,
      env: ENV,
    });
    assert.equal(result.source, "stripe");
    assert.equal(result.prices.length, 2);
    assert.equal(result.subscriptions[0].organization?.id, organization.id);
    assert.deepEqual(result.subscriptions[0].drift, []);
    assert.match(result.note ?? "", /TEST mode/);
  });

  it("shows invoices with the business, and nothing when Stripe is not configured", async () => {
    const store = createMemorySaasStore();
    const none = await loadInvoices({ stripe: { configured: false, reason: "x" }, store });
    assert.deepEqual(none.invoices, []);
    assert.match(none.note ?? "", /not configured/);

    const stripe = fakeStripe({
      get: () => ({
        data: [
          { id: "in_1", status: "open", currency: "cad", amount_due: 24999, amount_paid: 0, amount_remaining: 24999, customer: "cus_1", customer_email: "o@acme.ca" },
        ],
      }),
    });
    const result = await loadInvoices({
      stripe: { configured: true, livemode: true, http: stripe.http },
      store,
      status: "open",
    });
    assert.equal(result.invoices[0].amountRemainingCents, 24999);
    assert.deepEqual(result.outstanding, [{ currency: "CAD", outstandingCents: 24999, overdueCents: 0, openInvoices: 1 }]);
    assert.equal(result.note, null);
  });
});
