/**
 * The single source of truth for what each plan IS on the public site and in
 * the dashboard: its price, what it includes and what a referral to it earns.
 *
 * Nothing here is invented. Prices come from src/lib/plans.ts and what a plan
 * can do comes from src/product/saas/entitlements.ts (the same table the
 * backend enforces). Every capability shown on a pricing card or in the
 * comparison table is mapped to an entitlement, and tests/unit/plan-catalog.test.ts
 * fails if the site would advertise something a plan does not actually have.
 *
 * Launch offering: Essential (answers calls and captures customers) and
 * Professional (answers calls and manages appointments). The earlier Starter,
 * Growth and Receptionist plans are legacy ids that keep working for existing
 * customers but are never listed here.
 *
 * Change a plan's price in plans.ts, its features in entitlements.ts, its
 * wording in src/messages/{en,fr}.json (namespace `plans`), or its referral
 * reward / add-on below. The pricing page, home page, How It Works page,
 * referral page and dashboard follow without further edits.
 */
import { PLAN_PRICES } from "@/lib/plans";
import {
  PLAN_FEATURES,
  PLAN_IDS,
  PUBLIC_PLAN_IDS,
  orgHasFeature,
  type FeatureId,
  type PlanId,
  type PublicPlanId,
} from "./entitlements";

export { PLAN_IDS, PUBLIC_PLAN_IDS };
export type { PlanId, PublicPlanId };

/** Display order of the plans sold on the public site: Essential, then Professional. */
export const PLAN_ORDER: readonly PublicPlanId[] = PUBLIC_PLAN_IDS;

/** The plan that gets the strongest visual emphasis everywhere. */
export const PREMIUM_PLAN: PublicPlanId = "professional";

/** What the customer's phone line is doing for them on this plan. */
export type PlanChannel =
  | "voice-answering"
  | "voice-booking"
  /** Legacy plans: shown only on an existing customer's own billing page. */
  | "sms"
  | "voice-essentials"
  | "voice-complete";

export const PLAN_CHANNEL: Record<PlanId, PlanChannel> = {
  essential: "voice-answering",
  professional: "voice-booking",
  starter: "sms",
  growth: "voice-essentials",
  receptionist: "voice-complete",
};

/* -------------------------------------------------------------------------- */
/* Capabilities                                                               */
/* -------------------------------------------------------------------------- */

export type CapabilityGroup = "answering" | "dashboard" | "appointments";

export type Capability = {
  /** Message key: plans.capabilities.<id> */
  id: string;
  group: CapabilityGroup;
  /** The entitlement that backs this line. */
  feature: FeatureId;
};

/**
 * Every line the pricing page can show, in display order. A line is "included"
 * for a plan only when the plan really holds the backing entitlement, so
 * Essential can never show an appointment line and Professional can never lose
 * one silently.
 */
export const CAPABILITIES = [
  // Essential: answers calls and captures customers
  { id: "answersCalls", group: "answering", feature: "AI_RECEPTIONIST_VOICE" },
  { id: "frenchEnglish", group: "answering", feature: "AI_RECEPTIONIST_VOICE" },
  { id: "naturalVoice", group: "answering", feature: "AI_RECEPTIONIST_VOICE" },
  { id: "captureDetails", group: "answering", feature: "AI_RECEPTIONIST_VOICE" },
  { id: "serviceRequests", group: "answering", feature: "AI_RECEPTIONIST_VOICE" },
  { id: "urgentRequests", group: "answering", feature: "AI_RECEPTIONIST_VOICE" },
  { id: "missedCalls", group: "answering", feature: "MISSED_CALL_RECOVERY" },
  { id: "smsFollowUps", group: "answering", feature: "QUOTE_FOLLOW_UP" },
  { id: "dashboard", group: "dashboard", feature: "BASIC_ANALYTICS" },
  { id: "callHistory", group: "dashboard", feature: "AI_CALL_TRANSCRIPTS" },
  { id: "requestsList", group: "dashboard", feature: "BASIC_ANALYTICS" },
  { id: "basicStats", group: "dashboard", feature: "BASIC_ANALYTICS" },
  { id: "accountCenter", group: "dashboard", feature: "BUSINESS_NOTIFICATIONS" },
  { id: "billingManagement", group: "dashboard", feature: "BUSINESS_NOTIFICATIONS" },
  { id: "businessInfo", group: "dashboard", feature: "BUSINESS_NOTIFICATIONS" },
  // Professional: answers calls and manages appointments
  { id: "autoScheduling", group: "appointments", feature: "AI_PHONE_BOOKING" },
  { id: "googleCalendar", group: "appointments", feature: "APPOINTMENT_BOOKING" },
  { id: "availabilityCheck", group: "appointments", feature: "APPOINTMENT_BOOKING" },
  { id: "rescheduleCancel", group: "appointments", feature: "APPOINTMENT_BOOKING" },
  { id: "smsConfirmations", group: "appointments", feature: "APPOINTMENT_BOOKING" },
  { id: "reminders", group: "appointments", feature: "APPOINTMENT_BOOKING" },
  { id: "appointmentFollowUps", group: "appointments", feature: "APPOINTMENT_BOOKING" },
  { id: "calendarView", group: "appointments", feature: "APPOINTMENT_BOOKING" },
  { id: "appointmentHistory", group: "appointments", feature: "APPOINTMENT_BOOKING" },
  { id: "appointmentStats", group: "appointments", feature: "APPOINTMENT_BOOKING" },
  { id: "schedulingRules", group: "appointments", feature: "APPOINTMENT_BOOKING" },
] as const satisfies readonly Capability[];

export type CapabilityId = (typeof CAPABILITIES)[number]["id"];

export type Availability = "included" | "none";

const CAPABILITY_BY_ID = new Map<string, Capability>(
  CAPABILITIES.map((c) => [c.id, c]),
);

export function getCapability(id: string): Capability {
  const found = CAPABILITY_BY_ID.get(id);
  if (!found) throw new Error(`Unknown plan capability: ${id}`);
  return found;
}

/** What a plan really has: derived from the enforced entitlements, never typed by hand. */
export function capabilityAvailability(
  plan: PlanId,
  capability: Capability,
): Availability {
  return orgHasFeature(plan, capability.feature) ? "included" : "none";
}

/* -------------------------------------------------------------------------- */
/* Plans                                                                      */
/* -------------------------------------------------------------------------- */

export type PlanDefinition = {
  id: PublicPlanId;
  channel: PlanChannel;
  /** Intake value the pricing CTA carries into /book-audit. */
  planInterest: PublicPlanId;
  emphasis: "standard" | "featured";
  /**
   * The capabilities shown on this plan's card, in display order. A short list:
   * Professional's card starts from "Everything in Essential" and lists only
   * what it ADDS. The comparison table shows every line.
   */
  cardCapabilities: readonly CapabilityId[];
};

export const PLAN_CATALOG: Record<PublicPlanId, PlanDefinition> = {
  essential: {
    id: "essential",
    channel: "voice-answering",
    planInterest: "essential",
    emphasis: "standard",
    cardCapabilities: [
      "answersCalls",
      "frenchEnglish",
      "captureDetails",
      "urgentRequests",
      "missedCalls",
      "smsFollowUps",
      "dashboard",
      "accountCenter",
    ],
  },
  professional: {
    id: "professional",
    channel: "voice-booking",
    planInterest: "professional",
    emphasis: "featured",
    cardCapabilities: [
      "autoScheduling",
      "googleCalendar",
      "availabilityCheck",
      "rescheduleCancel",
      "smsConfirmations",
      "reminders",
      "calendarView",
      "schedulingRules",
    ],
  },
};

export function isCapabilityIncluded(plan: PlanId, id: CapabilityId): boolean {
  return capabilityAvailability(plan, getCapability(id)) === "included";
}

/** The launch plans in display order with their price and definition. */
export function listPlans() {
  return PLAN_ORDER.map((id) => ({
    ...PLAN_CATALOG[id],
    price: PLAN_PRICES[id],
    features: PLAN_FEATURES[id],
  }));
}

/** The previous plan in the ladder, or null for the entry plan. */
export function previousPlan(plan: PlanId): PublicPlanId | null {
  const index = (PLAN_ORDER as readonly string[]).indexOf(plan);
  return index > 0 ? PLAN_ORDER[index - 1]! : null;
}

/** Monthly and setup difference between a plan and the one below it. */
export function stepUp(plan: PlanId) {
  const prev = previousPlan(plan);
  if (!prev) return null;
  return {
    from: prev,
    monthly: round2(PLAN_PRICES[plan].monthly - PLAN_PRICES[prev].monthly),
    installation: round2(PLAN_PRICES[plan].setup - PLAN_PRICES[prev].setup),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

/** True for the two plans the public site sells. */
export function isSoldPlan(value: unknown): value is PublicPlanId {
  return (
    typeof value === "string" && (PUBLIC_PLAN_IDS as readonly string[]).includes(value)
  );
}

/* -------------------------------------------------------------------------- */
/* Billing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The billing arrangement, stated once so every page says the same thing: the
 * one-time setup fee is the only thing charged at checkout, and the monthly
 * subscription is created with its first invoice deferred one calendar month
 * (see stripe-checkout.ts). The date of the first monthly charge is shown on
 * the customer's billing page. An administrator can move it before the
 * subscription is created (tc_billing_deferrals).
 */
export const BILLING_ARRANGEMENT = {
  installationPaid: "at-checkout",
  subscriptionStarts: "one-month-after-setup",
} as const;

/* -------------------------------------------------------------------------- */
/* Add-ons                                                                    */
/* -------------------------------------------------------------------------- */

export type BillingSchedule = "one-time" | "monthly" | "annual";

export type AddOnDefinition = {
  id: string;
  /** The price in CAD. */
  priceCad: number;
  /**
   * True when `priceCad` is a "starting at" price and the final price is
   * confirmed first. The website service is a fixed price, so this is false.
   */
  priceIsStartingAt: boolean;
  /** How the add-on is billed. */
  billingSchedule: BillingSchedule | null;
  /** Plans that include it at no charge. Always empty: add-ons are opt-in. */
  includedInPlans: readonly PlanId[];
  /** Plans it can be added to. */
  availableOn: readonly PlanId[];
};

export const ADD_ONS = {
  /**
   * Website service: TradeCatch builds a new site or improves the customer's
   * existing one. It is an optional one-time project at a fixed price, never
   * part of a subscription and never charged unless the customer asks for it
   * (see src/product/website-services).
   */
  websiteService: {
    id: "websiteService",
    priceCad: 349.99,
    priceIsStartingAt: false,
    billingSchedule: "one-time",
    includedInPlans: [],
    availableOn: PUBLIC_PLAN_IDS,
  },
} as const satisfies Record<string, AddOnDefinition>;

export type AddOnId = keyof typeof ADD_ONS;

/* -------------------------------------------------------------------------- */
/* Referral rewards                                                           */
/* -------------------------------------------------------------------------- */

/** Interac e-Transfer reward for a referred customer's paid plan, in CAD cents. */
export const REFERRAL_PLAN_REWARD_CENTS = 6_500;
/** Extra reward when the referred customer also buys the website service. */
export const REFERRAL_WEBSITE_BONUS_CENTS = 3_500;
/** The most one referral can ever earn: plan reward plus website bonus. */
export const REFERRAL_MAX_REWARD_CENTS =
  REFERRAL_PLAN_REWARD_CENTS + REFERRAL_WEBSITE_BONUS_CENTS;

/**
 * Default reward per plan PURCHASED BY THE REFERRED CUSTOMER, in CAD cents.
 * Essential and Professional earn the same $65. The legacy plans are listed so
 * the table stays total; they are not sold, so they are never paid out in
 * practice. An administrator can change these in the referral settings; the
 * values here seed the program and are what the public page shows until then.
 */
export const DEFAULT_REFERRAL_REWARDS_CENTS: Record<PlanId, number> = {
  essential: REFERRAL_PLAN_REWARD_CENTS,
  professional: REFERRAL_PLAN_REWARD_CENTS,
  starter: REFERRAL_PLAN_REWARD_CENTS,
  growth: REFERRAL_PLAN_REWARD_CENTS,
  receptionist: REFERRAL_PLAN_REWARD_CENTS,
};
