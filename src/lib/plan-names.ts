/**
 * The only place a plan's customer-facing NAME is defined.
 *
 * TradeCatch sells two plans: Essential and Professional. The earlier plans
 * (starter, growth, receptionist) are LEGACY internal ids. They stay valid in
 * the database, in Stripe price mappings and in the entitlement table so no
 * existing organization, subscription or invoice changes, but a customer never
 * sees a retired name: every legacy id is shown under the public plan it sits
 * closest to.
 *
 * This is a LABEL mapping only. It grants and removes nothing: what a legacy
 * organization can actually use still comes from PLAN_FEATURES in
 * src/product/saas/entitlements.ts, and the dashboard lists exactly those
 * features (see describePlan in plan-catalog.ts), never the public plan's list.
 * tests/unit/plan-sync.test.ts (PLAN-05) fails if this table stops covering
 * every internal id.
 *
 * Kept free of runtime imports on purpose: client components (the app shell)
 * import it, and it must not pull server-only modules into the browser bundle.
 */
import type {
  LegacyPlanId,
  PlanId,
  PublicPlanId,
} from "@/product/saas/entitlements";

/** The names printed on the website, the dashboard and every email. */
export const PUBLIC_PLAN_NAMES = {
  essential: "Essential",
  professional: "Professional",
} as const satisfies Record<PublicPlanId, string>;

/**
 * Which public name a retired plan is shown under.
 *   starter      entry plan                     -> Essential
 *   growth       mid plan (calendar, no phone booking) -> Professional
 *   receptionist top plan (everything Professional has)  -> Professional
 * Change a line here to relabel; nothing else needs to move.
 */
export const LEGACY_PLAN_PUBLIC_NAME = {
  starter: "essential",
  growth: "professional",
  receptionist: "professional",
} as const satisfies Record<LegacyPlanId, PublicPlanId>;

export function isLegacyPlan(plan: PlanId): plan is LegacyPlanId {
  return plan in LEGACY_PLAN_PUBLIC_NAME;
}

/** The public plan a customer on `plan` is told they have. */
export function publicPlanFor(plan: PlanId): PublicPlanId {
  return isLegacyPlan(plan) ? LEGACY_PLAN_PUBLIC_NAME[plan] : plan;
}

/** "Essential" or "Professional", whatever the internal id is. */
export function planDisplayName(plan: PlanId): string {
  return PUBLIC_PLAN_NAMES[publicPlanFor(plan)];
}

/**
 * Same as planDisplayName for a value that is only typed as a string (a prop, a
 * database column read loosely). An id nobody knows has no name: it returns
 * null rather than guessing a paid plan the customer may not have.
 */
export function planNameOrNull(plan: string): string | null {
  if (plan in PUBLIC_PLAN_NAMES) return PUBLIC_PLAN_NAMES[plan as PublicPlanId];
  if (plan in LEGACY_PLAN_PUBLIC_NAME) {
    return PUBLIC_PLAN_NAMES[LEGACY_PLAN_PUBLIC_NAME[plan as LegacyPlanId]];
  }
  return null;
}
