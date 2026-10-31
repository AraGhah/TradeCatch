/**
 * Referral program rules. Independent of HTTP, Stripe and the database so the
 * rules that move money (who qualifies, how much, once, and never twice) are
 * unit-tested end to end against the in-memory store.
 *
 * Money safety, in one place:
 *  - A reward exists only after a successful qualifying payment (a paid
 *    installation Checkout Session), and only one per referred business.
 *  - Replaying the same payment returns the same reward (unique session id).
 *  - Refund, chargeback or cancellation before the gift card is issued rejects
 *    the reward; after issue it is flagged for a person, never silently undone.
 *  - Approving needs a person, the hold period to be over, a live payment and
 *    no unacknowledged review flags. Issuing needs a configured fulfillment
 *    method and a unique gift card reference. Nothing here sends a gift card.
 */
import type { PlanId } from "@/product/saas/plan-catalog";
import {
  addDays,
  evaluateReferralRisk,
  generateReferralCode,
  giftCardReferenceSchema,
  mergeSettings,
  normalizeReferralCode,
  referralSettingsPatchSchema,
  rewardAmountCents,
  type PartyFacts,
  type ReferralEvent,
  type ReferralEventAction,
  type ReferralRecord,
  type ReferralSettings,
  type RejectionReason,
  type ReviewFlag,
  type RewardRecord,
  type RewardStatus,
} from "./model";
import { isReferralConflict, type ReferralStore } from "./store";

/* -------------------------------------------------------------------------- */
/* Dependencies                                                               */
/* -------------------------------------------------------------------------- */

export type OrganizationFacts = {
  id: string;
  name: string;
  status: "active" | "suspended" | "churned";
  accountType: string;
  plan: PlanId;
  phoneE164: string | null;
};

export type PaidInstallation = {
  plan: PlanId;
  checkoutSessionId: string;
  paymentIntentId?: string;
  livemode: boolean;
  paidAt: string;
};

export type PaymentCheck =
  | { ok: true; partiallyRefunded?: boolean }
  | { ok: false; reason: "refunded" | "disputed" | "not_paid" | "unavailable" };

/** What the referral rules need to know about the rest of the platform. */
export type ReferralDirectory = {
  getOrganization(id: string): Promise<OrganizationFacts | null>;
  getOwnerEmails(organizationId: string): Promise<string[]>;
  getBillingCustomerId(organizationId: string): Promise<string | null>;
  /** True once the organization has paid its installation fee or holds a live subscription. */
  hasPaidAccess(organizationId: string): Promise<boolean>;
  /** The successful installation payment, if any (used to recover a missed webhook). */
  getPaidInstallation(organizationId: string): Promise<PaidInstallation | null>;
  /**
   * Asks the payment processor whether the qualifying payment still stands.
   * Present in production, where an approval fails closed if it cannot be
   * answered; absent in development and tests.
   */
  verifyPayment?(input: {
    checkoutSessionId: string;
    paymentIntentId?: string;
    livemode: boolean;
  }): Promise<PaymentCheck>;
};

export type ReferralServiceDeps = {
  store: ReferralStore;
  directory: ReferralDirectory;
  now?: () => Date;
  newId?: (prefix: string) => string;
  randomBytes?: (n: number) => Uint8Array;
};

/* -------------------------------------------------------------------------- */
/* Result types                                                               */
/* -------------------------------------------------------------------------- */

export type ReferrerEligibility =
  | { eligible: true }
  | { eligible: false; reason: "program_disabled" | "organization_inactive" | "no_paid_access" };

export type RegisterResult =
  | { ok: true; referral: ReferralRecord }
  | {
      ok: false;
      reason:
        | "program_disabled"
        | "invalid_code"
        | "unknown_referrer"
        | "unknown_organization"
        | "already_referred"
        | "rejected";
      referral?: ReferralRecord;
    };

export type QualifyResult =
  | { qualified: true; reward: RewardRecord; duplicate: boolean }
  | {
      qualified: false;
      reason:
        | "no_referral"
        | "referral_rejected"
        | "program_disabled"
        | "plan_not_eligible";
    };

export type DecisionError =
  | "not_found"
  | "not_pending"
  | "not_approved"
  | "test_payment_not_approvable"
  | "hold_period_active"
  | "referred_inactive"
  | "referrer_inactive"
  | "referrer_is_demo"
  | "payment_unverified"
  | "payment_reversed"
  | "flags_require_acknowledgement"
  | "fulfillment_not_configured"
  | "invalid_reference"
  | "reference_already_used"
  | "invalid_note";

export type DecisionResult =
  | { ok: true; reward: RewardRecord }
  | { ok: false; error: DecisionError; eligibleAt?: string };

export type ReferrerOverview = {
  eligibility: ReferrerEligibility;
  programEnabled: boolean;
  code?: string;
  holdDays: number;
  rewards: { plan: PlanId; amountCents: number; earns: boolean }[];
  referrals: {
    id: string;
    businessName: string;
    status: "signed_up" | "customer" | "not_eligible";
    registeredAt: string;
    qualifiedAt?: string;
    reward?: { status: RewardStatus; amountCents: number; plan: PlanId };
  }[];
  totals: {
    signedUp: number;
    customers: number;
    pendingCents: number;
    earnedCents: number;
    issuedCents: number;
  };
  history: {
    at: string;
    kind:
      | "signed_up"
      | "became_customer"
      | "reward_pending"
      | "reward_approved"
      | "reward_issued"
      | "reward_not_eligible";
    businessName: string;
    amountCents?: number;
  }[];
};

export type AdminReferralRow = {
  referral: ReferralRecord;
  reward: RewardRecord | null;
};

/* -------------------------------------------------------------------------- */
/* Service                                                                    */
/* -------------------------------------------------------------------------- */

const NOTE = { min: 5, max: 500 };

function validNote(note: string | undefined): string | null {
  const trimmed = (note ?? "").trim();
  return trimmed.length >= NOTE.min && trimmed.length <= NOTE.max ? trimmed : null;
}

export function createReferralService(deps: ReferralServiceDeps) {
  const { store, directory } = deps;
  const clock = () => (deps.now ? deps.now() : new Date());
  const iso = () => clock().toISOString();
  const newId =
    deps.newId ??
    ((prefix: string) => {
      const bytes = (deps.randomBytes ?? defaultRandomBytes)(12);
      return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    });

  async function record(
    action: ReferralEventAction,
    actor: string,
    refs: { referralId?: string; rewardId?: string },
    detail?: string,
  ) {
    const event: ReferralEvent = {
      id: newId("rev"),
      ...refs,
      actor,
      action,
      detail: detail?.slice(0, 500),
      at: iso(),
    };
    await store.addEvent(event);
  }

  async function partyFacts(organizationId: string): Promise<PartyFacts | null> {
    const org = await directory.getOrganization(organizationId);
    if (!org) return null;
    const [ownerEmails, stripeCustomerId] = await Promise.all([
      directory.getOwnerEmails(organizationId),
      directory.getBillingCustomerId(organizationId),
    ]);
    return {
      organizationId,
      businessName: org.name,
      ownerEmails,
      phoneE164: org.phoneE164,
      stripeCustomerId,
    };
  }

  /* ------------------------------ referrer side ----------------------------- */

  async function referrerEligibility(
    organizationId: string,
  ): Promise<ReferrerEligibility> {
    const settings = await store.getSettings();
    if (!settings.programEnabled) {
      return { eligible: false, reason: "program_disabled" };
    }
    const org = await directory.getOrganization(organizationId);
    if (!org || org.status !== "active") {
      return { eligible: false, reason: "organization_inactive" };
    }
    // Demo workspaces take part so the flow can be tried end to end; the
    // payment they would make is a test-mode one, which can never be approved.
    if (org.accountType !== "demo" && !(await directory.hasPaidAccess(organizationId))) {
      return { eligible: false, reason: "no_paid_access" };
    }
    return { eligible: true };
  }

  /** The organization's own code, created on first use. Null if not eligible. */
  async function ensureCode(organizationId: string): Promise<string | null> {
    const eligibility = await referrerEligibility(organizationId);
    if (!eligibility.eligible) return null;
    const existing = await store.getCodeForOrganization(organizationId);
    if (existing) return existing;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateReferralCode(deps.randomBytes ?? defaultRandomBytes);
      try {
        return (await store.createCode(organizationId, candidate, iso())).code;
      } catch (err) {
        if (isReferralConflict(err, "code")) continue;
        throw err;
      }
    }
    throw new Error("Could not allocate a referral code.");
  }

  /** Public check used by the landing page: is this a live code? Reveals nothing else. */
  async function isCodeValid(raw: unknown): Promise<boolean> {
    const code = normalizeReferralCode(raw);
    if (!code) return false;
    const referrerId = await store.findOrganizationByCode(code);
    if (!referrerId) return false;
    return (await referrerEligibility(referrerId)).eligible;
  }

  async function overview(organizationId: string): Promise<ReferrerOverview> {
    const [settings, eligibility] = await Promise.all([
      store.getSettings(),
      referrerEligibility(organizationId),
    ]);
    const code = eligibility.eligible ? await ensureCode(organizationId) : null;
    const [referrals, rewards] = await Promise.all([
      store.listReferralsForReferrer(organizationId),
      store.listRewardsForReferrer(organizationId),
    ]);
    const rewardByReferral = new Map(rewards.map((r) => [r.referralId, r]));

    const rows: ReferrerOverview["referrals"] = referrals.map((referral) => {
      const reward = rewardByReferral.get(referral.id);
      return {
        id: referral.id,
        businessName: referral.referredBusinessName,
        status:
          referral.status === "qualified"
            ? "customer"
            : referral.status === "rejected"
              ? "not_eligible"
              : "signed_up",
        registeredAt: referral.registeredAt,
        qualifiedAt: referral.qualifiedAt,
        reward: reward
          ? { status: reward.status, amountCents: reward.amountCents, plan: reward.plan }
          : undefined,
      };
    });

    const sum = (status: RewardStatus[]) =>
      rewards
        .filter((r) => status.includes(r.status))
        .reduce((total, r) => total + r.amountCents, 0);

    const history: ReferrerOverview["history"] = [];
    for (const referral of referrals) {
      history.push({
        at: referral.registeredAt,
        kind: "signed_up",
        businessName: referral.referredBusinessName,
      });
      if (referral.qualifiedAt) {
        history.push({
          at: referral.qualifiedAt,
          kind: "became_customer",
          businessName: referral.referredBusinessName,
        });
      }
    }
    for (const reward of rewards) {
      const businessName =
        referrals.find((r) => r.id === reward.referralId)?.referredBusinessName ?? "";
      history.push({
        at: reward.createdAt,
        kind: "reward_pending",
        businessName,
        amountCents: reward.amountCents,
      });
      if (reward.decidedAt && reward.status !== "rejected") {
        history.push({
          at: reward.decidedAt,
          kind: "reward_approved",
          businessName,
          amountCents: reward.amountCents,
        });
      }
      if (reward.issuedAt) {
        history.push({
          at: reward.issuedAt,
          kind: "reward_issued",
          businessName,
          amountCents: reward.amountCents,
        });
      }
      if (reward.status === "rejected") {
        history.push({
          at: reward.decidedAt ?? reward.updatedAt,
          kind: "reward_not_eligible",
          businessName,
          amountCents: reward.amountCents,
        });
      }
    }
    history.sort((a, b) => b.at.localeCompare(a.at));

    return {
      eligibility,
      programEnabled: settings.programEnabled,
      code: code ?? undefined,
      holdDays: settings.holdDays,
      rewards: (["starter", "growth", "receptionist"] as const).map((plan) => ({
        plan,
        amountCents: rewardAmountCents(settings, plan),
        earns: rewardAmountCents(settings, plan) > 0,
      })),
      referrals: rows,
      totals: {
        signedUp: referrals.length,
        customers: referrals.filter((r) => r.status === "qualified").length,
        pendingCents: sum(["pending"]),
        earnedCents: sum(["approved", "issued"]),
        issuedCents: sum(["issued"]),
      },
      history,
    };
  }

  /* ------------------------------- attribution ------------------------------ */

  /**
   * Links a newly created business to the customer who referred it. Safe to
   * call more than once: a business can only ever have one referral.
   */
  async function registerReferral(input: {
    code: unknown;
    referredOrganizationId: string;
    actor: string;
  }): Promise<RegisterResult> {
    const settings = await store.getSettings();
    if (!settings.programEnabled) return { ok: false, reason: "program_disabled" };
    const code = normalizeReferralCode(input.code);
    if (!code) return { ok: false, reason: "invalid_code" };
    const referrerId = await store.findOrganizationByCode(code);
    if (!referrerId) return { ok: false, reason: "invalid_code" };

    const already = await store.getReferralByReferred(input.referredOrganizationId);
    if (already) return { ok: false, reason: "already_referred", referral: already };

    const [referrer, referred] = await Promise.all([
      partyFacts(referrerId),
      partyFacts(input.referredOrganizationId),
    ]);
    if (!referrer) return { ok: false, reason: "unknown_referrer" };
    if (!referred) return { ok: false, reason: "unknown_organization" };

    const referrerOrg = await directory.getOrganization(referrerId);
    const risk = evaluateReferralRisk(referrer, referred);
    const rejection: RejectionReason | undefined =
      risk.reject ?? (referrerOrg?.status === "active" ? undefined : "referrer_inactive");

    const at = iso();
    const base: ReferralRecord = {
      id: newId("ref"),
      referrerOrganizationId: referrerId,
      referredOrganizationId: input.referredOrganizationId,
      referrerBusinessName: referrer.businessName,
      referredBusinessName: referred.businessName,
      code,
      status: rejection ? "rejected" : "registered",
      rejectionReason: rejection,
      reviewFlags: risk.flags,
      registeredAt: at,
      updatedAt: at,
    };
    const { created, record: saved } = await store.insertReferral(base);
    if (!created) return { ok: false, reason: "already_referred", referral: saved };

    await record(
      rejection ? "rejected" : "registered",
      input.actor,
      { referralId: saved.id },
      rejection ?? (risk.flags.length ? `flags: ${risk.flags.join(",")}` : undefined),
    );
    return rejection
      ? { ok: false, reason: "rejected", referral: saved }
      : { ok: true, referral: saved };
  }

  /* ------------------------------- qualification ---------------------------- */

  /**
   * Called when the referred business's installation payment succeeds. The
   * purchased plan decides the amount; the Checkout Session id makes a replay
   * return the same reward instead of a second one.
   */
  async function qualifyReferral(input: {
    organizationId: string;
    plan: PlanId;
    checkoutSessionId: string;
    paymentIntentId?: string;
    livemode: boolean;
    paidAt?: string;
  }): Promise<QualifyResult> {
    const referral = await store.getReferralByReferred(input.organizationId);
    if (!referral) return { qualified: false, reason: "no_referral" };

    const existing = await store.getRewardByReferral(referral.id);
    if (existing) return { qualified: true, reward: existing, duplicate: true };
    if (referral.status === "rejected") {
      return { qualified: false, reason: "referral_rejected" };
    }

    const settings = await store.getSettings();
    if (!settings.programEnabled) {
      return { qualified: false, reason: "program_disabled" };
    }
    const amountCents = rewardAmountCents(settings, input.plan);
    if (amountCents <= 0) {
      await record(
        "no_reward",
        "system",
        { referralId: referral.id },
        `plan ${input.plan} does not earn a reward`,
      );
      return { qualified: false, reason: "plan_not_eligible" };
    }

    const paidAt = input.paidAt ?? iso();
    const flags: ReviewFlag[] = [...referral.reviewFlags];
    if (!input.livemode && !flags.includes("test_payment")) flags.push("test_payment");

    const at = iso();
    const inserted = await store.insertReward({
      id: newId("rwd"),
      referralId: referral.id,
      referrerOrganizationId: referral.referrerOrganizationId,
      referredOrganizationId: referral.referredOrganizationId,
      plan: input.plan,
      amountCents,
      currency: "CAD",
      status: "pending",
      livemode: input.livemode,
      qualifyingSessionId: input.checkoutSessionId,
      qualifyingPaymentIntentId: input.paymentIntentId,
      eligibleAt: addDays(paidAt, settings.holdDays),
      reviewFlags: flags,
      createdAt: at,
      updatedAt: at,
    });
    if (!inserted.created) {
      return { qualified: true, reward: inserted.reward, duplicate: true };
    }
    await store.updateReferral(referral.id, {
      status: "qualified",
      qualifiedAt: paidAt,
      updatedAt: at,
    });
    await record("qualified", "stripe", { referralId: referral.id }, `plan ${input.plan}`);
    await record(
      "reward_created",
      "stripe",
      { referralId: referral.id, rewardId: inserted.reward.id },
      `${amountCents} cents CAD`,
    );
    return { qualified: true, reward: inserted.reward, duplicate: false };
  }

  /**
   * Recovers a qualification the webhook hook missed (it runs after the
   * billing transaction commits and must never fail billing). Idempotent.
   */
  async function reconcilePaidReferrals(): Promise<{ qualified: number }> {
    let qualified = 0;
    for (const referral of await store.listReferrals({ status: "registered", limit: 500 })) {
      const paid = await directory.getPaidInstallation(referral.referredOrganizationId);
      if (!paid) continue;
      const result = await qualifyReferral({
        organizationId: referral.referredOrganizationId,
        plan: paid.plan,
        checkoutSessionId: paid.checkoutSessionId,
        paymentIntentId: paid.paymentIntentId,
        livemode: paid.livemode,
        paidAt: paid.paidAt,
      });
      if (result.qualified && !result.duplicate) qualified += 1;
    }
    return { qualified };
  }

  /* --------------------------------- reversal ------------------------------- */

  /**
   * A refund, chargeback or cancellation. A reward that has not been issued is
   * rejected; one that has been issued stays issued and is flagged so a person
   * decides about the gift card. Safe to repeat.
   */
  async function reverseReward(
    reward: RewardRecord | null,
    reason: Extract<RejectionReason, "refunded" | "chargeback" | "subscription_cancelled">,
    actor: string,
  ): Promise<{ changed: boolean; reward: RewardRecord | null }> {
    if (!reward) return { changed: false, reward: null };
    if (reward.status === "rejected") return { changed: false, reward };
    const at = iso();
    if (reward.status === "issued") {
      if (reward.reviewFlags.includes("clawback_review")) {
        return { changed: false, reward };
      }
      const flagged = await store.addRewardFlags(reward.id, ["clawback_review"], at);
      await record(
        "reward_flagged",
        actor,
        { referralId: reward.referralId, rewardId: reward.id },
        `${reason} after the gift card was issued`,
      );
      return { changed: true, reward: flagged };
    }
    const rejected = await store.transitionReward(reward.id, {
      from: ["pending", "approved"],
      to: "rejected",
      at,
      patch: { rejectionReason: reason, decidedBy: actor, decidedAt: at },
    });
    if (rejected) {
      await record(
        "reward_rejected",
        actor,
        { referralId: reward.referralId, rewardId: reward.id },
        reason,
      );
    }
    return { changed: !!rejected, reward: rejected ?? reward };
  }

  /** Stripe refunded the qualifying payment (fully) or the customer disputed it. */
  async function onPaymentReversed(input: {
    paymentIntentId: string;
    kind: "refunded" | "partially_refunded" | "chargeback";
  }) {
    const reward = await store.getRewardByPaymentIntent(input.paymentIntentId);
    if (!reward) return { changed: false, reward: null };
    if (input.kind === "partially_refunded") {
      if (reward.status === "rejected" || reward.reviewFlags.includes("partial_refund")) {
        return { changed: false, reward };
      }
      const flagged = await store.addRewardFlags(reward.id, ["partial_refund"], iso());
      await record(
        "reward_flagged",
        "stripe",
        { referralId: reward.referralId, rewardId: reward.id },
        "partial refund of the qualifying payment",
      );
      return { changed: true, reward: flagged };
    }
    return reverseReward(
      reward,
      input.kind === "chargeback" ? "chargeback" : "refunded",
      "stripe",
    );
  }

  /** The referred business's subscription changed state in Stripe. */
  async function onBillingStateChanged(
    organizationId: string,
    status: "active" | "suspended" | "churned",
  ) {
    const reward = await store.getRewardByReferredOrganization(organizationId);
    // An issued card was earned after a verified hold period; a later
    // cancellation does not undo it (only returned money does: see
    // onPaymentReversed). A rejected reward has nothing left to change.
    if (!reward || reward.status === "rejected" || reward.status === "issued") {
      return { changed: false, reward };
    }
    if (status === "churned") {
      return reverseReward(reward, "subscription_cancelled", "stripe");
    }
    if (status === "suspended" && !reward.reviewFlags.includes("billing_suspended")) {
      const flagged = await store.addRewardFlags(reward.id, ["billing_suspended"], iso());
      return { changed: true, reward: flagged };
    }
    return { changed: false, reward };
  }

  /* --------------------------- administrator decisions ---------------------- */

  async function approveReward(
    rewardId: string,
    actor: string,
    options: { acknowledgeFlags?: boolean; note?: string } = {},
  ): Promise<DecisionResult> {
    const reward = await store.getReward(rewardId);
    if (!reward) return { ok: false, error: "not_found" };
    if (reward.status !== "pending") return { ok: false, error: "not_pending" };
    if (!reward.livemode) return { ok: false, error: "test_payment_not_approvable" };
    if (Date.parse(reward.eligibleAt) > clock().getTime()) {
      return { ok: false, error: "hold_period_active", eligibleAt: reward.eligibleAt };
    }

    const [settings, referred, referrer] = await Promise.all([
      store.getSettings(),
      directory.getOrganization(reward.referredOrganizationId),
      directory.getOrganization(reward.referrerOrganizationId),
    ]);
    // Re-verified now, not at qualification: a customer who cancelled during
    // the hold period has not earned anything.
    if (!referred || referred.status !== "active") {
      return { ok: false, error: "referred_inactive" };
    }
    if (settings.requireReferrerActive && (!referrer || referrer.status !== "active")) {
      return { ok: false, error: "referrer_inactive" };
    }
    if (referrer?.accountType === "demo") return { ok: false, error: "referrer_is_demo" };

    // Ask Stripe now, not at qualification: money is about to be committed, and
    // this also covers a refund or dispute whose webhook never arrived.
    let flags = reward.reviewFlags.filter((f) => f !== "test_payment");
    if (directory.verifyPayment) {
      const check = await directory.verifyPayment({
        checkoutSessionId: reward.qualifyingSessionId,
        paymentIntentId: reward.qualifyingPaymentIntentId,
        livemode: reward.livemode,
      });
      if (!check.ok) {
        if (check.reason === "unavailable" || check.reason === "not_paid") {
          return { ok: false, error: "payment_unverified" };
        }
        await reverseReward(
          reward,
          check.reason === "disputed" ? "chargeback" : "refunded",
          actor,
        );
        return { ok: false, error: "payment_reversed" };
      }
      if (check.partiallyRefunded && !flags.includes("partial_refund")) {
        await store.addRewardFlags(reward.id, ["partial_refund"], iso());
        flags = [...flags, "partial_refund"];
      }
    }
    if (flags.length > 0 && !options.acknowledgeFlags) {
      return { ok: false, error: "flags_require_acknowledgement" };
    }

    const at = iso();
    const approved = await store.transitionReward(rewardId, {
      from: ["pending"],
      to: "approved",
      at,
      patch: {
        decidedBy: actor,
        decidedAt: at,
        decisionNote: options.note?.trim().slice(0, NOTE.max) || undefined,
      },
    });
    if (!approved) return { ok: false, error: "not_pending" };
    await record("reward_approved", actor, {
      referralId: approved.referralId,
      rewardId: approved.id,
    });
    return { ok: true, reward: approved };
  }

  async function rejectReward(
    rewardId: string,
    actor: string,
    note: string | undefined,
  ): Promise<DecisionResult> {
    const trimmed = validNote(note);
    if (!trimmed) return { ok: false, error: "invalid_note" };
    const reward = await store.getReward(rewardId);
    if (!reward) return { ok: false, error: "not_found" };
    const at = iso();
    const rejected = await store.transitionReward(rewardId, {
      from: ["pending", "approved"],
      to: "rejected",
      at,
      patch: {
        rejectionReason: "administrator",
        decidedBy: actor,
        decidedAt: at,
        decisionNote: trimmed,
      },
    });
    if (!rejected) return { ok: false, error: "not_pending" };
    await record(
      "reward_rejected",
      actor,
      { referralId: rejected.referralId, rewardId: rejected.id },
      trimmed,
    );
    return { ok: true, reward: rejected };
  }

  /**
   * Records that an administrator sent the gift card. This does NOT send one:
   * there is no automatic fulfillment, so this only runs for an approved
   * reward and only once a fulfillment method has been configured.
   */
  async function markIssued(
    rewardId: string,
    actor: string,
    input: { giftCardReference: string },
  ): Promise<DecisionResult> {
    const settings = await store.getSettings();
    if (settings.fulfillmentMethod === "none") {
      return { ok: false, error: "fulfillment_not_configured" };
    }
    const reference = giftCardReferenceSchema.safeParse(input.giftCardReference);
    if (!reference.success) return { ok: false, error: "invalid_reference" };
    const reward = await store.getReward(rewardId);
    if (!reward) return { ok: false, error: "not_found" };
    if (reward.status !== "approved") return { ok: false, error: "not_approved" };

    const at = iso();
    try {
      const issued = await store.transitionReward(rewardId, {
        from: ["approved"],
        to: "issued",
        at,
        patch: {
          fulfillmentMethod: settings.fulfillmentMethod,
          giftCardReference: reference.data,
          issuedBy: actor,
          issuedAt: at,
        },
      });
      // Lost the race: another administrator issued it first.
      if (!issued) return { ok: false, error: "not_approved" };
      await record(
        "reward_issued",
        actor,
        { referralId: issued.referralId, rewardId: issued.id },
        `via ${settings.fulfillmentMethod}`,
      );
      return { ok: true, reward: issued };
    } catch (err) {
      if (isReferralConflict(err, "gift_card_reference")) {
        return { ok: false, error: "reference_already_used" };
      }
      throw err;
    }
  }

  /* ---------------------------------- settings ------------------------------ */

  async function updateSettings(
    patch: unknown,
    actor: string,
  ): Promise<
    { ok: true; settings: ReferralSettings } | { ok: false; error: "invalid_settings" }
  > {
    const parsed = referralSettingsPatchSchema.safeParse(patch);
    if (!parsed.success) return { ok: false, error: "invalid_settings" };
    const current = await store.getSettings();
    const next = {
      ...mergeSettings(current, parsed.data),
      updatedBy: actor,
      updatedAt: iso(),
    };
    const saved = await store.saveSettings(next);
    await record("settings_changed", actor, {}, Object.keys(parsed.data).join(","));
    return { ok: true, settings: saved };
  }

  /* ----------------------------------- admin -------------------------------- */

  async function adminOverview(): Promise<{
    settings: ReferralSettings;
    rows: AdminReferralRow[];
    counts: Record<RewardStatus, number> & { referrals: number };
  }> {
    const [settings, referrals, rewards] = await Promise.all([
      store.getSettings(),
      store.listReferrals({ limit: 300 }),
      store.listRewards({ limit: 300 }),
    ]);
    const rewardByReferral = new Map(rewards.map((r) => [r.referralId, r]));
    const counts = {
      pending: 0,
      approved: 0,
      issued: 0,
      rejected: 0,
      referrals: referrals.length,
    };
    for (const reward of rewards) counts[reward.status] += 1;
    return {
      settings,
      rows: referrals.map((referral) => ({
        referral,
        reward: rewardByReferral.get(referral.id) ?? null,
      })),
      counts,
    };
  }

  return {
    referrerEligibility,
    ensureCode,
    isCodeValid,
    overview,
    registerReferral,
    qualifyReferral,
    reconcilePaidReferrals,
    onPaymentReversed,
    onBillingStateChanged,
    approveReward,
    rejectReward,
    markIssued,
    updateSettings,
    adminOverview,
    getSettings: () => store.getSettings(),
    listEvents: (filter: Parameters<ReferralStore["listEvents"]>[0]) =>
      store.listEvents(filter),
  };
}

export type ReferralService = ReturnType<typeof createReferralService>;

function defaultRandomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}
