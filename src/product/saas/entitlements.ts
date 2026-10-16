/**
 * Central plan entitlements — enforce on the backend; UI only mirrors this.
 * Do not scatter `if (plan === "growth")` through random components.
 *
 * Billing (Task 10) may further restrict access when a Stripe subscription is
 * past_due / canceled — see `src/product/billing/entitlementService.ts`.
 */

export const PLAN_IDS = ["starter", "growth", "ai_receptionist"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

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
  "AI_PHONE_ANSWERING",
  "AI_APPOINTMENT_BOOKING",
  "AI_CALL_TRANSFER",
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

const STARTER_FEATURES = [
  "MISSED_CALL_RECOVERY",
  "WEBSITE_LEAD_CAPTURE",
  "HUMAN_TAKEOVER",
  "BUSINESS_NOTIFICATIONS",
  "BASIC_ANALYTICS",
] as const satisfies readonly FeatureId[];

const GROWTH_EXTRA = [
  "QUOTE_FOLLOW_UP",
  "APPOINTMENT_BOOKING",
  "ADVANCED_PIPELINE",
  "REVENUE_ATTRIBUTION",
  "REVIEW_AUTOMATION",
  "ADVANCED_ANALYTICS",
  "EMAIL_AUTOMATION",
] as const satisfies readonly FeatureId[];

const AI_RECEPTIONIST_EXTRA = [
  "AI_PHONE_ANSWERING",
  "AI_APPOINTMENT_BOOKING",
  "AI_CALL_TRANSFER",
] as const satisfies readonly FeatureId[];

export const PLAN_FEATURES: Record<PlanId, readonly FeatureId[]> = {
  starter: STARTER_FEATURES,
  growth: [...STARTER_FEATURES, ...GROWTH_EXTRA],
  ai_receptionist: [
    ...STARTER_FEATURES,
    ...GROWTH_EXTRA,
    ...AI_RECEPTIONIST_EXTRA,
  ],
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

/** Features exclusive to the AI Receptionist plan. */
export function aiReceptionistUpsellFeatures(): readonly FeatureId[] {
  return AI_RECEPTIONIST_EXTRA;
}

/** Suggested upgrade plan when a feature is blocked. */
export function upgradePlanForFeature(feature: FeatureId): PlanId {
  if ((AI_RECEPTIONIST_EXTRA as readonly FeatureId[]).includes(feature)) {
    return "ai_receptionist";
  }
  if ((GROWTH_EXTRA as readonly FeatureId[]).includes(feature)) {
    return "growth";
  }
  return "starter";
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
  AI_PHONE_ANSWERING: {
    en: "AI phone answering",
    fr: "Réponse téléphonique par IA",
  },
  AI_APPOINTMENT_BOOKING: {
    en: "AI appointment booking",
    fr: "Prise de rendez-vous par IA",
  },
  AI_CALL_TRANSFER: {
    en: "AI call transfer",
    fr: "Transfert d'appel par IA",
  },
};

export const PLAN_LABELS: Record<PlanId, { en: string; fr: string }> = {
  starter: { en: "Starter", fr: "Starter" },
  growth: { en: "Growth", fr: "Growth" },
  ai_receptionist: { en: "AI Receptionist", fr: "Réceptionniste IA" },
};
