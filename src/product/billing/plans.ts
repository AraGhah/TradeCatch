import {
  PLAN_FEATURES,
  type PlanId,
} from "@/product/saas/entitlements";
import type {
  BillingInterval,
  CurrencyCode,
  SubscriptionPlanDefinition,
  UsageMetric,
} from "./types";

/** Published CAD catalog — Stripe Price IDs come from env, never from the client. */
export const SUBSCRIPTION_PLANS: readonly SubscriptionPlanDefinition[] = [
  {
    id: "starter",
    name: { en: "Starter", fr: "Starter" },
    description: {
      en: "Missed-call recovery, lead dashboard, basic SMS and analytics.",
      fr: "Récupération d'appels manqués, tableau de leads, SMS et analytique de base.",
    },
    currency: "cad",
    monthlyPriceCents: 35_000,
    annualPriceCents: 350_000,
    setupFeeCents: 79_999,
    trialDays: 14,
    features: PLAN_FEATURES.starter,
    allowances: {
      ai_call_minutes: 0,
      telephone_minutes: 0,
      sms_segments: 200,
    },
    overageRatesCents: { sms_segments: 5 },
    usagePolicy: "hard_limit",
    employeeLimit: 3,
    taxesNote: {
      en: "Applicable GST/HST and QST are calculated by Stripe Tax from your billing address when TradeCatch is registered to collect them.",
      fr: "La TPS/TVH et la TVQ applicables sont calculées par Stripe Tax selon votre adresse de facturation lorsque TradeCatch est inscrit pour les percevoir.",
    },
    cancellationNote: {
      en: "Cancel anytime in the billing portal. Access continues until the end of the paid period.",
      fr: "Annulez en tout temps dans le portail de facturation. L'accès continue jusqu'à la fin de la période payée.",
    },
  },
  {
    id: "growth",
    name: { en: "Growth", fr: "Growth" },
    description: {
      en: "Everything in Starter plus quote follow-ups, booking, pipeline and advanced analytics.",
      fr: "Tout Starter plus relances de soumissions, rendez-vous, pipeline et analytique avancée.",
    },
    currency: "cad",
    monthlyPriceCents: 75_000,
    annualPriceCents: 750_000,
    setupFeeCents: 149_999,
    trialDays: 14,
    features: PLAN_FEATURES.growth,
    allowances: {
      ai_call_minutes: 0,
      telephone_minutes: 0,
      sms_segments: 1_000,
    },
    overageRatesCents: { sms_segments: 4 },
    usagePolicy: "soft_limit",
    employeeLimit: 15,
    taxesNote: {
      en: "Applicable GST/HST and QST are calculated by Stripe Tax from your billing address when TradeCatch is registered to collect them.",
      fr: "La TPS/TVH et la TVQ applicables sont calculées par Stripe Tax selon votre adresse de facturation lorsque TradeCatch est inscrit pour les percevoir.",
    },
    cancellationNote: {
      en: "Cancel anytime in the billing portal. Access continues until the end of the paid period. Existing leads and appointments are retained.",
      fr: "Annulez en tout temps dans le portail de facturation. L'accès continue jusqu'à la fin de la période payée. Les leads et rendez-vous existants sont conservés.",
    },
  },
  {
    id: "ai_receptionist",
    name: { en: "AI Receptionist", fr: "Réceptionniste IA" },
    description: {
      en: "Everything in Growth plus AI call answering, transfer and appointment capture with a defined minute allowance.",
      fr: "Tout Growth plus réponse d'appels par IA, transfert et capture de rendez-vous avec une allocation de minutes définie.",
    },
    currency: "cad",
    monthlyPriceCents: 75_000,
    annualPriceCents: 750_000,
    setupFeeCents: 149_999,
    trialDays: 7,
    features: PLAN_FEATURES.ai_receptionist,
    allowances: {
      ai_call_minutes: 500,
      telephone_minutes: 500,
      sms_segments: 1_000,
    },
    overageRatesCents: {
      ai_call_minutes: 45,
      telephone_minutes: 20,
      sms_segments: 4,
    },
    usagePolicy: "paid_overage",
    employeeLimit: 25,
    taxesNote: {
      en: "Applicable GST/HST and QST are calculated by Stripe Tax from your billing address when TradeCatch is registered to collect them.",
      fr: "La TPS/TVH et la TVQ applicables sont calculées par Stripe Tax selon votre adresse de facturation lorsque TradeCatch est inscrit pour les percevoir.",
    },
    cancellationNote: {
      en: "Cancel anytime. Paid AI features remain until period end; call routing falls back to a safe forward/voicemail path afterward.",
      fr: "Annulez en tout temps. Les fonctions IA payantes restent jusqu'à la fin de période; l'acheminement bascule ensuite vers un renvoi/messagerie sécurisé.",
    },
  },
] as const;

export function getPlanDefinition(plan: PlanId): SubscriptionPlanDefinition {
  const found = SUBSCRIPTION_PLANS.find((p) => p.id === plan);
  if (!found) throw new Error(`Unknown plan: ${plan}`);
  return found;
}

export function listPlanDefinitions(): SubscriptionPlanDefinition[] {
  return [...SUBSCRIPTION_PLANS];
}

export function priceCentsFor(
  plan: PlanId,
  interval: BillingInterval,
): number {
  const def = getPlanDefinition(plan);
  return interval === "year" ? def.annualPriceCents : def.monthlyPriceCents;
}

export function defaultCurrency(): CurrencyCode {
  const raw = process.env.BILLING_CURRENCY?.trim().toLowerCase();
  return raw === "usd" ? "usd" : "cad";
}

/** Grace period after a failed renewal before restricting paid features (ms). */
export function billingGracePeriodMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const days = Number(env.BILLING_GRACE_PERIOD_DAYS ?? "3");
  if (!Number.isFinite(days) || days < 0) return 3 * 24 * 60 * 60 * 1000;
  return days * 24 * 60 * 60 * 1000;
}

export function stripePriceEnvKey(
  plan: PlanId,
  interval: BillingInterval,
): string {
  const planKey =
    plan === "ai_receptionist" ? "AI_RECEPTIONIST" : plan.toUpperCase();
  const intervalKey = interval === "year" ? "ANNUAL" : "MONTHLY";
  return `STRIPE_PRICE_${planKey}_${intervalKey}`;
}

export function resolveStripePriceId(
  plan: PlanId,
  interval: BillingInterval,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const key = stripePriceEnvKey(plan, interval);
  const value = env[key]?.trim();
  return value || null;
}

export function allowanceFor(
  plan: PlanId,
  metric: UsageMetric,
): number {
  return getPlanDefinition(plan).allowances[metric];
}
