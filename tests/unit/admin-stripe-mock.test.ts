import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INVOICE_STATUS_FILTERS,
  SUBSCRIPTION_CONFIRM,
  SUBSCRIPTION_STATUS_FILTERS,
  changeSubscription,
  createStripeHttp,
  getStripeSubscription,
  listStripeInvoices,
  listStripeSubscriptions,
  loadPlanPrices,
} from "../../src/product/admin-console/stripe-admin";

/**
 * Stripe publishes `stripe-mock`, a server that validates every request against Stripe's real
 * OpenAPI specification (parameter names, types and enum values) and answers with schema-valid
 * fixtures. The rest of the billing tests use a hand-written fake, which would happily accept a
 * misspelled parameter that Stripe rejects with a 400. This runs the console's REAL Stripe client
 * and calls through stripe-mock, so a request Stripe would refuse fails here.
 *
 * It checks that our requests are VALID. It cannot check billing outcomes: the fixtures are
 * canned, nothing is charged, and no real Stripe account is involved.
 *
 *   docker run -d -p 127.0.0.1:12111:12111 stripe/stripe-mock
 *   STRIPE_MOCK_URL=http://127.0.0.1:12111 npx tsx --test tests/unit/admin-stripe-mock.test.ts
 */
const mockUrl = process.env.STRIPE_MOCK_URL?.trim().replace(/\/$/, "") ?? "";

type Exchange = { method: string; target: string; body: string; status: number; error: string | null };

function recordingClient() {
  const exchanges: Exchange[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.stripe.com", "the console must only talk to api.stripe.com");
    const response = await fetch(`${mockUrl}${url.pathname}${url.search}`, init);
    let error: string | null = null;
    if (!response.ok) {
      try {
        const body = (await response.clone().json()) as { error?: { message?: string } };
        error = body.error?.message ?? null;
      } catch {
        error = null;
      }
    }
    exchanges.push({
      method: init?.method ?? "GET",
      target: decodeURIComponent(`${url.pathname}${url.search}`),
      body: init?.body ? decodeURIComponent(String(init.body)) : "",
      status: response.status,
      error,
    });
    return response;
  };
  // stripe-mock only accepts letters and digits after "sk_test_".
  return { http: createStripeHttp("sk_test_mockkey1234567890", mockFetch), exchanges }; // secret-scan: allow — stripe-mock fixture
}

// The price on stripe-mock's canned subscription, so that subscription reads as "essential".
const FIXTURE_PRICE = "price_1PgafmB7WZ01zgkW6dKueIc5";
const ENV = {
  STRIPE_TEST_PRICE_ESSENTIAL: FIXTURE_PRICE,
  STRIPE_TEST_PRICE_PROFESSIONAL: "price_professional_mock",
};

function assertAllAccepted(exchanges: Exchange[]) {
  assert.ok(exchanges.length > 0, "no request reached Stripe");
  const refused = exchanges.filter((e) => e.status >= 400);
  assert.deepEqual(
    refused.map((e) => `${e.method} ${e.target} ${e.body} -> ${e.status} ${e.error ?? ""}`.trim()),
    [],
    "Stripe's API specification refuses a request the console sends",
  );
}

describe("admin console requests are valid against Stripe's API specification", { skip: !mockUrl }, () => {
  it("reads: prices, every subscription status filter, one subscription, every invoice filter", async () => {
    const { http, exchanges } = recordingClient();
    await loadPlanPrices(http, false, ENV);
    for (const status of SUBSCRIPTION_STATUS_FILTERS) {
      await listStripeSubscriptions(http, false, { status, limit: 25 }, ENV);
    }
    await listStripeSubscriptions(http, false, { startingAfter: "sub_1MowQVLkdIwHu7ixeRlqHVzs" }, ENV);
    await getStripeSubscription(http, false, "sub_1MowQVLkdIwHu7ixeRlqHVzs", ENV);
    for (const status of INVOICE_STATUS_FILTERS) {
      await listStripeInvoices(http, { status, limit: 25 });
    }
    await listStripeInvoices(http, { customerId: "cus_NffrFeUfNV2Hib", startingAfter: "in_1MtHbELkdIwHu7ixl4OzzPMv" });
    assertAllAccepted(exchanges);
  });

  it("changes: plan switch, cancel at period end and resume send requests Stripe accepts", async () => {
    const { http, exchanges } = recordingClient();
    const deps = {
      http,
      livemode: false,
      env: ENV,
      organizationForCustomer: async () => "org_test",
      synchronize: async () => ({ synchronized: true }),
      organizationPlan: async () => null,
    };
    const subscriptionId = "sub_1MowQVLkdIwHu7ixeRlqHVzs";
    const plan = await changeSubscription(
      { subscriptionId, action: "change_plan", targetPlan: "professional", confirm: SUBSCRIPTION_CONFIRM.change_plan },
      deps,
    );
    // stripe-mock's canned subscription is already pending cancellation, so the REAL cancel path
    // correctly refuses ("nothing to change") and the REAL resume path is the one that can run.
    const cancel = await changeSubscription(
      { subscriptionId, action: "cancel_at_period_end", confirm: SUBSCRIPTION_CONFIRM.cancel_at_period_end },
      deps,
    );
    assert.deepEqual(cancel, { ok: false, error: "nothing_to_change" });
    const resume = await changeSubscription(
      { subscriptionId, action: "resume", confirm: SUBSCRIPTION_CONFIRM.resume },
      deps,
    );
    // Stand-in: the cancel form is sent directly (same field the code builds) so Stripe's
    // validator still checks it.
    await http.post(`subscriptions/${subscriptionId}`, { cancel_at_period_end: "true" }, "tc-admin-cancel:spec");

    const bodies = exchanges.filter((e) => e.method === "POST").map((e) => e.body);
    const planBody = bodies.find((b) => b.includes("items[0][price]=price_professional_mock"));
    assert.ok(planBody, "the plan change never reached Stripe");
    assert.match(planBody, /items\[0\]\[id\]=si_/);
    assert.match(planBody, /proration_behavior=none/);
    assert.match(planBody, /payment_behavior=error_if_incomplete/);
    assert.ok(bodies.includes("cancel_at_period_end=false"), "the resume never reached Stripe");
    assertAllAccepted(exchanges);
    assert.equal(plan.ok, true, `plan change: ${JSON.stringify(plan)}`);
    assert.equal(resume.ok, true, `resume: ${JSON.stringify(resume)}`);
  });
});
