/**
 * Marketing views derived from the plan catalog + entitlements. Pricing cards
 * and the comparison table read these helpers so the site cannot advertise a
 * capability a plan does not actually have.
 */
import {
  ADD_ONS,
  CAPABILITIES,
  PLAN_CATALOG,
  PLAN_ORDER,
  PREMIUM_PLAN,
  capabilityAvailability,
  type Availability,
  type CapabilityId,
  type PlanId,
} from "@/product/saas/plan-catalog";

export type ComparisonMark = "y" | "n";

const AVAILABILITY_TO_MARK: Record<Availability, ComparisonMark> = {
  included: "y",
  none: "n",
};

/** Comparison rows in catalog order, one row per capability. */
export function comparisonRowsFromCatalog(): {
  capabilityId: CapabilityId;
  values: ComparisonMark[];
}[] {
  return CAPABILITIES.map((capability) => ({
    capabilityId: capability.id as CapabilityId,
    values: PLAN_ORDER.map(
      (plan) => AVAILABILITY_TO_MARK[capabilityAvailability(plan, capability)],
    ),
  }));
}

export function planCardCapabilityIds(
  plan: keyof typeof PLAN_CATALOG,
): readonly CapabilityId[] {
  return PLAN_CATALOG[plan].cardCapabilities;
}

export function websiteServiceAddOn() {
  return ADD_ONS.websiteService;
}

export { PLAN_ORDER, PREMIUM_PLAN, PLAN_CATALOG };
export type { PlanId, CapabilityId };
