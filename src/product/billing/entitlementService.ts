/**
 * Effective feature access for a business.
 * Combines catalog plan features with verified subscription status.
 * Never trust the frontend for paid feature gates.
 */

import {
  featuresForPlan,
  orgHasFeature,
  upgradePlanForFeature,
  type FeatureId,
  type PlanId,
} from "@/product/saas/entitlements";
import { billingGracePeriodMs } from "./plans";
import type {
  BusinessSubscription,
  EffectiveEntitlements,
  SubscriptionStatus,
} from "./types";

const PAID_ACCESS_STATUSES = new Set<SubscriptionStatus>([
  "active",
  "trialing",
]);

export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return (
    value === "trialing" ||
    value === "active" ||
    value === "incomplete" ||
    value === "incomplete_expired" ||
    value === "past_due" ||
    value === "unpaid" ||
    value === "canceled" ||
    value === "paused" ||
    value === "none"
  );
}

function withinGrace(subscription: BusinessSubscription, now: Date): boolean {
  if (subscription.status !== "past_due") return false;
  if (subscription.gracePeriodEndsAt) {
    return Date.parse(subscription.gracePeriodEndsAt) > now.getTime();
  }
  const updated = Date.parse(subscription.updatedAt);
  if (!Number.isFinite(updated)) return false;
  return now.getTime() - updated < billingGracePeriodMs();
}

function periodStillActive(
  subscription: BusinessSubscription,
  now: Date,
): boolean {
  if (!subscription.currentPeriodEnd) return false;
  return Date.parse(subscription.currentPeriodEnd) > now.getTime();
}

/**
 * Resolve what a business can use right now.
 *
 * - Stripe-backed active/trialing → plan features
 * - past_due inside grace → plan features (accessMode grace)
 * - canceled but period not ended → plan features until period end
 * - No Stripe row → fall back to organization.plan (demo / founder-assigned)
 * - Failed / unpaid / expired → restricted (no paid AI / Growth extras)
 */
export function resolveEffectiveEntitlements(input: {
  businessId: string;
  organizationPlan: PlanId;
  subscription: BusinessSubscription | null;
  now?: Date;
}): EffectiveEntitlements {
  const now = input.now ?? new Date();
  const sub = input.subscription;

  if (!sub || sub.status === "none" || !sub.stripeSubscriptionId) {
    const plan = input.organizationPlan;
    return {
      businessId: input.businessId,
      plan,
      status: sub?.status ?? "none",
      features: featuresForPlan(plan),
      accessMode: "manual",
      reason: "Using organization plan (demo or founder-assigned).",
      gracePeriodEndsAt: sub?.gracePeriodEndsAt ?? null,
      trialEndsAt: sub?.trialEndsAt ?? null,
    };
  }

  if (PAID_ACCESS_STATUSES.has(sub.status)) {
    return {
      businessId: input.businessId,
      plan: sub.plan,
      status: sub.status,
      features: featuresForPlan(sub.plan),
      accessMode: "full",
      reason: null,
      gracePeriodEndsAt: sub.gracePeriodEndsAt,
      trialEndsAt: sub.trialEndsAt,
    };
  }

  if (sub.status === "past_due" && withinGrace(sub, now)) {
    return {
      businessId: input.businessId,
      plan: sub.plan,
      status: sub.status,
      features: featuresForPlan(sub.plan),
      accessMode: "grace",
      reason: "Payment past due — grace period active.",
      gracePeriodEndsAt: sub.gracePeriodEndsAt,
      trialEndsAt: sub.trialEndsAt,
    };
  }

  if (
    (sub.status === "canceled" || sub.cancelAtPeriodEnd) &&
    periodStillActive(sub, now) &&
    sub.status !== "unpaid"
  ) {
    return {
      businessId: input.businessId,
      plan: sub.plan,
      status: sub.status,
      features: featuresForPlan(sub.plan),
      accessMode: "full",
      reason: "Cancellation scheduled; access until period end.",
      gracePeriodEndsAt: sub.gracePeriodEndsAt,
      trialEndsAt: sub.trialEndsAt,
    };
  }

  // Restricted: keep Starter recovery so phones are not abruptly cut off.
  const fallback: PlanId = "starter";
  return {
    businessId: input.businessId,
    plan: fallback,
    status: sub.status,
    features: featuresForPlan(fallback),
    accessMode: "restricted",
    reason: `Subscription status ${sub.status} — paid features restricted.`,
    gracePeriodEndsAt: sub.gracePeriodEndsAt,
    trialEndsAt: sub.trialEndsAt,
  };
}

export function hasEffectiveFeature(
  entitlements: EffectiveEntitlements,
  feature: FeatureId,
): boolean {
  return entitlements.features.includes(feature);
}

export function assertEffectiveFeature(
  entitlements: EffectiveEntitlements,
  feature: FeatureId,
):
  | { ok: true }
  | {
      ok: false;
      feature: FeatureId;
      plan: PlanId;
      upgrade: PlanId;
      accessMode: EffectiveEntitlements["accessMode"];
      reason: string | null;
    } {
  if (hasEffectiveFeature(entitlements, feature)) return { ok: true };
  return {
    ok: false,
    feature,
    plan: entitlements.plan,
    upgrade: upgradePlanForFeature(feature),
    accessMode: entitlements.accessMode,
    reason: entitlements.reason,
  };
}

/** Catalog check only (no subscription status). Prefer assertEffectiveFeature in APIs. */
export function catalogAllowsFeature(plan: PlanId, feature: FeatureId): boolean {
  return orgHasFeature(plan, feature);
}
