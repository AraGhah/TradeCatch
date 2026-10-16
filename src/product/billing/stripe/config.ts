import type { PlanId } from "@/product/saas/entitlements";
import type { BillingInterval } from "../types";
import { resolveStripePriceId, stripePriceEnvKey } from "../plans";

export type StripeBillingConfig = {
  secretKey: string | null;
  webhookSecret: string | null;
  publishableKey: string | null;
  portalConfigurationId: string | null;
  automaticTax: boolean;
  mode: "test" | "live" | "unset";
};

export function readStripeConfig(
  env: NodeJS.ProcessEnv = process.env,
): StripeBillingConfig {
  const secretKey = env.STRIPE_SECRET_KEY?.trim() || null;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() || null;
  const publishableKey =
    env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ||
    env.STRIPE_PUBLISHABLE_KEY?.trim() ||
    null;
  const mode = !secretKey
    ? "unset"
    : secretKey.startsWith("sk_live_")
      ? "live"
      : "test";

  return {
    secretKey,
    webhookSecret,
    publishableKey,
    portalConfigurationId: env.STRIPE_PORTAL_CONFIGURATION_ID?.trim() || null,
    automaticTax: env.STRIPE_AUTOMATIC_TAX === "1",
    mode,
  };
}

export function assertTestCredentialsSeparation(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true } | { ok: false; error: string } {
  const secret = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const pub =
    env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ||
    env.STRIPE_PUBLISHABLE_KEY?.trim() ||
    "";
  if (secret.startsWith("sk_live_") && pub.startsWith("pk_test_")) {
    return {
      ok: false,
      error: "Live Stripe secret mixed with test publishable key.",
    };
  }
  if (secret.startsWith("sk_test_") && pub.startsWith("pk_live_")) {
    return {
      ok: false,
      error: "Test Stripe secret mixed with live publishable key.",
    };
  }
  const tradecatchEnv = (
    env.TRADECATCH_ENV ||
    env.NEXT_PUBLIC_TRADECATCH_ENV ||
    ""
  ).toLowerCase();
  if (
    (tradecatchEnv === "staging" || tradecatchEnv === "development") &&
    secret.startsWith("sk_live_")
  ) {
    return {
      ok: false,
      error: "Live Stripe credentials are not allowed in staging/development.",
    };
  }
  return { ok: true };
}

export function approvedPriceIdForPlan(
  plan: PlanId,
  interval: BillingInterval,
  env: NodeJS.ProcessEnv = process.env,
):
  | { ok: true; priceId: string }
  | { ok: false; error: string; envKey: string } {
  const envKey = stripePriceEnvKey(plan, interval);
  const priceId = resolveStripePriceId(plan, interval, env);
  if (!priceId) {
    return {
      ok: false,
      error: `Missing approved Stripe price for ${plan}/${interval}. Set ${envKey}.`,
      envKey,
    };
  }
  if (priceId.startsWith("price_") === false) {
    return {
      ok: false,
      error: `Invalid Stripe price id for ${envKey}.`,
      envKey,
    };
  }
  return { ok: true, priceId };
}

/** Map a Stripe price id back to an approved TradeCatch plan (server-side). */
export function planFromStripePriceId(
  priceId: string,
  env: NodeJS.ProcessEnv = process.env,
): { plan: PlanId; interval: BillingInterval } | null {
  const plans: PlanId[] = ["starter", "growth", "ai_receptionist"];
  const intervals: BillingInterval[] = ["month", "year"];
  for (const plan of plans) {
    for (const interval of intervals) {
      if (resolveStripePriceId(plan, interval, env) === priceId) {
        return { plan, interval };
      }
    }
  }
  return null;
}
