/**
 * Referral program: the shapes and the pure rules.
 *
 * An existing customer shares a link; a contractor who arrives through it and
 * pays their installation fee earns the referrer a gift card whose value
 * depends on the plan the REFERRED customer bought (not the referrer's plan).
 * Nothing here talks to Stripe, a database or a gift card provider.
 */
import { z } from "zod";
export {
  REFERRAL_CODE_LENGTH,
  REFERRAL_CODE_PATTERN,
  generateReferralCode,
  normalizeReferralCode,
} from "./code";
import {
  DEFAULT_REFERRAL_REWARDS_CENTS,
  PLAN_ORDER,
  type PlanId,
} from "@/product/saas/plan-catalog";

/* -------------------------------------------------------------------------- */
/* Records                                                                    */
/* -------------------------------------------------------------------------- */

/** registered: signed up through a link. qualified: paid. rejected: not eligible. */
export type ReferralStatus = "registered" | "qualified" | "rejected";

/** The reward lifecycle the customer and the administrator both see. */
export type RewardStatus = "pending" | "approved" | "issued" | "rejected";

export type FulfillmentMethod = "none" | "manual";

export type RejectionReason =
  | "self_referral"
  | "same_owner"
  | "same_phone"
  | "same_billing_customer"
  | "referrer_inactive"
  | "refunded"
  | "chargeback"
  | "subscription_cancelled"
  | "administrator";

/** Signals that do not block a referral but need a person to look first. */
export type ReviewFlag =
  | "same_email_domain"
  | "same_business_name"
  | "partial_refund"
  | "billing_suspended"
  | "clawback_review"
  | "test_payment";

export type ReferralRecord = {
  id: string;
  referrerOrganizationId: string;
  referredOrganizationId: string;
  referrerBusinessName: string;
  referredBusinessName: string;
  code: string;
  status: ReferralStatus;
  rejectionReason?: RejectionReason;
  reviewFlags: ReviewFlag[];
  registeredAt: string;
  qualifiedAt?: string;
  updatedAt: string;
};

export type RewardRecord = {
  id: string;
  referralId: string;
  referrerOrganizationId: string;
  referredOrganizationId: string;
  /** The plan the REFERRED customer purchased. */
  plan: PlanId;
  amountCents: number;
  currency: "CAD";
  status: RewardStatus;
  /** False for a Stripe test-mode payment: shown, never approvable. */
  livemode: boolean;
  /** Idempotency anchor: one reward per qualifying Checkout Session. */
  qualifyingSessionId: string;
  qualifyingPaymentIntentId?: string;
  /** Earliest moment it may be approved (end of the hold period). */
  eligibleAt: string;
  reviewFlags: ReviewFlag[];
  rejectionReason?: RejectionReason;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  fulfillmentMethod?: FulfillmentMethod;
  /** Gift card order number or last four characters. Never the full card code. */
  giftCardReference?: string;
  issuedBy?: string;
  issuedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ReferralEventAction =
  | "registered"
  | "rejected"
  | "qualified"
  | "reward_created"
  | "reward_approved"
  | "reward_rejected"
  | "reward_issued"
  | "reward_flagged"
  | "settings_changed"
  | "no_reward";

export type ReferralEvent = {
  id: string;
  referralId?: string;
  rewardId?: string;
  actor: string;
  action: ReferralEventAction;
  detail?: string;
  at: string;
};

/* -------------------------------------------------------------------------- */
/* Settings (administrator-editable)                                          */
/* -------------------------------------------------------------------------- */

export type ReferralSettings = {
  programEnabled: boolean;
  /** CAD cents per plan the REFERRED customer purchased. */
  rewardsCents: Record<PlanId, number>;
  /** Plans whose purchase earns a reward. */
  eligiblePlans: PlanId[];
  /** Days after the qualifying payment before a reward can be approved. */
  holdDays: number;
  /** The referrer must still be an active customer when the reward is approved. */
  requireReferrerActive: boolean;
  /**
   * How gift cards reach the referrer. "none" until one is set up, and nothing
   * can be marked issued while it is "none"; the only supported method is
   * "manual" (an administrator sends the card and records it here).
   */
  fulfillmentMethod: FulfillmentMethod;
  updatedBy?: string;
  updatedAt?: string;
};

export const MAX_REWARD_CENTS = 100_000; // CAD $1,000: guards a typo, not a policy
export const MAX_HOLD_DAYS = 120;

export const DEFAULT_REFERRAL_SETTINGS: ReferralSettings = {
  programEnabled: true,
  rewardsCents: { ...DEFAULT_REFERRAL_REWARDS_CENTS },
  eligiblePlans: [...PLAN_ORDER],
  holdDays: 30,
  requireReferrerActive: true,
  fulfillmentMethod: "none",
};

const planId = z.enum(["starter", "growth", "receptionist"]);
const cents = z.number().int().min(0).max(MAX_REWARD_CENTS);

export const referralSettingsPatchSchema = z
  .object({
    programEnabled: z.boolean(),
    rewardsCents: z.object({
      starter: cents,
      growth: cents,
      receptionist: cents,
    }),
    eligiblePlans: z.array(planId).max(3),
    holdDays: z.number().int().min(0).max(MAX_HOLD_DAYS),
    requireReferrerActive: z.boolean(),
    fulfillmentMethod: z.enum(["none", "manual"]),
  })
  .partial()
  .strict();

export type ReferralSettingsPatch = z.infer<typeof referralSettingsPatchSchema>;

export function mergeSettings(
  current: ReferralSettings,
  patch: ReferralSettingsPatch,
): ReferralSettings {
  return {
    ...current,
    ...patch,
    rewardsCents: { ...current.rewardsCents, ...(patch.rewardsCents ?? {}) },
    eligiblePlans: patch.eligiblePlans
      ? [...new Set(patch.eligiblePlans)]
      : current.eligiblePlans,
  };
}

/** The gift card, in cents, for a purchased plan. Zero = this plan earns nothing. */
export function rewardAmountCents(
  settings: ReferralSettings,
  purchasedPlan: PlanId,
): number {
  if (!settings.programEnabled) return 0;
  if (!settings.eligiblePlans.includes(purchasedPlan)) return 0;
  return settings.rewardsCents[purchasedPlan] ?? 0;
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

/* -------------------------------------------------------------------------- */
/* Identity normalization and fraud signals                                   */
/* -------------------------------------------------------------------------- */

const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "msn.com", "yahoo.com", "yahoo.ca", "icloud.com", "me.com", "aol.com",
  "proton.me", "protonmail.com", "gmx.com", "mail.com", "videotron.ca",
  "bell.net", "sympatico.ca", "rogers.com", "shaw.ca", "telus.net", "cogeco.ca",
]);

/**
 * One mailbox, one identity: lowercase, no "+tag", and for Gmail no dots —
 * so a.b+x@gmail.com and ab@gmail.com are the same person.
 */
export function normalizeEmailIdentity(email: string): string {
  const [localRaw, domainRaw] = email.trim().toLowerCase().split("@");
  if (!localRaw || !domainRaw) return email.trim().toLowerCase();
  let local = localRaw.split("+")[0]!;
  let domain = domainRaw;
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export function emailDomainOf(email: string): string | null {
  const domain = email.trim().toLowerCase().split("@")[1];
  return domain || null;
}

export function normalizePhoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length >= 10 ? digits : null;
}

const COMPANY_SUFFIXES =
  /\b(inc|incorporated|ltd|ltee|ltée|limited|llc|corp|corporation|enr|senc|co|company|cie|plomberie|plumbing)\b/g;

/** "Plomberie Martin Inc." and "martin plumbing" compare equal. */
export function normalizeBusinessName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type PartyFacts = {
  organizationId: string;
  businessName: string;
  ownerEmails: string[];
  phoneE164?: string | null;
  stripeCustomerId?: string | null;
};

export type RiskResult = {
  /** A hard stop: this is the same business or person as the referrer. */
  reject?: Extract<
    RejectionReason,
    "self_referral" | "same_owner" | "same_phone" | "same_billing_customer"
  >;
  /** Soft signals an administrator must acknowledge before approving. */
  flags: ReviewFlag[];
};

/**
 * Self-referral and duplicate-identity check between the referrer and the
 * business that signed up through their link. Hard matches are rejected; looser
 * ones (same company-email domain, near-identical business name) only flag.
 */
export function evaluateReferralRisk(
  referrer: PartyFacts,
  referred: PartyFacts,
): RiskResult {
  if (referrer.organizationId === referred.organizationId) {
    return { reject: "self_referral", flags: [] };
  }
  const referrerEmails = new Set(referrer.ownerEmails.map(normalizeEmailIdentity));
  if (referred.ownerEmails.some((e) => referrerEmails.has(normalizeEmailIdentity(e)))) {
    return { reject: "same_owner", flags: [] };
  }
  const referrerPhone = normalizePhoneDigits(referrer.phoneE164);
  if (referrerPhone && referrerPhone === normalizePhoneDigits(referred.phoneE164)) {
    return { reject: "same_phone", flags: [] };
  }
  if (
    referrer.stripeCustomerId &&
    referrer.stripeCustomerId === referred.stripeCustomerId
  ) {
    return { reject: "same_billing_customer", flags: [] };
  }

  const flags: ReviewFlag[] = [];
  const referrerDomains = new Set(
    referrer.ownerEmails.map(emailDomainOf).filter((d): d is string => !!d && !FREE_MAIL_DOMAINS.has(d)),
  );
  if (
    referred.ownerEmails
      .map(emailDomainOf)
      .some((d) => d && referrerDomains.has(d))
  ) {
    flags.push("same_email_domain");
  }
  const a = normalizeBusinessName(referrer.businessName);
  const b = normalizeBusinessName(referred.businessName);
  if (a && a === b) flags.push("same_business_name");
  return { flags };
}

/* -------------------------------------------------------------------------- */
/* Gift card reference                                                        */
/* -------------------------------------------------------------------------- */

export const giftCardReferenceSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  // An order number or the last characters of a card.
  .regex(/^[\w .#/-]+$/)
  // A full card number in this field would be a secret stored in plain text:
  // refuse any run of 12+ digits, however it is spaced or dashed.
  .refine((value) => !/\d{12,}/.test(value.replace(/[\s-]/g, "")), {
    message: "Do not store a full card number",
  });
