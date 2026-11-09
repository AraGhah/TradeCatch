import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  createMemoryOverageInvoiceStore,
  overageInvoicingSettings,
  previousPeriodStart,
  RETRY_WINDOW_MS,
  runOverageInvoicing,
  type InvoiceItemRequest,
  type OverageInvoicingDeps,
} from "../../src/product/saas/overage-invoicing";
import {
  createMemoryUsageStore,
  recordOrganizationUsage,
  resolveOverage,
  setUsageStoreForTests,
  type MeteredMetric,
} from "../../src/product/saas/usage-metering";

const RATES = {
  OVERAGE_INVOICING: "1",
  OVERAGE_RATE_SMS_SEGMENT_CENTS: "7",
  OVERAGE_RATE_VOICE_MINUTE_CENTS: "25",
};
const ON = overageInvoicingSettings(RATES);
assert.equal(ON.enabled, true);

// "Now" is early November; the month to bill is October.
const NOW = new Date("2026-11-08T09:00:00.000Z");
const OCTOBER = new Date("2026-10-15T12:00:00.000Z");
const NOVEMBER = new Date("2026-11-03T12:00:00.000Z");

const SMS: MeteredMetric = "smsSegmentsPerMonth";
const VOICE: MeteredMetric = "voiceMinutesPerMonth";

/** Stripe as the API behaves: one object per idempotency key. */
function fakeStripe() {
  const calls: InvoiceItemRequest[] = [];
  const byKey = new Map<string, string>();
  let failNext = 0;
  let failFor: string | null = null;
  return {
    calls,
    byKey,
    failNextCalls(n: number) {
      failNext = n;
    },
    failForCustomer(customerId: string | null) {
      failFor = customerId;
    },
    async createInvoiceItem(request: InvoiceItemRequest) {
      calls.push(request);
      if (failNext > 0) {
        failNext -= 1;
        throw new Error("Stripe is down");
      }
      if (failFor && request.customerId === failFor)
        throw new Error("card network error");
      let id = byKey.get(request.idempotencyKey);
      if (!id) {
        id = `ii_${byKey.size + 1}`;
        byKey.set(request.idempotencyKey, id);
      }
      return { id };
    },
  };
}

function setup(
  organizations: { id: string; plan?: "essential" | "professional" }[],
) {
  const stripe = fakeStripe();
  const invoices = createMemoryOverageInvoiceStore();
  const customers = new Map(
    organizations.map((o) => [
      o.id,
      { customerId: `cus_${o.id}`, livemode: false },
    ]),
  );
  const deps: OverageInvoicingDeps = {
    now: NOW,
    settings: ON,
    candidates: async () =>
      organizations.map((o) => ({
        organizationId: o.id,
        plan: o.plan ?? "essential",
      })),
    customerFor: async (id) => customers.get(id) ?? null,
    invoices,
    createInvoiceItem: stripe.createInvoiceItem,
  };
  return { stripe, invoices, customers, deps };
}

async function use(
  org: string,
  metric: MeteredMetric,
  amount: number,
  at: Date,
) {
  await recordOrganizationUsage({
    organizationId: org,
    plan: "essential",
    metric,
    amount,
    now: at,
  });
}

async function decide(
  org: string,
  metric: MeteredMetric,
  decision: "confirmed" | "declined",
  at = OCTOBER,
) {
  const resolved = await resolveOverage({
    organizationId: org,
    metric,
    decision,
    userId: "owner_1",
    now: at,
  });
  assert.ok(resolved, "the overage should have been pending");
}

describe("overage invoicing settings", () => {
  it("is off unless OVERAGE_INVOICING is exactly 1", () => {
    assert.equal(overageInvoicingSettings({}).enabled, false);
    for (const value of ["0", "true", "yes", "", " 2 "]) {
      assert.equal(
        overageInvoicingSettings({ ...RATES, OVERAGE_INVOICING: value })
          .enabled,
        false,
        value,
      );
    }
  });

  it("stays off, and says why, when a rate is missing or not a whole number of cents", () => {
    const missing = overageInvoicingSettings({ OVERAGE_INVOICING: "1" });
    assert.equal(missing.enabled, false);
    assert.match(
      (missing as { reason: string }).reason,
      /OVERAGE_RATE_SMS_SEGMENT_CENTS/,
    );
    for (const bad of ["0", "-3", "1.5", "abc", "10001", "7 cents"]) {
      const settings = overageInvoicingSettings({
        ...RATES,
        OVERAGE_RATE_VOICE_MINUTE_CENTS: bad,
      });
      assert.equal(settings.enabled, false, bad);
    }
  });

  it("turns on only with the flag and both rates", () => {
    const settings = overageInvoicingSettings(RATES);
    assert.deepEqual(settings.enabled && settings.rates, {
      smsSegmentsPerMonth: 7,
      voiceMinutesPerMonth: 25,
    });
  });

  it("bills the month before now", () => {
    assert.equal(
      previousPeriodStart(new Date("2026-11-08T09:00:00Z")),
      "2026-10-01",
    );
    assert.equal(
      previousPeriodStart(new Date("2027-01-01T00:00:00Z")),
      "2026-12-01",
    );
    assert.equal(
      previousPeriodStart(new Date("2026-03-31T23:59:59Z")),
      "2026-02-01",
    );
  });
});

describe("overage invoicing", () => {
  beforeEach(() => setUsageStoreForTests(createMemoryUsageStore()));
  afterEach(() => setUsageStoreForTests(null));

  it("does nothing, and does not even look, while it is switched off", async () => {
    const { deps, stripe } = setup([{ id: "org_a" }]);
    let looked = false;
    const result = await runOverageInvoicing({
      ...deps,
      settings: overageInvoicingSettings({}),
      candidates: async () => {
        looked = true;
        return [];
      },
    });
    assert.equal(result.enabled, false);
    assert.match(result.reason ?? "", /OVERAGE_INVOICING/);
    assert.equal(looked, false);
    assert.equal(stripe.calls.length, 0);
  });

  it("bills a confirmed overage once: units past the allowance times the rate", async () => {
    await use("org_a", SMS, 1250, OCTOBER); // 250 over the 1,000 allowance
    await decide("org_a", SMS, "confirmed");
    const { deps, stripe, invoices } = setup([{ id: "org_a" }]);

    const result = await runOverageInvoicing(deps);

    assert.equal(result.invoiced, 1);
    assert.equal(result.periodStart, "2026-10-01");
    assert.equal(stripe.calls.length, 1);
    const call = stripe.calls[0]!;
    assert.equal(call.amountCents, 250 * 7);
    assert.equal(call.customerId, "cus_org_a");
    assert.equal(call.livemode, false);
    assert.equal(call.idempotencyKey, "overage:org_a:sms_segments:2026-10-01");
    assert.match(
      call.description,
      /SMS segments past your allowance \(2026-10\): 250 × \$0\.07/,
    );
    assert.deepEqual(call.metadata, {
      organization_id: "org_a",
      metric: "sms_segments",
      period_start: "2026-10-01",
      units: "250",
      rate_cents: "7",
    });
    const row = [...invoices.rows.values()][0]!;
    assert.equal(row.status, "created");
    assert.equal(row.stripeInvoiceItemId, "ii_1");
  });

  it("bills nothing for an overage the owner has not answered", async () => {
    await use("org_a", SMS, 1250, OCTOBER); // opened, still pending
    const { deps, stripe } = setup([{ id: "org_a" }]);
    const result = await runOverageInvoicing(deps);
    assert.equal(result.invoiced, 0);
    assert.equal(stripe.calls.length, 0);
  });

  it("bills nothing for a declined overage, and a declined one cannot be flipped later", async () => {
    await use("org_a", SMS, 1250, OCTOBER);
    await decide("org_a", SMS, "declined");
    const flipped = await resolveOverage({
      organizationId: "org_a",
      metric: SMS,
      decision: "confirmed",
      userId: "owner_1",
      now: OCTOBER,
    });
    assert.equal(flipped, null);
    const { deps, stripe } = setup([{ id: "org_a" }]);
    await runOverageInvoicing(deps);
    assert.equal(stripe.calls.length, 0);
  });

  it("bills nothing for usage inside the allowance", async () => {
    await use("org_a", SMS, 900, OCTOBER);
    const { deps, stripe } = setup([{ id: "org_a" }]);
    await runOverageInvoicing(deps);
    assert.equal(stripe.calls.length, 0);
  });

  it("never bills a month that is still accruing", async () => {
    await use("org_a", SMS, 1500, NOVEMBER);
    await decide("org_a", SMS, "confirmed", NOVEMBER);
    const { deps, stripe } = setup([{ id: "org_a" }]);
    await runOverageInvoicing(deps);
    assert.equal(stripe.calls.length, 0);
  });

  it("bills each metric on its own confirmation", async () => {
    await use("org_a", SMS, 1100, OCTOBER);
    await use("org_a", VOICE, 560, OCTOBER); // 60 over the 500-minute allowance
    await decide("org_a", VOICE, "confirmed"); // SMS stays pending
    const { deps, stripe } = setup([{ id: "org_a" }]);
    const result = await runOverageInvoicing(deps);
    assert.equal(result.invoiced, 1);
    assert.equal(stripe.calls.length, 1);
    assert.equal(stripe.calls[0]!.amountCents, 60 * 25);
    assert.equal(stripe.calls[0]!.metadata.metric, "voice_minutes");
  });

  it("is idempotent: running again bills nothing more", async () => {
    await use("org_a", SMS, 1250, OCTOBER);
    await decide("org_a", SMS, "confirmed");
    const { deps, stripe } = setup([{ id: "org_a" }]);
    await runOverageInvoicing(deps);
    const again = await runOverageInvoicing(deps);
    assert.equal(again.invoiced, 0);
    assert.equal(again.alreadyInvoiced, 1);
    assert.equal(stripe.calls.length, 1);
    // Usage that trickles in after the month closed is not billed on top.
    await use("org_a", SMS, 40, OCTOBER);
    await runOverageInvoicing(deps);
    assert.equal(stripe.calls.length, 1);
  });

  it("two overlapping runs end with one invoice item", async () => {
    await use("org_a", SMS, 1250, OCTOBER);
    await decide("org_a", SMS, "confirmed");
    const { deps, stripe } = setup([{ id: "org_a" }]);
    await Promise.all([runOverageInvoicing(deps), runOverageInvoicing(deps)]);
    assert.equal(
      stripe.byKey.size,
      1,
      "Stripe holds a single object for the shared key",
    );
    assert.deepEqual(
      new Set(stripe.calls.map((c) => c.idempotencyKey)).size,
      1,
    );
    assert.deepEqual(
      new Set(stripe.calls.map((c) => c.amountCents)),
      new Set([1750]),
    );
  });

  it("retries a failed Stripe call with the amounts frozen at the claim", async () => {
    await use("org_a", SMS, 1250, OCTOBER);
    await decide("org_a", SMS, "confirmed");
    const { deps, stripe, invoices } = setup([{ id: "org_a" }]);
    stripe.failNextCalls(1);

    const first = await runOverageInvoicing(deps);
    assert.equal(first.failed, 1);
    assert.equal([...invoices.rows.values()][0]!.status, "pending");

    await use("org_a", SMS, 500, OCTOBER); // late usage must not change the frozen amount
    const second = await runOverageInvoicing({
      ...deps,
      now: new Date(NOW.getTime() + 60_000),
    });
    assert.equal(second.retried, 1);
    assert.equal(second.failed, 0);
    assert.equal(stripe.calls.length, 2);
    assert.equal(stripe.calls[1]!.amountCents, 250 * 7);
    assert.equal(
      stripe.calls[1]!.idempotencyKey,
      stripe.calls[0]!.idempotencyKey,
    );
    assert.equal([...invoices.rows.values()][0]!.status, "created");
  });

  it("does not blindly retry a claim older than Stripe's idempotency window", async () => {
    await use("org_a", SMS, 1250, OCTOBER);
    await decide("org_a", SMS, "confirmed");
    const { deps, stripe, invoices } = setup([{ id: "org_a" }]);
    stripe.failNextCalls(1);
    await runOverageInvoicing(deps);

    const late = new Date(NOW.getTime() + RETRY_WINDOW_MS + 60_000);
    const result = await runOverageInvoicing({ ...deps, now: late });
    assert.equal(result.needsReview, 1);
    assert.equal(stripe.calls.length, 1, "no second Stripe call");
    assert.equal([...invoices.rows.values()][0]!.status, "needs_review");

    const next = await runOverageInvoicing({ ...deps, now: late });
    assert.equal(next.needsReview, 1);
    assert.equal(stripe.calls.length, 1);
  });

  it("claims nothing for a business with no Stripe customer, and bills it once it has one", async () => {
    await use("org_a", SMS, 1250, OCTOBER);
    await decide("org_a", SMS, "confirmed");
    const { deps, stripe, invoices, customers } = setup([{ id: "org_a" }]);
    customers.delete("org_a");

    const first = await runOverageInvoicing(deps);
    assert.equal(first.noCustomer, 1);
    assert.equal(invoices.rows.size, 0);
    assert.equal(stripe.calls.length, 0);

    customers.set("org_a", { customerId: "cus_late", livemode: true });
    const second = await runOverageInvoicing(deps);
    assert.equal(second.invoiced, 1);
    assert.equal(stripe.calls[0]!.customerId, "cus_late");
    assert.equal(stripe.calls[0]!.livemode, true);
  });

  it("one business failing does not stop the others", async () => {
    for (const org of ["org_a", "org_b"]) {
      await use(org, SMS, 1250, OCTOBER);
      await decide(org, SMS, "confirmed");
    }
    const { deps, stripe } = setup([{ id: "org_a" }, { id: "org_b" }]);
    stripe.failForCustomer("cus_org_a");
    const result = await runOverageInvoicing(deps);
    assert.equal(result.failed, 1);
    assert.equal(result.invoiced, 1);
    assert.ok(stripe.byKey.has("overage:org_b:sms_segments:2026-10-01"));
  });

  it("uses each plan's own allowance", async () => {
    // Professional allows 2,000 SMS segments, so 2,300 is 300 over.
    await recordOrganizationUsage({
      organizationId: "org_pro",
      plan: "professional",
      metric: SMS,
      amount: 2300,
      now: OCTOBER,
    });
    await decide("org_pro", SMS, "confirmed");
    const { deps, stripe } = setup([{ id: "org_pro", plan: "professional" }]);
    await runOverageInvoicing(deps);
    assert.equal(stripe.calls[0]!.amountCents, 300 * 7);
  });
});
