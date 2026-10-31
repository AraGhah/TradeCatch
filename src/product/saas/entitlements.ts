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
 * The premium tier is shown publicly as "Receptionist Plus" (confirmed
 * rebrand; tests/unit/receptionist-naming.test.ts enforces that every surface
 * uses this exact name). The feature itself — the voice receptionist the
 * business owner configures under /app/receptionist — is still just "the
 * Receptionist"; only the plan carries the "Plus".
 */
export const PLAN_DISPLAY_NAMES: Record<PlanId, string> = {
  starter: "Starter",
  growth: "Growth",
  receptionist: "Receptionist Plus",
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
  "AI_PHONE_BOOKING",
  "AI_CALL_TRANSFER",
  "AI_EMERGENCY_ROUTING",
  "AI_CALL_TRANSCRIPTS",
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
  // Growth's limited AI receptionist: it answers the phone in French or
  // English, holds a natural conversation, captures who is calling and what
  // they need, answers from the business's approved information, and sends
  // the team a summary. It does NOT book into the calendar by phone, transfer
  // a live call, bridge emergencies or keep full transcripts — those are the
  // Receptionist Plus features below, and the receptionist runtime enforces
  // the split (see src/product/receptionist/plan-limits.ts).
  "AI_RECEPTIONIST_VOICE",
  "CRM_INTEGRATION_LIMITED",
] as const satisfies readonly FeatureId[];

// Receptionist Plus is a superset of Growth: the complete voice receptionist
// (books the appointment on the call, transfers the call to a person, bridges
// emergencies, keeps full transcripts), plus the advanced business-automation
// tier described in the pricing matrix (routing, multi-crew calendars,
// advanced CRM sync, reactivation/renewal campaigns, revenue analytics).
const RECEPTIONIST_EXTRA = [
  "AI_PHONE_BOOKING",
  "AI_CALL_TRANSFER",
  "AI_EMERGENCY_ROUTING",
  "AI_CALL_TRANSCRIPTS",
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
  AI_PHONE_BOOKING: {
    en: "Appointment booking on the call",
    fr: "Prise de rendez-vous pendant l'appel",
  },
  AI_CALL_TRANSFER: {
    en: "Live call transfer to your team",
    fr: "Transfert d'appel en direct vers votre équipe",
  },
  AI_EMERGENCY_ROUTING: {
    en: "Emergency call routing",
    fr: "Acheminement des appels d'urgence",
  },
  AI_CALL_TRANSCRIPTS: {
    en: "Full call transcripts",
    fr: "Transcriptions complètes des appels",
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
