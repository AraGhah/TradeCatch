import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  createReferralService,
  type OrganizationFacts,
  type PaidInstallation,
  type PaymentCheck,
  type ReferralDirectory,
} from "../../src/product/referrals/service";
import { createMemoryReferralStore } from "../../src/product/referrals/store";
import type { PlanId } from "../../src/product/saas/plan-catalog";

const DAY = 86_400_000;
const START = Date.parse("2026-03-01T12:00:00.000Z");

type World = ReturnType<typeof makeWorld>;

/** `stripe` makes the world answer payment checks the way production does. */
function makeWorld(options: { stripe?: boolean } = {}) {
  let nowMs = START;
  const payment: { check: PaymentCheck } = { check: { ok: true } };
  let counter = 0;
  const orgs = new Map<string, OrganizationFacts>();
  const owners = new Map<string, string[]>();
  const customers = new Map<string, string>();
  const paid = new Map<string, PaidInstallation>();
  const paidAccess = new Set<string>();

  const directory: ReferralDirectory = {
    getOrganization: async (id) => orgs.get(id) ?? null,
    getOwnerEmails: async (id) => owners.get(id) ?? [],
    getBillingCustomerId: async (id) => customers.get(id) ?? null,
    hasPaidAccess: async (id) => paidAccess.has(id),
    getPaidInstallation: async (id) => paid.get(id) ?? null,
    ...(options.stripe ? { verifyPayment: async () => payment.check } : {}),
  };

  const store = createMemoryReferralStore();
  const service = createReferralService({
    store,
    directory,
    now: () => new Date(nowMs),
    newId: (prefix) => `${prefix}_${++counter}`,
    // Deterministic but distinct codes per call.
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => (counter++ * 7 + i * 13) % 251),
  });

  return {
    store,
    service,
    payment,
    orgs,
    paid,
    customers,
    paidAccess,
    advanceDays(days: number) {
      nowMs += days * DAY;
    },
    addOrg(
      id: string,
      options: Partial<OrganizationFacts> & { email?: string; paidAccess?: boolean } = {},
    ) {
      orgs.set(id, {
        id,
        name: options.name ?? `Business ${id}`,
        status: options.status ?? "active",
        accountType: options.accountType ?? "client",
        plan: options.plan ?? "essential",
        phoneE164: options.phoneE164 ?? null,
      });
      // A domain per business: sharing one is (rightly) a review flag.
      owners.set(id, [options.email ?? `owner@${id.replace(/_/g, "-")}.test`]);
      if (options.paidAccess !== false) paidAccess.add(id);
    },
    payInstallation(
      orgId: string,
      plan: PlanId,
      options: { livemode?: boolean; session?: string; intent?: string } = {},
    ) {
      const installation: PaidInstallation = {
        plan,
        checkoutSessionId: options.session ?? `cs_${orgId}`,
        paymentIntentId: options.intent ?? `pi_${orgId}`,
        livemode: options.livemode ?? true,
        paidAt: new Date(nowMs).toISOString(),
      };
      paid.set(orgId, installation);
      return installation;
    },
  };
}

/** A referrer with a code and a referred business that signed up through it. */
async function referredBusiness(w: World, referredId = "org_new", referredOptions = {}) {
  w.addOrg("org_ref", { name: "Plomberie Tremblay" });
  w.addOrg(referredId, { name: "Toitures Gagnon", ...referredOptions, paidAccess: false });
  const code = await w.service.ensureCode("org_ref");
  assert.ok(code, "referrer should get a code");
  const registered = await w.service.registerReferral({
    code,
    referredOrganizationId: referredId,
    actor: "ops",
  });
  assert.equal(registered.ok, true);
  return { code, referral: registered.ok ? registered.referral : undefined };
}

async function qualify(w: World, plan: PlanId, orgId = "org_new") {
  const installation = w.payInstallation(orgId, plan);
  return w.service.qualifyReferral({
    organizationId: orgId,
    plan,
    checkoutSessionId: installation.checkoutSessionId,
    paymentIntentId: installation.paymentIntentId,
    livemode: installation.livemode,
    paidAt: installation.paidAt,
  });
}

describe("referral codes", () => {
  let w: World;
  beforeEach(() => {
    w = makeWorld();
  });

  it("gives an eligible customer one stable, unguessable code", async () => {
    w.addOrg("org_ref");
    const first = await w.service.ensureCode("org_ref");
    const second = await w.service.ensureCode("org_ref");
    assert.ok(first);
    assert.equal(first, second);
    assert.match(first!, /^[2-9A-HJKMNP-Z]{10}$/);
  });

  it("gives different customers different codes", async () => {
    w.addOrg("org_a");
    w.addOrg("org_b");
    const a = await w.service.ensureCode("org_a");
    const b = await w.service.ensureCode("org_b");
    assert.ok(a && b);
    assert.notEqual(a, b);
  });

  it("gives no code to a customer who has not paid yet", async () => {
    w.addOrg("org_unpaid", { paidAccess: false });
    assert.equal(await w.service.ensureCode("org_unpaid"), null);
    assert.deepEqual(await w.service.referrerEligibility("org_unpaid"), {
      eligible: false,
      reason: "no_paid_access",
    });
  });

  it("gives no code to a cancelled or suspended customer", async () => {
    w.addOrg("org_gone", { status: "churned" });
    assert.equal(await w.service.ensureCode("org_gone"), null);
  });

  it("lets a demo workspace try the flow", async () => {
    w.addOrg("org_demo", { accountType: "demo", paidAccess: false });
    assert.ok(await w.service.ensureCode("org_demo"));
  });

  it("gives no code while the program is switched off", async () => {
    w.addOrg("org_ref");
    await w.service.updateSettings({ programEnabled: false }, "admin");
    assert.equal(await w.service.ensureCode("org_ref"), null);
  });

  it("recognises a live code and nothing else", async () => {
    w.addOrg("org_ref");
    const code = (await w.service.ensureCode("org_ref"))!;
    assert.equal(await w.service.isCodeValid(code), true);
    assert.equal(await w.service.isCodeValid(code.toLowerCase()), true);
    assert.equal(await w.service.isCodeValid("ABCDEFGHJK"), false);
    assert.equal(await w.service.isCodeValid("nope"), false);
    assert.equal(await w.service.isCodeValid(undefined), false);
  });
});

describe("attribution", () => {
  let w: World;
  beforeEach(() => {
    w = makeWorld();
  });

  it("links a new business to the customer whose link it used", async () => {
    const { referral } = await referredBusiness(w);
    assert.equal(referral?.status, "registered");
    assert.equal(referral?.referrerOrganizationId, "org_ref");
    assert.equal(referral?.referredOrganizationId, "org_new");
    assert.deepEqual(referral?.reviewFlags, []);
  });

  it("accepts a code typed with spaces, dashes or lower case", async () => {
    w.addOrg("org_ref");
    w.addOrg("org_new", { paidAccess: false });
    const code = (await w.service.ensureCode("org_ref"))!;
    const typed = `${code.slice(0, 5)}-${code.slice(5)}`.toLowerCase();
    const result = await w.service.registerReferral({
      code: typed,
      referredOrganizationId: "org_new",
      actor: "ops",
    });
    assert.equal(result.ok, true);
  });

  it("ignores a code that does not exist", async () => {
    w.addOrg("org_new", { paidAccess: false });
    const result = await w.service.registerReferral({
      code: "ABCDEFGHJK",
      referredOrganizationId: "org_new",
      actor: "ops",
    });
    assert.deepEqual(result, { ok: false, reason: "invalid_code" });
  });

  it("registers a business only once, whichever code it used", async () => {
    const { referral } = await referredBusiness(w);
    w.addOrg("org_other");
    const otherCode = (await w.service.ensureCode("org_other"))!;
    const again = await w.service.registerReferral({
      code: otherCode,
      referredOrganizationId: "org_new",
      actor: "ops",
    });
    assert.equal(again.ok, false);
    assert.equal(!again.ok && again.reason, "already_referred");
    // The first referrer keeps the credit.
    assert.equal(!again.ok && again.referral?.id, referral?.id);
    assert.equal((await w.store.listReferrals()).length, 1);
  });

  it("does nothing while the program is switched off", async () => {
    w.addOrg("org_ref");
    w.addOrg("org_new", { paidAccess: false });
    const code = (await w.service.ensureCode("org_ref"))!;
    await w.service.updateSettings({ programEnabled: false }, "admin");
    const result = await w.service.registerReferral({
      code,
      referredOrganizationId: "org_new",
      actor: "ops",
    });
    assert.deepEqual(result, { ok: false, reason: "program_disabled" });
  });

  it("rejects a customer referring their own business", async () => {
    w.addOrg("org_ref");
    const code = (await w.service.ensureCode("org_ref"))!;
    const result = await w.service.registerReferral({
      code,
      referredOrganizationId: "org_ref",
      actor: "ops",
    });
    assert.equal(!result.ok && result.reason, "rejected");
    assert.equal(!result.ok && result.referral?.rejectionReason, "self_referral");
  });

  it("rejects a second business with the same owner, even through Gmail dots and +tags", async () => {
    w.addOrg("org_ref", { email: "marie.tremblay@gmail.com" });
    w.addOrg("org_new", { email: "marietremblay+reno@gmail.com", paidAccess: false });
    const code = (await w.service.ensureCode("org_ref"))!;
    const result = await w.service.registerReferral({
      code,
      referredOrganizationId: "org_new",
      actor: "ops",
    });
    assert.equal(!result.ok && result.referral?.rejectionReason, "same_owner");
  });

  it("rejects a business sharing the referrer's phone number", async () => {
    w.addOrg("org_ref", { phoneE164: "+15145550123" });
    w.addOrg("org_new", { phoneE164: "(514) 555-0123", paidAccess: false });
    const code = (await w.service.ensureCode("org_ref"))!;
    const result = await w.service.registerReferral({
      code,
      referredOrganizationId: "org_new",
      actor: "ops",
    });
    assert.equal(!result.ok && result.referral?.rejectionReason, "same_phone");
  });

  it("rejects a business billed to the same Stripe customer", async () => {
    w.addOrg("org_ref");
    w.addOrg("org_new", { paidAccess: false });
    w.customers.set("org_ref", "cus_shared");
    w.customers.set("org_new", "cus_shared");
    const code = (await w.service.ensureCode("org_ref"))!;
    const result = await w.service.registerReferral({
      code,
      referredOrganizationId: "org_new",
      actor: "ops",
    });
    assert.equal(!result.ok && result.referral?.rejectionReason, "same_billing_customer");
  });

  it("flags, but does not block, a lookalike business at the same company domain", async () => {
    w.addOrg("org_ref", { name: "Plomberie Tremblay", email: "marie@tremblay.ca" });
    w.addOrg("org_new", {
      name: "Tremblay Plumbing Inc.",
      email: "luc@tremblay.ca",
      paidAccess: false,
    });
    const code = (await w.service.ensureCode("org_ref"))!;
    const result = await w.service.registerReferral({
      code,
      referredOrganizationId: "org_new",
      actor: "ops",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.referral.reviewFlags.sort(), [
      "same_business_name",
      "same_email_domain",
    ]);
  });

  it("does not treat two free-mail users as the same company", async () => {
    w.addOrg("org_ref", { email: "a@gmail.com" });
    w.addOrg("org_new", { email: "b@gmail.com", paidAccess: false });
    const code = (await w.service.ensureCode("org_ref"))!;
    const result = await w.service.registerReferral({
      code,
      referredOrganizationId: "org_new",
      actor: "ops",
    });
    assert.equal(result.ok && result.referral.reviewFlags.length, 0);
  });
});

describe("reward calculation follows the plan the REFERRED customer bought", () => {
  const cases: [PlanId, number][] = [
    ["essential", 5_000],
    ["professional", 7_500],
  ];
  for (const [plan, expected] of cases) {
    it(`${plan} earns CAD $${expected / 100}`, async () => {
      const w = makeWorld();
      await referredBusiness(w);
      // The referrer is on Professional; it must not change the amount.
      w.orgs.get("org_ref")!.plan = "professional";
      const result = await qualify(w, plan);
      assert.equal(result.qualified, true);
      assert.ok(result.qualified);
      assert.equal(result.reward.amountCents, expected);
      assert.equal(result.reward.currency, "CAD");
      assert.equal(result.reward.plan, plan);
      assert.equal(result.reward.kind, "plan");
      assert.equal(result.reward.status, "pending");
    });
  }

  it("uses the administrator's amounts when they change", async () => {
    const w = makeWorld();
    await referredBusiness(w);
    const updated = await w.service.updateSettings(
      { rewardsCents: { essential: 4_000, professional: 6_000 } },
      "admin",
    );
    assert.equal(updated.ok, true);
    const result = await qualify(w, "professional");
    assert.ok(result.qualified);
    assert.equal(result.reward.amountCents, 6_000);
  });

  it("refuses amounts that would let one referral earn more than $110", async () => {
    const w = makeWorld();
    // $80 for the plan plus the $35 website bonus is $115.
    const tooMuch = await w.service.updateSettings(
      { rewardsCents: { professional: 8_000 } },
      "admin",
    );
    assert.deepEqual(tooMuch, { ok: false, error: "invalid_settings" });
    assert.equal((await w.service.getSettings()).rewardsCents.professional, 7_500);
    // Exactly $110 ($75 + $35) is allowed.
    const exactly = await w.service.updateSettings(
      { rewardsCents: { professional: 7_500 }, websiteBonusCents: 3_500 },
      "admin",
    );
    assert.equal(exactly.ok, true);
  });

  it("pays nothing for a plan the administrator excluded", async () => {
    const w = makeWorld();
    await referredBusiness(w);
    await w.service.updateSettings({ eligiblePlans: ["professional"] }, "admin");
    const result = await qualify(w, "essential");
    assert.deepEqual(result, { qualified: false, reason: "plan_not_eligible" });
    assert.equal((await w.store.listRewards()).length, 0);
  });

  it("pays nothing for a retired plan, which is no longer sold", async () => {
    const w = makeWorld();
    await referredBusiness(w);
    const result = await qualify(w, "growth");
    assert.deepEqual(result, { qualified: false, reason: "plan_not_eligible" });
    assert.equal((await w.store.listRewards()).length, 0);
  });

  it("holds the reward for the hold period before it can be approved", async () => {
    const w = makeWorld();
    await referredBusiness(w);
    const result = await qualify(w, "essential");
    assert.ok(result.qualified);
    assert.equal(
      Date.parse(result.reward.eligibleAt) - START,
      30 * DAY,
      "30 day default hold",
    );
  });
});

describe("a reward is created only after a qualifying payment, and only once", () => {
  let w: World;
  beforeEach(() => {
    w = makeWorld();
  });

  it("creates nothing at sign-up", async () => {
    await referredBusiness(w);
    assert.equal((await w.store.listRewards()).length, 0);
    assert.equal((await w.store.getReferralByReferred("org_new"))?.status, "registered");
  });

  it("ignores a payment from a business nobody referred", async () => {
    w.addOrg("org_walkin", { paidAccess: false });
    assert.deepEqual(await qualify(w, "essential", "org_walkin"), {
      qualified: false,
      reason: "no_referral",
    });
  });

  it("marks the referral as a paying customer once paid", async () => {
    await referredBusiness(w);
    await qualify(w, "essential");
    const referral = await w.store.getReferralByReferred("org_new");
    assert.equal(referral?.status, "qualified");
    assert.ok(referral?.qualifiedAt);
  });

  it("replaying the same payment returns the same reward", async () => {
    await referredBusiness(w);
    const first = await qualify(w, "essential");
    const replay = await qualify(w, "essential");
    assert.ok(first.qualified && replay.qualified);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.reward.id, first.reward.id);
    assert.equal((await w.store.listRewards()).length, 1);
  });

  it("a second payment (or upgrade) by the same business does not earn a second reward", async () => {
    await referredBusiness(w);
    // Different amounts per plan, so the assertion below can tell them apart.
    await w.service.updateSettings({ rewardsCents: { essential: 5_000 } }, "admin");
    const first = await qualify(w, "essential");
    const second = await w.service.qualifyReferral({
      organizationId: "org_new",
      plan: "professional",
      checkoutSessionId: "cs_other_session",
      paymentIntentId: "pi_other",
      livemode: true,
    });
    assert.ok(first.qualified && second.qualified);
    assert.equal(second.duplicate, true);
    assert.equal(second.reward.amountCents, 5_000, "still the plan that qualified it");
    assert.equal((await w.store.listRewards()).length, 1);
  });

  it("concurrent webhook deliveries still produce one reward", async () => {
    await referredBusiness(w);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => qualify(w, "essential")),
    );
    assert.equal(results.filter((r) => r.qualified && !r.duplicate).length, 1);
    assert.equal((await w.store.listRewards()).length, 1);
  });

  it("does not pay a rejected (self) referral", async () => {
    w.addOrg("org_ref");
    const code = (await w.service.ensureCode("org_ref"))!;
    await w.service.registerReferral({
      code,
      referredOrganizationId: "org_ref",
      actor: "ops",
    });
    const result = await qualify(w, "essential", "org_ref");
    assert.deepEqual(result, { qualified: false, reason: "referral_rejected" });
    assert.equal((await w.store.listRewards()).length, 0);
  });

  it("does not pay while the program is switched off", async () => {
    await referredBusiness(w);
    await w.service.updateSettings({ programEnabled: false }, "admin");
    assert.deepEqual(await qualify(w, "essential"), {
      qualified: false,
      reason: "program_disabled",
    });
  });

  it("recovers a missed webhook from the billing records, once", async () => {
    await referredBusiness(w);
    w.payInstallation("org_new", "professional");
    assert.deepEqual(await w.service.reconcilePaidReferrals(), { qualified: 1 });
    assert.deepEqual(await w.service.reconcilePaidReferrals(), { qualified: 0 });
    const [reward] = await w.store.listRewards();
    // Professional was bought, so the Professional reward applies.
    assert.equal(reward?.amountCents, 7_500);
  });
});

describe("refunds, chargebacks and cancellations", () => {
  let w: World;
  beforeEach(() => {
    w = makeWorld();
  });

  it("a full refund rejects a reward that has not been issued", async () => {
    await referredBusiness(w);
    const result = await qualify(w, "essential");
    assert.ok(result.qualified);
    const outcome = await w.service.onPaymentReversed({
      paymentIntentId: "pi_org_new",
      kind: "refunded",
    });
    assert.equal(outcome.changed, true);
    const reward = await w.store.getReward(result.reward.id);
    assert.equal(reward?.status, "rejected");
    assert.equal(reward?.rejectionReason, "refunded");
  });

  it("a chargeback rejects the reward too", async () => {
    await referredBusiness(w);
    await qualify(w, "essential");
    await w.service.onPaymentReversed({ paymentIntentId: "pi_org_new", kind: "chargeback" });
    const [reward] = await w.store.listRewards();
    assert.equal(reward?.status, "rejected");
    assert.equal(reward?.rejectionReason, "chargeback");
  });

  it("a partial refund only flags the reward for a person to look at", async () => {
    await referredBusiness(w);
    await qualify(w, "essential");
    await w.service.onPaymentReversed({
      paymentIntentId: "pi_org_new",
      kind: "partially_refunded",
    });
    const [reward] = await w.store.listRewards();
    assert.equal(reward?.status, "pending");
    assert.deepEqual(reward?.reviewFlags, ["partial_refund"]);
  });

  it("a refund for an unrelated payment changes nothing", async () => {
    await referredBusiness(w);
    await qualify(w, "essential");
    const outcome = await w.service.onPaymentReversed({
      paymentIntentId: "pi_somebody_else",
      kind: "refunded",
    });
    assert.equal(outcome.changed, false);
    assert.equal((await w.store.listRewards())[0]?.status, "pending");
  });

  it("repeating a refund notification is harmless", async () => {
    await referredBusiness(w);
    await qualify(w, "essential");
    await w.service.onPaymentReversed({ paymentIntentId: "pi_org_new", kind: "refunded" });
    const again = await w.service.onPaymentReversed({
      paymentIntentId: "pi_org_new",
      kind: "refunded",
    });
    assert.equal(again.changed, false);
    assert.equal(
      (await w.store.listEvents({ limit: 100 })).filter((e) => e.action === "reward_rejected")
        .length,
      1,
    );
  });

  it("cancelling the subscription rejects a pending or approved reward", async () => {
    await referredBusiness(w);
    await qualify(w, "essential");
    await w.service.onBillingStateChanged("org_new", "churned");
    const [reward] = await w.store.listRewards();
    assert.equal(reward?.status, "rejected");
    assert.equal(reward?.rejectionReason, "subscription_cancelled");
  });

  it("a suspended subscription flags the reward without rejecting it", async () => {
    await referredBusiness(w);
    await qualify(w, "essential");
    await w.service.onBillingStateChanged("org_new", "suspended");
    const [reward] = await w.store.listRewards();
    assert.equal(reward?.status, "pending");
    assert.ok(reward?.reviewFlags.includes("billing_suspended"));
  });

  it("an issued gift card is never silently undone: it is flagged for a person", async () => {
    await referredBusiness(w);
    await w.service.updateSettings({ fulfillmentMethod: "manual", holdDays: 0 }, "admin");
    const qualified = await qualify(w, "essential");
    assert.ok(qualified.qualified);
    assert.equal((await w.service.approveReward(qualified.reward.id, "admin")).ok, true);
    assert.equal(
      (
        await w.service.markIssued(qualified.reward.id, "admin", {
          giftCardReference: "ORDER-1001",
        })
      ).ok,
      true,
    );

    await w.service.onPaymentReversed({ paymentIntentId: "pi_org_new", kind: "refunded" });
    const reward = await w.store.getReward(qualified.reward.id);
    assert.equal(reward?.status, "issued");
    assert.ok(reward?.reviewFlags.includes("clawback_review"));
    // And only flagged once.
    const again = await w.service.onPaymentReversed({
      paymentIntentId: "pi_org_new",
      kind: "refunded",
    });
    assert.equal(again.changed, false);
  });
});

describe("administrator approval", () => {
  let w: World;
  let rewardId: string;
  beforeEach(async () => {
    w = makeWorld();
    await referredBusiness(w);
    const result = await qualify(w, "essential");
    assert.ok(result.qualified);
    rewardId = result.reward.id;
  });

  it("cannot approve during the hold period", async () => {
    w.advanceDays(10);
    const result = await w.service.approveReward(rewardId, "admin");
    assert.equal(!result.ok && result.error, "hold_period_active");
    assert.ok(!result.ok && result.eligibleAt);
  });

  it("approves once the hold period is over and the customer is still active", async () => {
    w.advanceDays(31);
    const result = await w.service.approveReward(rewardId, "admin", { note: "Looks fine" });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.reward.status, "approved");
    assert.equal(result.ok && result.reward.decidedBy, "admin");
  });

  it("cannot approve a customer who cancelled during the hold period", async () => {
    w.advanceDays(31);
    w.orgs.get("org_new")!.status = "churned";
    const result = await w.service.approveReward(rewardId, "admin");
    assert.equal(!result.ok && result.error, "referred_inactive");
  });

  it("cannot approve when the referrer is no longer a customer", async () => {
    w.advanceDays(31);
    w.orgs.get("org_ref")!.status = "churned";
    const result = await w.service.approveReward(rewardId, "admin");
    assert.equal(!result.ok && result.error, "referrer_inactive");
  });

  it("can approve for a former customer when that rule is switched off", async () => {
    w.advanceDays(31);
    w.orgs.get("org_ref")!.status = "churned";
    await w.service.updateSettings({ requireReferrerActive: false }, "admin");
    assert.equal((await w.service.approveReward(rewardId, "admin")).ok, true);
  });

  it("cannot approve twice", async () => {
    w.advanceDays(31);
    await w.service.approveReward(rewardId, "admin");
    const second = await w.service.approveReward(rewardId, "admin");
    assert.equal(!second.ok && second.error, "not_pending");
  });

  it("needs the review flags acknowledged", async () => {
    w.advanceDays(31);
    await w.store.addRewardFlags(rewardId, ["same_email_domain"], new Date().toISOString());
    const blocked = await w.service.approveReward(rewardId, "admin");
    assert.equal(!blocked.ok && blocked.error, "flags_require_acknowledgement");
    const acknowledged = await w.service.approveReward(rewardId, "admin", {
      acknowledgeFlags: true,
    });
    assert.equal(acknowledged.ok, true);
  });

  it("never approves a Stripe test-mode payment", async () => {
    const test = makeWorld();
    await referredBusiness(test);
    const installation = test.payInstallation("org_new", "essential", { livemode: false });
    const result = await test.service.qualifyReferral({
      organizationId: "org_new",
      plan: "essential",
      checkoutSessionId: installation.checkoutSessionId,
      paymentIntentId: installation.paymentIntentId,
      livemode: false,
    });
    assert.ok(result.qualified);
    assert.ok(result.reward.reviewFlags.includes("test_payment"));
    test.advanceDays(60);
    const approval = await test.service.approveReward(result.reward.id, "admin", {
      acknowledgeFlags: true,
    });
    assert.equal(!approval.ok && approval.error, "test_payment_not_approvable");
  });

  it("rejecting needs a written reason", async () => {
    assert.equal(
      (await w.service.rejectReward(rewardId, "admin", "  ")).ok,
      false,
    );
    const rejected = await w.service.rejectReward(rewardId, "admin", "Duplicate business");
    assert.equal(rejected.ok, true);
    assert.equal(rejected.ok && rejected.reward.status, "rejected");
    assert.equal(rejected.ok && rejected.reward.rejectionReason, "administrator");
  });

  it("a rejected reward cannot be revived by approving it", async () => {
    w.advanceDays(31);
    await w.service.rejectReward(rewardId, "admin", "Duplicate business");
    const result = await w.service.approveReward(rewardId, "admin");
    assert.equal(!result.ok && result.error, "not_pending");
  });

  it("an unknown reward id is not found", async () => {
    const result = await w.service.approveReward("rwd_missing", "admin");
    assert.equal(!result.ok && result.error, "not_found");
  });
});

describe("approval re-checks the payment with Stripe", () => {
  async function pendingReward() {
    const w = makeWorld({ stripe: true });
    await referredBusiness(w);
    const result = await qualify(w, "essential");
    assert.ok(result.qualified);
    w.advanceDays(31);
    return { w, rewardId: result.reward.id };
  }

  it("approves when the payment still stands", async () => {
    const { w, rewardId } = await pendingReward();
    assert.equal((await w.service.approveReward(rewardId, "admin")).ok, true);
  });

  it("fails closed when Stripe cannot be asked", async () => {
    const { w, rewardId } = await pendingReward();
    w.payment.check = { ok: false, reason: "unavailable" };
    const result = await w.service.approveReward(rewardId, "admin");
    assert.equal(!result.ok && result.error, "payment_unverified");
    assert.equal((await w.store.getReward(rewardId))?.status, "pending");
  });

  it("rejects the reward when the payment was refunded and the webhook was missed", async () => {
    const { w, rewardId } = await pendingReward();
    w.payment.check = { ok: false, reason: "refunded" };
    const result = await w.service.approveReward(rewardId, "admin");
    assert.equal(!result.ok && result.error, "payment_reversed");
    const reward = await w.store.getReward(rewardId);
    assert.equal(reward?.status, "rejected");
    assert.equal(reward?.rejectionReason, "refunded");
  });

  it("rejects the reward when the payment was disputed", async () => {
    const { w, rewardId } = await pendingReward();
    w.payment.check = { ok: false, reason: "disputed" };
    await w.service.approveReward(rewardId, "admin");
    assert.equal((await w.store.getReward(rewardId))?.rejectionReason, "chargeback");
  });

  it("makes a person acknowledge a partial refund", async () => {
    const { w, rewardId } = await pendingReward();
    w.payment.check = { ok: true, partiallyRefunded: true };
    const blocked = await w.service.approveReward(rewardId, "admin");
    assert.equal(!blocked.ok && blocked.error, "flags_require_acknowledgement");
    const approved = await w.service.approveReward(rewardId, "admin", { acknowledgeFlags: true });
    assert.equal(approved.ok, true);
    assert.ok(approved.ok && approved.reward.reviewFlags.includes("partial_refund"));
  });
});

describe("gift cards are recorded, never sent automatically, and never twice", () => {
  let w: World;
  let rewardId: string;

  async function approvedReward(world: World, orgId = "org_new") {
    world.advanceDays(31);
    const reward = await world.store.getRewardByReferredOrganization(orgId);
    assert.ok(reward);
    const approved = await world.service.approveReward(reward.id, "admin");
    assert.equal(approved.ok, true);
    return reward.id;
  }

  beforeEach(async () => {
    w = makeWorld();
    await referredBusiness(w);
    await qualify(w, "professional");
    rewardId = await approvedReward(w);
  });

  it("cannot be marked issued until a fulfillment method is configured", async () => {
    const result = await w.service.markIssued(rewardId, "admin", {
      giftCardReference: "ORDER-1001",
    });
    assert.equal(!result.ok && result.error, "fulfillment_not_configured");
    assert.equal((await w.store.getReward(rewardId))?.status, "approved");
  });

  it("is recorded once a method is configured", async () => {
    await w.service.updateSettings({ fulfillmentMethod: "manual" }, "admin");
    const result = await w.service.markIssued(rewardId, "admin", {
      giftCardReference: "ORDER-1001",
    });
    assert.equal(result.ok, true);
    assert.ok(result.ok);
    assert.equal(result.reward.status, "issued");
    assert.equal(result.reward.giftCardReference, "ORDER-1001");
    assert.equal(result.reward.fulfillmentMethod, "manual");
    assert.equal(result.reward.issuedBy, "admin");
    assert.ok(result.reward.issuedAt);
  });

  it("cannot be issued twice", async () => {
    await w.service.updateSettings({ fulfillmentMethod: "manual" }, "admin");
    await w.service.markIssued(rewardId, "admin", { giftCardReference: "ORDER-1001" });
    const again = await w.service.markIssued(rewardId, "admin", {
      giftCardReference: "ORDER-1002",
    });
    assert.equal(!again.ok && again.error, "not_approved");
    assert.equal((await w.store.getReward(rewardId))?.giftCardReference, "ORDER-1001");
  });

  it("cannot be issued before it is approved", async () => {
    const other = makeWorld();
    await referredBusiness(other);
    await qualify(other, "essential");
    await other.service.updateSettings({ fulfillmentMethod: "manual" }, "admin");
    const reward = await other.store.getRewardByReferredOrganization("org_new");
    const result = await other.service.markIssued(reward!.id, "admin", {
      giftCardReference: "ORDER-1001",
    });
    assert.equal(!result.ok && result.error, "not_approved");
  });

  it("refuses a reference that has already been used for another reward", async () => {
    await w.service.updateSettings({ fulfillmentMethod: "manual" }, "admin");
    await w.service.markIssued(rewardId, "admin", { giftCardReference: "ORDER-1001" });

    // A second referral from a different pair of businesses.
    w.addOrg("org_ref2");
    w.addOrg("org_new2", { paidAccess: false });
    const code2 = (await w.service.ensureCode("org_ref2"))!;
    await w.service.registerReferral({
      code: code2,
      referredOrganizationId: "org_new2",
      actor: "ops",
    });
    await qualify(w, "essential", "org_new2");
    const secondId = await approvedReward(w, "org_new2");

    const result = await w.service.markIssued(secondId, "admin", {
      giftCardReference: "ORDER-1001",
    });
    assert.equal(!result.ok && result.error, "reference_already_used");
    assert.equal((await w.store.getReward(secondId))?.status, "approved");
  });

  it("two administrators issuing at the same moment record one gift card", async () => {
    await w.service.updateSettings({ fulfillmentMethod: "manual" }, "admin");
    const [a, b] = await Promise.all([
      w.service.markIssued(rewardId, "admin_a", { giftCardReference: "ORDER-A" }),
      w.service.markIssued(rewardId, "admin_b", { giftCardReference: "ORDER-B" }),
    ]);
    assert.equal([a, b].filter((r) => r.ok).length, 1);
    assert.equal((await w.store.getReward(rewardId))?.status, "issued");
  });

  it("refuses a missing, malformed or card-number-like reference", async () => {
    await w.service.updateSettings({ fulfillmentMethod: "manual" }, "admin");
    for (const bad of ["", "  ", "ab", "<script>", "x".repeat(81), "4111 1111 1111 1111"]) {
      const result = await w.service.markIssued(rewardId, "admin", { giftCardReference: bad });
      assert.equal(!result.ok && result.error, "invalid_reference", `reference ${bad}`);
    }
    assert.equal((await w.store.getReward(rewardId))?.status, "approved");
  });

  it("an event trail records who did what", async () => {
    await w.service.updateSettings({ fulfillmentMethod: "manual" }, "admin");
    await w.service.markIssued(rewardId, "admin", { giftCardReference: "ORDER-1001" });
    const reward = await w.store.getReward(rewardId);
    const actions = (await w.service.listEvents({ rewardId, limit: 50 })).map((e) => e.action);
    assert.ok(actions.includes("reward_created"));
    assert.ok(actions.includes("reward_approved"));
    assert.ok(actions.includes("reward_issued"));
    assert.ok(reward);
  });
});

describe("settings", () => {
  it("start with the agreed rewards and nothing automatic", async () => {
    const w = makeWorld();
    const settings = await w.service.getSettings();
    // $50 for Essential and $75 for Professional; the retired plans keep their
    // old figure but are not eligible, so they never pay out.
    assert.equal(settings.rewardsCents.essential, 5_000);
    assert.equal(settings.rewardsCents.professional, 7_500);
    assert.equal(settings.rewardsCents.starter, 6_500);
    assert.equal(settings.websiteBonusCents, 3_500);
    assert.deepEqual(settings.eligiblePlans, ["essential", "professional"]);
    assert.equal(settings.programEnabled, true);
    assert.equal(settings.fulfillmentMethod, "none");
  });

  it("reject unknown fields, negative amounts and absurd values", async () => {
    const w = makeWorld();
    for (const bad of [
      { surprise: true },
      { rewardsCents: { essential: -1, professional: 0 } },
      { rewardsCents: { essential: 1.5, professional: 0 } },
      { rewardsCents: { essential: 5_000_000, professional: 0 } },
      // Nothing may push one referral past the $110 program maximum.
      { websiteBonusCents: 5_000_000 },
      { holdDays: -3 },
      { holdDays: 5_000 },
      { fulfillmentMethod: "automatic" },
      { eligiblePlans: ["platinum"] },
    ]) {
      const result = await w.service.updateSettings(bad, "admin");
      assert.deepEqual(result, { ok: false, error: "invalid_settings" }, JSON.stringify(bad));
    }
    assert.equal((await w.service.getSettings()).rewardsCents.essential, 5_000);
  });

  it("change only what was sent and record who changed it", async () => {
    const w = makeWorld();
    const result = await w.service.updateSettings({ holdDays: 14 }, "admin@example.com");
    assert.ok(result.ok);
    assert.equal(result.settings.holdDays, 14);
    assert.equal(result.settings.rewardsCents.professional, 7_500);
    assert.equal(result.settings.updatedBy, "admin@example.com");
  });
});

describe("what the referring customer sees", () => {
  it("shows their link, the rewards, and progress without revealing review flags", async () => {
    const w = makeWorld();
    const { code } = await referredBusiness(w);
    await qualify(w, "essential");

    const overview = await w.service.overview("org_ref");
    assert.equal(overview.code, code);
    assert.equal(overview.eligibility.eligible, true);
    assert.deepEqual(
      overview.rewards.map((r) => [r.plan, r.amountCents]),
      [
        ["essential", 5_000],
        ["professional", 7_500],
      ],
    );
    assert.equal(overview.websiteBonusCents, 3_500);
    assert.equal(overview.maxRewardCents, 11_000);
    assert.equal(overview.referrals.length, 1);
    assert.equal(overview.referrals[0]?.businessName, "Toitures Gagnon");
    assert.equal(overview.referrals[0]?.status, "customer");
    assert.deepEqual(overview.referrals[0]?.reward, {
      status: "pending",
      amountCents: 5_000,
      plan: "essential",
    });
    assert.deepEqual(overview.totals, {
      signedUp: 1,
      customers: 1,
      pendingCents: 5_000,
      earnedCents: 0,
      issuedCents: 0,
    });
    // Nothing internal leaks into what the customer receives.
    const serialized = JSON.stringify(overview);
    for (const secret of ["reviewFlags", "rejectionReason", "decisionNote", "giftCardReference"]) {
      assert.ok(!serialized.includes(secret), `${secret} should not be exposed`);
    }
  });

  it("counts approved and issued rewards as earned", async () => {
    const w = makeWorld();
    await referredBusiness(w);
    await w.service.updateSettings({ fulfillmentMethod: "manual", holdDays: 0 }, "admin");
    const qualified = await qualify(w, "professional");
    assert.ok(qualified.qualified);
    await w.service.approveReward(qualified.reward.id, "admin");
    let overview = await w.service.overview("org_ref");
    assert.equal(overview.totals.earnedCents, 7_500);
    assert.equal(overview.totals.issuedCents, 0);
    await w.service.markIssued(qualified.reward.id, "admin", { giftCardReference: "ORDER-77" });
    overview = await w.service.overview("org_ref");
    assert.equal(overview.totals.issuedCents, 7_500);
    assert.deepEqual(new Set(overview.history.map((h) => h.kind)), new Set([
      "reward_issued",
      "reward_approved",
      "reward_pending",
      "became_customer",
      "signed_up",
    ]));
  });

  it("shows a refunded referral as not eligible, with no earnings", async () => {
    const w = makeWorld();
    await referredBusiness(w);
    await qualify(w, "essential");
    await w.service.onPaymentReversed({ paymentIntentId: "pi_org_new", kind: "refunded" });
    const overview = await w.service.overview("org_ref");
    assert.equal(overview.totals.pendingCents, 0);
    assert.equal(overview.totals.earnedCents, 0);
    assert.ok(overview.history.some((h) => h.kind === "reward_not_eligible"));
  });

  it("never shows one customer another customer's referrals", async () => {
    const w = makeWorld();
    await referredBusiness(w);
    w.addOrg("org_other");
    const overview = await w.service.overview("org_other");
    assert.equal(overview.referrals.length, 0);
    // Looking at the page never creates a link; asking for one does, and it is their own.
    assert.equal(overview.code, undefined);
    assert.equal(overview.eligibility.eligible, true);
    const mine = await w.service.ensureLink("org_other");
    assert.ok(mine.ok);
    assert.equal((await w.service.overview("org_other")).code, mine.ok ? mine.code : "");
    assert.notEqual(mine.ok && mine.code, (await w.service.getLink("org_ref")).ok && (await w.service.getLink("org_ref") as { code: string | null }).code);
  });

  it("explains why a customer without paid access has no link yet", async () => {
    const w = makeWorld();
    w.addOrg("org_unpaid", { paidAccess: false });
    const overview = await w.service.overview("org_unpaid");
    assert.equal(overview.code, undefined);
    assert.deepEqual(overview.eligibility, { eligible: false, reason: "no_paid_access" });
  });
});

describe("administrator overview", () => {
  it("lists every referral with its reward and counts by status", async () => {
    const w = makeWorld();
    await referredBusiness(w);
    await qualify(w, "essential");
    const overview = await w.service.adminOverview();
    assert.equal(overview.rows.length, 1);
    assert.equal(overview.rows[0]?.reward?.status, "pending");
    assert.equal(overview.counts.pending, 1);
    assert.equal(overview.counts.referrals, 1);
    assert.equal(overview.counts.issued, 0);
  });
});

describe("website service bonus", () => {
  let w: World;
  beforeEach(() => {
    w = makeWorld();
  });

  const bought = (requestId = "req_1") =>
    w.service.onWebsiteServicePurchased({ organizationId: "org_new", requestId });

  it("earns the extra $35 on top of the $50 Essential reward, $85 in all", async () => {
    await referredBusiness(w);
    const plan = await qualify(w, "essential");
    assert.ok(plan.qualified);
    const bonus = await bought();
    assert.ok(bonus.earned);
    assert.equal(bonus.duplicate, false);
    assert.equal(bonus.reward.kind, "website");
    assert.equal(bonus.reward.amountCents, 3_500);
    assert.equal(bonus.reward.currency, "CAD");
    assert.equal(bonus.reward.status, "pending");
    const total = (await w.store.listRewards()).reduce((sum, r) => sum + r.amountCents, 0);
    assert.equal(total, 8_500);
  });

  it("is paid once, however often the website purchase is reported", async () => {
    await referredBusiness(w);
    await qualify(w, "professional");
    const first = await bought("req_1");
    const replay = await bought("req_1");
    const secondOrder = await bought("req_2");
    assert.ok(first.earned && replay.earned && secondOrder.earned);
    assert.equal(replay.duplicate, true);
    assert.equal(secondOrder.duplicate, true);
    assert.equal(replay.reward.id, first.reward.id);
    assert.equal(secondOrder.reward.id, first.reward.id);
    assert.equal((await w.store.listRewards()).length, 2, "one plan reward, one bonus");
  });

  it("concurrent reports still produce one bonus", async () => {
    await referredBusiness(w);
    await qualify(w, "essential");
    const results = await Promise.all(Array.from({ length: 5 }, () => bought()));
    assert.equal(results.filter((r) => r.earned && !r.duplicate).length, 1);
    assert.equal((await w.store.listRewards()).filter((r) => r.kind === "website").length, 1);
  });

  it("needs a referral that qualified through a paid plan first", async () => {
    // Nobody referred this business.
    w.addOrg("org_new");
    assert.deepEqual(await bought(), { earned: false, reason: "no_referral" });
    // Referred, but the plan has not been paid for.
    const other = makeWorld();
    await referredBusiness(other);
    assert.deepEqual(
      await other.service.onWebsiteServicePurchased({ organizationId: "org_new", requestId: "r" }),
      { earned: false, reason: "not_qualified" },
    );
    assert.equal((await other.store.listRewards()).length, 0);
  });

  it("earns nothing when the plan payment was refunded", async () => {
    await referredBusiness(w);
    await qualify(w, "essential");
    await w.service.onPaymentReversed({ paymentIntentId: "pi_org_new", kind: "refunded" });
    assert.deepEqual(await bought(), { earned: false, reason: "plan_reward_rejected" });
  });

  it("is rejected together with the plan reward when the plan payment is refunded later", async () => {
    await referredBusiness(w);
    await qualify(w, "essential");
    await bought();
    await w.service.onPaymentReversed({ paymentIntentId: "pi_org_new", kind: "refunded" });
    const rewards = await w.store.listRewards();
    assert.equal(rewards.length, 2);
    assert.ok(rewards.every((r) => r.status === "rejected"), "neither reward may stay payable");
  });

  it("is not offered when the program or the bonus is switched off", async () => {
    await referredBusiness(w);
    await qualify(w, "essential");
    await w.service.updateSettings({ websiteBonusCents: 0 }, "admin");
    assert.deepEqual(await bought(), { earned: false, reason: "bonus_not_offered" });
    await w.service.updateSettings({ programEnabled: false }, "admin");
    assert.deepEqual(await bought(), { earned: false, reason: "program_disabled" });
    assert.equal((await w.store.listRewards()).length, 1, "only the plan reward exists");
  });

  it("is never approved while the plan reward it depends on is not standing", async () => {
    await referredBusiness(w);
    await qualify(w, "essential");
    const bonus = await bought();
    assert.ok(bonus.earned);
    await w.service.updateSettings({ holdDays: 0 }, "admin");
    const planReward = (await w.store.listRewards()).find((r) => r.kind === "plan")!;
    await w.service.rejectReward(planReward.id, "admin", "Customer cancelled");
    const approval = await w.service.approveReward(bonus.reward.id, "admin");
    assert.equal(approval.ok, false);
  });
});
