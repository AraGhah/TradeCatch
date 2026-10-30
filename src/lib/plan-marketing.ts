/**
 * Marketing views derived from the plan catalog + entitlements. Pricing cards,
 * the comparison table and plan demos read these helpers so the site cannot
 * advertise a capability a plan does not actually have.
 */
import {
  ADD_ONS,
  CAPABILITIES,
  PLAN_CATALOG,
  PLAN_ORDER,
  PREMIUM_PLAN,
  capabilityAvailability,
  getCapability,
  type Availability,
  type CapabilityId,
  type PlanId,
} from "@/product/saas/plan-catalog";

export type ComparisonMark = "y" | "n" | "p" | "l";

const AVAILABILITY_TO_MARK: Record<Availability, ComparisonMark> = {
  included: "y",
  limited: "l",
  none: "n",
  planned: "p",
};

/** Comparison rows in catalog order — one row per capability. */
export function comparisonRowsFromCatalog(): {
  capabilityId: CapabilityId;
  values: ComparisonMark[];
}[] {
  return CAPABILITIES.map((capability) => ({
    capabilityId: capability.id as CapabilityId,
    values: PLAN_ORDER.map((plan) =>
      AVAILABILITY_TO_MARK[capabilityAvailability(plan, capability)],
    ),
  }));
}

export function planCardCapabilityIds(plan: PlanId): readonly CapabilityId[] {
  return PLAN_CATALOG[plan].cardCapabilities;
}

export function planDemoCapabilityIds(plan: PlanId): readonly CapabilityId[] {
  return PLAN_CATALOG[plan].demo.capabilities;
}

/** Every demo capability must be included (or limited) for that plan. */
export function demoCapabilitiesAreEntitled(plan: PlanId): boolean {
  return planDemoCapabilityIds(plan).every((id) => {
    const availability = capabilityAvailability(plan, getCapability(id));
    return availability === "included" || availability === "limited";
  });
}

export function websiteBuilderAddOn() {
  return ADD_ONS.websiteBuilder;
}

export { PLAN_ORDER, PREMIUM_PLAN, PLAN_CATALOG };
export type { PlanId, CapabilityId };
