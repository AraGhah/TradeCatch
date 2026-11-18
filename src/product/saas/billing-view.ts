/**
 * What the billing page's plan card says, decided in one pure function so every
 * state a customer can be in is unit-testable without rendering a page or
 * reaching Stripe. The page only turns this into text.
 */
import type { CapabilityId, PlanView } from "./plan-catalog";
import {
  subscriptionStatusKind,
  type SubscriptionStatusKind,
  type SubscriptionSummary,
} from "./billing-summary";

export type BillingPlanCardInput = {
  plan: PlanView;
  /** What Stripe last confirmed, or null (no subscription, or storage is not durable). */
  subscription: SubscriptionSummary | null;
  installation: {
    status: "none" | "pending" | "paid" | "subscribed" | "failed" | "canceled";
    billingStartAt: string | null;
  } | null;
  /** Whether the organization is entitled to the appointment features. */
  hasAppointments: boolean;
};

export type BillingPlanCard = {
  /** A legacy plan shows its name only: those customers keep the price they signed up at. */
  planLine: { kind: "priced"; monthly: number } | { kind: "legacy" };
  status: SubscriptionStatusKind | null;
  /** The one date worth showing, and what it means. */
  date:
    | { kind: "nextCharge" | "cancelsOn" | "firstChargeOn"; iso: string }
    | null;
  /** Offer to start the paid setup, or tell the customer one is already open. */
  checkout: "start" | "pending" | null;
  /** Point a customer without the appointment features at Professional. */
  professionalNote: boolean;
  featureIds: readonly CapabilityId[];
};

export function billingPlanCard(input: BillingPlanCardInput): BillingPlanCard {
  const { plan, subscription, installation } = input;
  const status = subscription ? subscriptionStatusKind(subscription.status) : null;

  let date: BillingPlanCard["date"] = null;
  if (subscription && status === "active" && subscription.currentPeriodEnd) {
    date = {
      kind: subscription.cancelAtPeriodEnd ? "cancelsOn" : "nextCharge",
      iso: subscription.currentPeriodEnd,
    };
  } else if (!subscription && installation?.status === "subscribed" && installation.billingStartAt) {
    // Setup is paid and Stripe's subscription has not been recorded yet: the
    // first monthly charge is the day the installation fee's checkout fixed.
    date = { kind: "firstChargeOn", iso: installation.billingStartAt };
  }

  // Checkout is only ever offered for a catalog-priced plan whose subscription
  // is not already running, so a paying customer cannot be sent to pay twice.
  let checkout: BillingPlanCard["checkout"] = null;
  if (plan.price && status !== "active") {
    if (!installation || ["none", "failed", "canceled"].includes(installation.status)) checkout = "start";
    else if (installation.status === "pending") checkout = "pending";
  }

  return {
    planLine: plan.price ? { kind: "priced", monthly: plan.price.monthly } : { kind: "legacy" },
    status,
    date,
    checkout,
    professionalNote: !input.hasAppointments,
    featureIds: plan.capabilityIds,
  };
}
