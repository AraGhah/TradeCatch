/**
 * The single source of truth for what each plan IS on the public site and in
 * the dashboard: its price, what it includes, what its demonstration may show,
 * and what a referral to it earns.
 *
 * Nothing here is invented. Prices come from src/lib/plans.ts and what a plan
 * can do comes from src/product/saas/entitlements.ts (the same table the
 * backend enforces). Every capability shown on a pricing card, in the
 * comparison table or in a plan demonstration is mapped to an entitlement, and
 * tests/unit/plan-catalog.test.ts fails if the site would advertise something
 * a plan does not actually have.
 *
 * Change a plan's price in plans.ts, its features in entitlements.ts, its
 * wording in src/messages/{en,fr}.json (namespace `plans`), or its referral
 * reward / add-on below — the pricing page, home page, How It Works page,
 * referral page and dashboard follow without further edits.
 */
import { PLAN_PRICES } from "@/lib/plans";
import {
  PLAN_FEATURES,
  PLAN_IDS,
  orgHasFeature,
  type FeatureId,
  type PlanId,
} from "./entitlements";

export { PLAN_IDS };
export type { PlanId };

/** Display order: cheapest first, the premium plan last. */
export const PLAN_ORDER: readonly PlanId[] = PLAN_IDS;

/** The premium plan gets the strongest visual emphasis everywhere. */
export const PREMIUM_PLAN: PlanId = "receptionist";

/** What the customer's phone line is doing for them on this plan. */
export type PlanChannel = "sms" | "voice-essentials" | "voice-complete";

export const PLAN_CHANNEL: Record<PlanId, PlanChannel> = {
  starter: "sms",
  growth: "voice-essentials",
  receptionist: "voice-complete",
};

/* -------------------------------------------------------------------------- */
/* Capabilities                                                               */
/* -------------------------------------------------------------------------- */

export type CapabilityGroup = "texting" | "workspace" | "voice" | "premium" | "planned";

export type Capability = {
  /** Message key: plans.capabilities.<id>.label */
  id: string;
  group: CapabilityGroup;
  /** The entitlement that backs this line. Absent only for `planned` items. */
  feature?: FeatureId;
  /** Held instead of `feature` = the plan has a smaller version of it. */
  limitedFeature?: FeatureId;
  planned?: true;
};

export const CAPABILITIES = [
  // Texting: the Starter promise
  { id: "missedCallTextBack", group: "texting", feature: "MISSED_CALL_RECOVERY" },
  { id: "bilingualSms", group: "texting", feature: "MISSED_CALL_RECOVERY" },
  { id: "websiteReply", group: "texting", feature: "WEBSITE_LEAD_CAPTURE" },
  { id: "leadQualification", group: "texting", feature: "MISSED_CALL_RECOVERY" },
  { id: "quoteFollowUp", group: "texting", feature: "QUOTE_FOLLOW_UP" },
  { id: "humanTakeover", group: "texting", feature: "HUMAN_TAKEOVER" },
  { id: "leadDashboard", group: "texting", feature: "BASIC_ANALYTICS" },
  // Workspace: what Growth adds around the calendar
  { id: "appointmentBooking", group: "workspace", feature: "APPOINTMENT_BOOKING" },
  { id: "pipeline", group: "workspace", feature: "ADVANCED_PIPELINE" },
  { id: "followUpSequences", group: "workspace", feature: "EMAIL_AUTOMATION" },
  { id: "reviewRequests", group: "workspace", feature: "REVIEW_AUTOMATION" },
  // Voice: the receptionist that answers the phone (Growth: limited)
  { id: "aiAnswersCalls", group: "voice", feature: "AI_RECEPTIONIST_VOICE" },
  { id: "callerDetails", group: "voice", feature: "AI_RECEPTIONIST_VOICE" },
  { id: "businessAnswers", group: "voice", feature: "AI_RECEPTIONIST_VOICE" },
  { id: "appointmentRequests", group: "voice", feature: "AI_RECEPTIONIST_VOICE" },
  { id: "callSummary", group: "voice", feature: "AI_RECEPTIONIST_VOICE" },
  // Premium: the complete receptionist
  { id: "customVoice", group: "premium", feature: "AI_CUSTOM_VOICE" },
  { id: "phoneBooking", group: "premium", feature: "AI_PHONE_BOOKING" },
  { id: "callTransfer", group: "premium", feature: "AI_CALL_TRANSFER" },
  { id: "emergencyRouting", group: "premium", feature: "AI_EMERGENCY_ROUTING" },
  { id: "transcripts", group: "premium", feature: "AI_CALL_TRANSCRIPTS" },
  {
    id: "customerRecords",
    group: "premium",
    feature: "CRM_INTEGRATION_ADVANCED",
    limitedFeature: "CRM_INTEGRATION_LIMITED",
  },
  { id: "crewCalendars", group: "premium", feature: "MULTI_CREW_CALENDARS" },
  { id: "reactivation", group: "premium", feature: "CUSTOMER_REACTIVATION" },
  // Not built yet: shown as "planned", never as included
  { id: "outlookSync", group: "planned", planned: true },
] as const satisfies readonly Capability[];

export type CapabilityId = (typeof CAPABILITIES)[number]["id"];

export type Availability = "included" | "limited" | "none" | "planned";

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
  if (capability.planned) return "planned";
  if (capability.feature && orgHasFeature(plan, capability.feature)) {
    return "included";
  }
  if (capability.limitedFeature && orgHasFeature(plan, capability.limitedFeature)) {
    return "limited";
  }
  return "none";
}

/* -------------------------------------------------------------------------- */
/* Plans                                                                      */
/* -------------------------------------------------------------------------- */

export type PlanDemoMedia = {
  src: string;
  poster: string;
  /** WebVTT captions in the same language. */
  captions: string;
};

export type PlanDefinition = {
  id: PlanId;
  channel: PlanChannel;
  /** Intake value the pricing CTA carries into /book-audit. */
  planInterest: PlanId;
  emphasis: "standard" | "featured" | "premium";
  /** The capabilities this plan ADDS to the previous plan, in display order. */
  cardCapabilities: readonly CapabilityId[];
  demo: {
    /**
     * Capabilities the demonstration shows. Each must be one the plan really
     * has (tests enforce it), so the Growth demo can never show a Receptionist
     * Plus feature.
     */
    capabilities: readonly CapabilityId[];
    /**
     * Live-action film per language. While a film has not been produced the
     * site shows the interactive walkthrough instead; drop the files in
     * /public/demo-video/plans and fill these in to switch the player on.
     */
    media?: Partial<Record<"en" | "fr", PlanDemoMedia>>;
  };
};

export const PLAN_CATALOG: Record<PlanId, PlanDefinition> = {
  starter: {
    id: "starter",
    channel: "sms",
    planInterest: "starter",
    emphasis: "standard",
    cardCapabilities: [
      "missedCallTextBack",
      "bilingualSms",
      "websiteReply",
      "leadQualification",
      "quoteFollowUp",
      "humanTakeover",
    ],
    demo: {
      capabilities: ["missedCallTextBack", "bilingualSms", "leadQualification"],
    },
  },
  growth: {
    id: "growth",
    channel: "voice-essentials",
    planInterest: "growth",
    emphasis: "featured",
    cardCapabilities: [
      "aiAnswersCalls",
      "callerDetails",
      "businessAnswers",
      "appointmentRequests",
      "callSummary",
      "appointmentBooking",
      "pipeline",
      "reviewRequests",
    ],
    demo: {
      capabilities: [
        "aiAnswersCalls",
        "callerDetails",
        "businessAnswers",
        "appointmentRequests",
        "callSummary",
      ],
    },
  },
  receptionist: {
    id: "receptionist",
    channel: "voice-complete",
    planInterest: "receptionist",
    emphasis: "premium",
    cardCapabilities: [
      "customVoice",
      "phoneBooking",
      "callTransfer",
      "emergencyRouting",
      "transcripts",
      "customerRecords",
      "crewCalendars",
      "reactivation",
    ],
    demo: {
      capabilities: [
        "aiAnswersCalls",
        "businessAnswers",
        "callerDetails",
        "phoneBooking",
        "callTransfer",
        "customerRecords",
      ],
    },
  },
};

export function isCapabilityIncluded(plan: PlanId, id: CapabilityId): boolean {
  return capabilityAvailability(plan, getCapability(id)) === "included";
}

/** Plans in display order with their price and definition. */
export function listPlans() {
  return PLAN_ORDER.map((id) => ({
    ...PLAN_CATALOG[id],
    price: PLAN_PRICES[id],
    features: PLAN_FEATURES[id],
  }));
}

/** The previous plan in the ladder, or null for the entry plan. */
export function previousPlan(plan: PlanId): PlanId | null {
  const index = PLAN_ORDER.indexOf(plan);
  return index > 0 ? PLAN_ORDER[index - 1]! : null;
}

/** Monthly and installation difference between a plan and the one below it. */
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

/* -------------------------------------------------------------------------- */
/* Billing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The agreed billing arrangement, stated once: the installation fee is paid in
 * the customer's first month (it is the only thing the Checkout Session
 * charges) and the monthly subscription is created with its first invoice
 * deferred one calendar month (see stripe-checkout.ts).
 */
export const BILLING_ARRANGEMENT = {
  installationPaid: "first-month",
  subscriptionStarts: "second-month",
} as const;

/* -------------------------------------------------------------------------- */
/* Add-ons                                                                    */
/* -------------------------------------------------------------------------- */

export type BillingSchedule = "one-time" | "monthly" | "annual";

export type AddOnDefinition = {
  id: string;
  /**
   * The price in CAD. For a service whose scope is quoted (`priceIsStartingAt`)
   * this is the lowest price, never a promise of the final one.
   */
  priceCad: number;
  /** True when `priceCad` is a "starting at" price: the final price is confirmed first. */
  priceIsStartingAt: boolean;
  /**
   * How the add-on is billed. `null` until it is configured; the site then
   * says the schedule is confirmed in writing before anything is charged and
   * never guesses one.
   */
  billingSchedule: BillingSchedule | null;
  /** Plans that include it at no charge. Always empty: add-ons are opt-in. */
  includedInPlans: readonly PlanId[];
  /** Plans it can be added to. */
  availableOn: readonly PlanId[];
};

export const ADD_ONS = {
  /**
   * Done-for-You Website Service: TradeCatch builds a new site or improves the
   * customer's existing one. It is a separate one-time project, never part of
   * a subscription: nothing is charged until the written scope and final price
   * are confirmed (see src/product/website-services).
   */
  websiteService: {
    id: "websiteService",
    priceCad: 349,
    priceIsStartingAt: true,
    billingSchedule: "one-time",
    includedInPlans: [],
    availableOn: PLAN_IDS,
  },
} as const satisfies Record<string, AddOnDefinition>;

export type AddOnId = keyof typeof ADD_ONS;

/* -------------------------------------------------------------------------- */
/* Referral rewards                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Default Interac e-Transfer per plan PURCHASED BY THE REFERRED CUSTOMER, in
 * CAD cents. An administrator can change these in the referral settings; the
 * values here seed the program and are what the public page shows until then.
 */
export const DEFAULT_REFERRAL_REWARDS_CENTS: Record<PlanId, number> = {
  starter: 5_000,
  growth: 7_500,
  receptionist: 12_500,
};
