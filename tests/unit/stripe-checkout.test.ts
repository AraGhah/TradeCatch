import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { Pool } from "pg";
import {
  CheckoutError,
  createInstallationCheckoutSession,
  synchronizeInstallationCheckout,
  checkoutSessionEventSchema,
  oneCalendarMonthLater,
} from "../../src/product/saas/stripe-checkout";

const names = [
  "DATABASE_URL",
  "SAAS_DURABLE_STORE",
  "MISSED_CALL_DURABLE_STORE",
  "STRIPE_TEST_SECRET_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_TEST_PRICE_INSTALL_STARTER",
  "STRIPE_TEST_PRICE_STARTER",
  "NEXT_PUBLIC_SITE_URL",
];
const saved = new Map(names.map((name) => [name, process.env[name]]));

type Checkout = {
  id: string;
  organization_id: string;
  plan: string;
  checkout_session_id: string | null;
  livemode: boolean;
  status: string;
  billing_start_at: string | null;
  created_at: Date;
};

let checkouts: Checkout[];
let activeSubscription: boolean;
let existingCustomerId: string | undefined;
let stripeEvents: Set<string>;
let customers: { organization_id: string; customer_id: string; livemode: boolean }[];
let deferral: { billing_start_at: string } | undefined;
let requests: { path: string; method: string; body?: string }[];
let subscriptionAlreadyExists: boolean;
let fetchOverride: ((path: string) => Response | null) | null;

function handleQuery(sql: string, values: unknown[] = []): { rows: unknown[]; rowCount: number } {
  if (sql.startsWith("INSERT INTO tc_installation_checkouts")) {
    const [id, organizationId, plan, livemode] = values as [string, string, string, boolean];
    if (checkouts.some((c) => c.organization_id === organizationId && c.status === "pending")) {
      return { rows: [], rowCount: 0 };
    }
    checkouts.push({
      id,
      organization_id: organizationId,
      plan,
      livemode,
      checkout_session_id: null,
      status: "pending",
      billing_start_at: null,
      created_at: new Date(),
    });
    return { rows: [{ id }], rowCount: 1 };
  }
  if (sql.includes("WHERE organization_id=$1 AND status='pending' AND created_at")) {
    const [organizationId] = values as [string];
    const stale = checkouts.filter(
      (c) =>
        c.organization_id === organizationId &&
        c.status === "pending" &&
        Date.now() - c.created_at.getTime() > 24 * 60 * 60 * 1000,
    );
    stale.forEach((c) => (c.status = "canceled"));
    return { rows: [], rowCount: stale.length };
  }
  if (sql.includes("SELECT status FROM tc_stripe_subscriptions")) {
    return { rows: activeSubscription ? [{ status: "active" }] : [], rowCount: activeSubscription ? 1 : 0 };
  }
  if (sql.includes("SELECT customer_id FROM tc_stripe_customers")) {
    return existingCustomerId
      ? { rows: [{ customer_id: existingCustomerId }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }
  if (sql.startsWith("UPDATE tc_installation_checkouts SET checkout_session_id=")) {
    const [id, sessionId] = values as [string, string];
    const row = checkouts.find((c) => c.id === id);
    if (row) row.checkout_session_id = sessionId;
    return { rows: [], rowCount: row ? 1 : 0 };
  }
  if (sql.includes("SET status='failed'")) {
    const [id] = values as [string];
    const row = checkouts.find((c) => c.id === id && c.status === "pending");
    if (row) row.status = "failed";
    return { rows: [], rowCount: row ? 1 : 0 };
  }
  if (sql.startsWith("INSERT INTO tc_stripe_events")) {
    const [eventId] = values as [string];
    if (stripeEvents.has(eventId)) return { rows: [], rowCount: 0 };
    stripeEvents.add(eventId);
    return { rows: [{ event_id: eventId }], rowCount: 1 };
  }
  if (sql.includes("FROM tc_installation_checkouts WHERE checkout_session_id=")) {
    const [sessionId] = values as [string];
    const row = checkouts.find((c) => c.checkout_session_id === sessionId);
    return row
      ? {
          rows: [
            {
              id: row.id,
              organization_id: row.organization_id,
              plan: row.plan,
              livemode: row.livemode,
              status: row.status,
            },
          ],
          rowCount: 1,
        }
      : { rows: [], rowCount: 0 };
  }
  if (sql.includes("SET status='canceled', updated_at=now() WHERE id=")) {
    const [id] = values as [string];
    const row = checkouts.find((c) => c.id === id);
    if (row) row.status = "canceled";
    return { rows: [], rowCount: 1 };
  }
  if (sql.startsWith("INSERT INTO tc_stripe_customers")) {
    const [organizationId, customerId, livemode] = values as [string, string, boolean];
    const existing = customers.find((c) => c.organization_id === organizationId);
    if (existing) {
      if (existing.customer_id !== customerId || existing.livemode !== livemode) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ organization_id: organizationId }], rowCount: 1 };
    }
    customers.push({ organization_id: organizationId, customer_id: customerId, livemode });
    return { rows: [{ organization_id: organizationId }], rowCount: 1 };
  }
  if (sql.includes("FROM tc_billing_deferrals")) {
    return deferral ? { rows: [deferral], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (sql.includes("SET status='subscribed', billing_start_at=")) {
    const [id, billingStartAt] = values as [string, string];
    const row = checkouts.find((c) => c.id === id);
    if (row) {
      row.status = "subscribed";
      row.billing_start_at = billingStartAt;
    }
    return { rows: [], rowCount: 1 };
  }
  if (sql.includes("SET status='subscribed', updated_at=now() WHERE id=")) {
    const [id] = values as [string];
    const row = checkouts.find((c) => c.id === id);
    if (row) row.status = "subscribed";
    return { rows: [], rowCount: 1 };
  }
  if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" || sql.startsWith("SET LOCAL")) {
    return { rows: [], rowCount: 0 };
  }
  throw new Error("Unhandled SQL in test mock: " + sql);
}

beforeEach(() => {
  names.forEach((name) => delete process.env[name]);
  Object.assign(process.env, {
    DATABASE_URL: "postgresql://postgres:checkout-test-only@127.0.0.1:1/tc_checkout_unit",
    SAAS_DURABLE_STORE: "1",
    STRIPE_TEST_SECRET_KEY: "sk_test_fixture",
    STRIPE_TEST_PRICE_INSTALL_STARTER: "price_install_starter",
    STRIPE_TEST_PRICE_STARTER: "price_starter_recurring",
    NEXT_PUBLIC_SITE_URL: "https://tradecatch.test",
  });
  checkouts = [];
  activeSubscription = false;
  existingCustomerId = undefined;
  stripeEvents = new Set();
  customers = [];
  deferral = undefined;
  requests = [];
  subscriptionAlreadyExists = false;
  fetchOverride = null;
  mock.method(Pool.prototype, "query", async (sql: string, values?: unknown[]) =>
    handleQuery(sql, values ?? []),
  );
  mock.method(Pool.prototype, "connect", async () => ({
    query: async (sql: string, values?: unknown[]) => handleQuery(sql, values ?? []),
    release: () => {},
  }));
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname.replace(/^\/v1\//, "");
      requests.push({ path, method: init?.method || "GET", body: init?.body ? String(init.body) : undefined });
      const override = fetchOverride?.(path);
      if (override) return override;
      if (path === "checkout/sessions") {
        return Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1", livemode: false });
      }
      if (path.startsWith("payment_intents/")) {
        return Response.json({ id: "pi_test", payment_method: "pm_test" });
      }
      if (path === "subscriptions" && (init?.method || "GET") === "GET") {
        return Response.json({ data: subscriptionAlreadyExists ? [{ id: "sub_existing", status: "active" }] : [] });
      }
      if (path.startsWith("customers/")) {
        return Response.json({ id: "cus_test" });
      }
      if (path === "subscriptions") {
        return Response.json({ id: "sub_new", status: "trialing" });
      }
      return Response.json({}, { status: 404 });
    },
  );
});
afterEach(() => {
  mock.restoreAll();
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function checkoutEvent(overrides: Record<string, unknown> = {}) {
  return checkoutSessionEventSchema.parse({
    id: "evt_checkout_1",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_test_1",
        payment_status: "paid",
        customer: "cus_test",
        payment_intent: "pi_test",
        metadata: { organization_id: "org_1", plan: "starter", flow: "installation" },
        ...overrides,
      },
    },
  });
}

describe("createInstallationCheckoutSession", () => {
  it("starts a one-time installation checkout and records it as pending", async () => {
    const url = await createInstallationCheckoutSession({
      id: "org_1",
      plan: "starter",
      accountType: "demo",
    });
    assert.equal(url, "https://checkout.stripe.com/c/pay/cs_test_1");
    assert.equal(checkouts.length, 1);
    assert.equal(checkouts[0].status, "pending");
    assert.equal(checkouts[0].checkout_session_id, "cs_test_1");
    const call = requests.find((r) => r.path === "checkout/sessions");
    const body = new URLSearchParams(call!.body);
    assert.equal(body.get("mode"), "payment");
    assert.equal(body.get("line_items[0][price]"), "price_install_starter");
    assert.equal(body.get("payment_intent_data[setup_future_usage]"), "off_session");
    assert.equal(body.get("customer_creation"), "always");
  });

  it("reuses an existing Stripe customer instead of creating a new one", async () => {
    existingCustomerId = "cus_existing";
    await createInstallationCheckoutSession({ id: "org_1", plan: "starter", accountType: "demo" });
    const call = requests.find((r) => r.path === "checkout/sessions");
    const body = new URLSearchParams(call!.body);
    assert.equal(body.get("customer"), "cus_existing");
    assert.equal(body.get("customer_creation"), null);
  });

  it("refuses a second checkout while one is already pending", async () => {
    await createInstallationCheckoutSession({ id: "org_1", plan: "starter", accountType: "demo" });
    await assert.rejects(
      () => createInstallationCheckoutSession({ id: "org_1", plan: "starter", accountType: "demo" }),
      (err: unknown) => err instanceof CheckoutError && err.code === "already_pending",
    );
  });

  it("releases a checkout abandoned more than 24h ago and allows a retry", async () => {
    await createInstallationCheckoutSession({ id: "org_1", plan: "starter", accountType: "demo" });
    checkouts[0].created_at = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const url = await createInstallationCheckoutSession({ id: "org_1", plan: "starter", accountType: "demo" });
    assert.equal(url, "https://checkout.stripe.com/c/pay/cs_test_1");
    assert.equal(checkouts.filter((c) => c.status === "pending").length, 1);
    assert.equal(checkouts.filter((c) => c.status === "canceled").length, 1);
  });

  it("refuses to start installation billing for an organization with an active subscription", async () => {
    activeSubscription = true;
    await assert.rejects(
      () => createInstallationCheckoutSession({ id: "org_1", plan: "starter", accountType: "demo" }),
      (err: unknown) => err instanceof CheckoutError && err.code === "already_subscribed",
    );
  });

  it("refuses when the installation price is not configured", async () => {
    delete process.env.STRIPE_TEST_PRICE_INSTALL_STARTER;
    await assert.rejects(
      () => createInstallationCheckoutSession({ id: "org_1", plan: "starter", accountType: "demo" }),
      (err: unknown) => err instanceof CheckoutError && err.code === "misconfigured",
    );
    assert.equal(checkouts[0]?.status, "failed");
  });
});

describe("synchronizeInstallationCheckout", () => {
  beforeEach(async () => {
    await createInstallationCheckoutSession({ id: "org_1", plan: "starter", accountType: "demo" });
    requests = [];
  });

  it("saves the card, creates the deferred subscription, and marks the checkout subscribed", async () => {
    const before = Date.now();
    const result = await synchronizeInstallationCheckout(checkoutEvent());
    assert.deepEqual(result, { handled: true });
    assert.equal(checkouts[0].status, "subscribed");
    assert.ok(checkouts[0].billing_start_at);
    const expectedAnchor = oneCalendarMonthLater(new Date(before)).getTime();
    assert.ok(Math.abs(Date.parse(checkouts[0].billing_start_at!) - expectedAnchor) < 5000);

    const customerUpdate = requests.find((r) => r.path === "customers/cus_test");
    assert.ok(customerUpdate);
    assert.equal(
      new URLSearchParams(customerUpdate!.body).get("invoice_settings[default_payment_method]"),
      "pm_test",
    );

    const subCreate = requests.find((r) => r.path === "subscriptions" && r.method === "POST");
    assert.ok(subCreate);
    const body = new URLSearchParams(subCreate!.body);
    assert.equal(body.get("customer"), "cus_test");
    assert.equal(body.get("items[0][price]"), "price_starter_recurring");
    assert.equal(body.get("default_payment_method"), "pm_test");
    assert.ok(Number(body.get("trial_end")) > Date.now() / 1000);

    assert.deepEqual(customers, [{ organization_id: "org_1", customer_id: "cus_test", livemode: false }]);
  });

  it("uses an administrator-set billing deferral instead of the one-month default", async () => {
    const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    deferral = { billing_start_at: future };
    await synchronizeInstallationCheckout(checkoutEvent());
    assert.equal(checkouts[0].billing_start_at, future);
    const subCreate = requests.find((r) => r.path === "subscriptions" && r.method === "POST");
    const body = new URLSearchParams(subCreate!.body);
    assert.equal(body.get("trial_end"), String(Math.floor(Date.parse(future) / 1000)));
  });

  it("does not create a second subscription on a duplicate webhook delivery", async () => {
    await synchronizeInstallationCheckout(checkoutEvent());
    const firstSubCalls = requests.filter((r) => r.path === "subscriptions" && r.method === "POST").length;
    requests = [];
    const second = await synchronizeInstallationCheckout(checkoutEvent());
    assert.deepEqual(second, { handled: false });
    assert.equal(firstSubCalls, 1);
    assert.equal(requests.filter((r) => r.path === "subscriptions" && r.method === "POST").length, 0);
  });

  it("skips creating a subscription when one already exists for the customer", async () => {
    subscriptionAlreadyExists = true;
    await synchronizeInstallationCheckout(checkoutEvent());
    assert.equal(checkouts[0].status, "subscribed");
    assert.equal(requests.filter((r) => r.path === "subscriptions" && r.method === "POST").length, 0);
  });

  it("cancels the checkout record when the session reports an unpaid status", async () => {
    await synchronizeInstallationCheckout(checkoutEvent({ payment_status: "unpaid" }));
    assert.equal(checkouts[0].status, "canceled");
    assert.equal(requests.filter((r) => r.path.startsWith("payment_intents")).length, 0);
  });

  it("acknowledges a checkout session it never created, without throwing", async () => {
    const result = await synchronizeInstallationCheckout(
      checkoutSessionEventSchema.parse({
        id: "evt_unrelated",
        type: "checkout.session.completed",
        livemode: false,
        data: { object: { id: "cs_unrelated", payment_status: "paid", customer: "cus_other" } },
      }),
    );
    assert.deepEqual(result, { handled: false });
  });
});
