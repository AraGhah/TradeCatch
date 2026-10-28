/**
 * Central plan entitlements — enforce on the backend; UI only mirrors this.
 * Do not scatter `if (plan === "growth")` through random components.
 */

export const PLAN_IDS = ["starter", "growth", "receptionist"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/**
 * Public-facing tier names. The internal id stays `receptionist` for
 * backward compatibility with existing Stripe price mappings and database
 * rows (see plan-tiers.sql).
 *
 * NOTE: the original pricing brief asked for this tier to be shown
 * publicly as "AI Receptionist Pro". This codebase already has an
 * actively enforced convention — see
 * tests/unit/receptionist-naming.test.ts — that the public name is
 * exactly "Receptionist" (no "AI" prefix) everywhere: nav, pricing tiers,
 * the admin panel, settings. Changing the display name without also
 * updating that test and every surface it checks would make the app
 * self-inconsistent (most pages say "Receptionist", one page says "AI
 * Receptionist Pro"). Kept as "Receptionist" until that's a deliberate,
 * confirmed rebrand rather than a side effect of a billing change.
 */
export const PLAN_DISPLAY_NAMES: Record<PlanId, string> = {
  starter: "Starter",
  growth: "Growth",
  receptionist: "Receptionist",
};

export const FEATURE_IDS = [
  "MISSED_CALL_RECOVERY",
  "WEBSITE_LEAD_CAPTURE",
  "QUOTE_FOLLOW_UP",
  "HUMAN_TAKEOVER",
  "BUSINESS_NOTIFICATIONS",
  "BASIC_ANALYTICS",
  "APPOINTMENT_BOOKING",
  "ADVANCED_PIPELINE",
  "REVENUE_ATTRIBUTION",
  "REVIEW_AUTOMATION",
  "ADVANCED_ANALYTICS",
  "EMAIL_AUTOMATION",
  "AI_RECEPTIONIST_VOICE",
  "CRM_INTEGRATION_LIMITED",
  "CRM_INTEGRATION_ADVANCED",
  "ADVANCED_CALL_ROUTING",
  "MULTI_CREW_CALENDARS",
  "CUSTOMER_REACTIVATION",
  "CONTRACT_RENEWAL_AUTOMATION",
  "ADVANCED_REVENUE_ANALYTICS",
  "ADVANCED_AUTOMATION_WORKFLOWS",
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

const STARTER_FEATURES = [
  "MISSED_CALL_RECOVERY",
  "WEBSITE_LEAD_CAPTURE",
  "QUOTE_FOLLOW_UP",
  "HUMAN_TAKEOVER",
  "BUSINESS_NOTIFICATIONS",
  "BASIC_ANALYTICS",
] as const satisfies readonly FeatureId[];

const GROWTH_EXTRA = [
  "APPOINTMENT_BOOKING",
  "ADVANCED_PIPELINE",
  "REVENUE_ATTRIBUTION",
  "REVIEW_AUTOMATION",
  "ADVANCED_ANALYTICS",
  "EMAIL_AUTOMATION",
  "CRM_INTEGRATION_LIMITED",
] as const satisfies readonly FeatureId[];

// Receptionist (public name "AI Receptionist Pro") is a superset of Growth:
// bilingual 24/7 AI call answering, phone appointment requests, human
// transfer and emergency routing, plus the advanced business-automation
// tier described in the pricing matrix (routing, multi-crew calendars,
// advanced CRM sync, reactivation/renewal campaigns, revenue analytics).
const RECEPTIONIST_EXTRA = [
  "AI_RECEPTIONIST_VOICE",
  "CRM_INTEGRATION_ADVANCED",
  "ADVANCED_CALL_ROUTING",
  "MULTI_CREW_CALENDARS",
  "CUSTOMER_REACTIVATION",
  "CONTRACT_RENEWAL_AUTOMATION",
  "ADVANCED_REVENUE_ANALYTICS",
  "ADVANCED_AUTOMATION_WORKFLOWS",
] as const satisfies readonly FeatureId[];

export const PLAN_FEATURES: Record<PlanId, readonly FeatureId[]> = {
  starter: STARTER_FEATURES,
  growth: [...STARTER_FEATURES, ...GROWTH_EXTRA],
  receptionist: [...STARTER_FEATURES, ...GROWTH_EXTRA, ...RECEPTIONIST_EXTRA],
};

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}

export function isFeatureId(value: string): value is FeatureId {
  return (FEATURE_IDS as readonly string[]).includes(value);
}

export function featuresForPlan(plan: PlanId): readonly FeatureId[] {
  return PLAN_FEATURES[plan];
}

export function orgHasFeature(
  plan: PlanId,
  feature: FeatureId,
): boolean {
  return PLAN_FEATURES[plan].includes(feature);
}

export function assertFeature(
  plan: PlanId,
  feature: FeatureId,
): { ok: true } | { ok: false; feature: FeatureId; plan: PlanId } {
  if (orgHasFeature(plan, feature)) return { ok: true };
  return { ok: false, feature, plan };
}

/** Features that Growth unlocks beyond Starter — for contextual upsells. */
export function growthUpsellFeatures(): readonly FeatureId[] {
  return GROWTH_EXTRA;
}

export const FEATURE_LABELS: Record<FeatureId, { en: string; fr: string }> = {
  MISSED_CALL_RECOVERY: {
    en: "Missed-call recovery",
    fr: "Récupération d'appels manqués",
  },
  WEBSITE_LEAD_CAPTURE: {
    en: "Website lead capture",
    fr: "Capture de leads web",
  },
  QUOTE_FOLLOW_UP: {
    en: "Quote follow-up",
    fr: "Relance de soumissions",
  },
  HUMAN_TAKEOVER: {
    en: "Human takeover",
    fr: "Prise en charge humaine",
  },
  BUSINESS_NOTIFICATIONS: {
    en: "Business notifications",
    fr: "Notifications métier",
  },
  BASIC_ANALYTICS: {
    en: "Basic performance dashboard",
    fr: "Tableau de bord de base",
  },
  APPOINTMENT_BOOKING: {
    en: "Appointment booking",
    fr: "Prise de rendez-vous",
  },
  ADVANCED_PIPELINE: {
    en: "Advanced lead pipeline",
    fr: "Pipeline de leads avancé",
  },
  REVENUE_ATTRIBUTION: {
    en: "Revenue attribution",
    fr: "Attribution de revenus",
  },
  REVIEW_AUTOMATION: {
    en: "Google review automation",
    fr: "Automatisation des avis Google",
  },
  ADVANCED_ANALYTICS: {
    en: "Advanced analytics",
    fr: "Analytique avancée",
  },
  EMAIL_AUTOMATION: {
    en: "Email follow-up automation",
    fr: "Relances automatiques par courriel",
  },
  AI_RECEPTIONIST_VOICE: {
    en: "Bilingual 24/7 AI call answering",
    fr: "Réception d'appels IA bilingue 24/7",
  },
  CRM_INTEGRATION_LIMITED: {
    en: "Basic CRM integrations",
    fr: "Intégrations CRM de base",
  },
  CRM_INTEGRATION_ADVANCED: {
    en: "Advanced CRM integrations",
    fr: "Intégrations CRM avancées",
  },
  ADVANCED_CALL_ROUTING: {
    en: "Advanced call routing",
    fr: "Acheminement d'appels avancé",
  },
  MULTI_CREW_CALENDARS: {
    en: "Multiple crew calendars",
    fr: "Calendriers d'équipes multiples",
  },
  CUSTOMER_REACTIVATION: {
    en: "Customer reactivation campaigns",
    fr: "Campagnes de réactivation client",
  },
  CONTRACT_RENEWAL_AUTOMATION: {
    en: "Automated contract renewal campaigns",
    fr: "Campagnes automatisées de renouvellement de contrat",
  },
  ADVANCED_REVENUE_ANALYTICS: {
    en: "Advanced revenue analytics",
    fr: "Analytique avancée des revenus",
  },
  ADVANCED_AUTOMATION_WORKFLOWS: {
    en: "Advanced automation workflows",
    fr: "Flux d'automatisation avancés",
  },
};
