import type { PlanId } from "@/product/saas/entitlements";
import { getPlanDefinition } from "../plans";
import type { BillingInterval } from "../types";
import {
  approvedPriceIdForPlan,
  readStripeConfig,
} from "./config";
import type { StripePort } from "./stripeClient";

export type CheckoutRequest = {
  businessId: string;
  plan: PlanId;
  interval: BillingInterval;
  customerEmail: string;
  customerName: string;
  successUrl: string;
  cancelUrl: string;
  /** When true, attach configured trial_period_days for the plan. */
  withTrial?: boolean;
  idempotencyKey?: string;
  existingStripeCustomerId?: string | null;
};

export async function createSubscriptionCheckoutSession(
  stripe: StripePort,
  input: CheckoutRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<
  | { ok: true; sessionId: string; url: string; stripeCustomerId: string }
  | { ok: false; error: string; status: number }
> {
  const price = approvedPriceIdForPlan(input.plan, input.interval, env);
  if (!price.ok) {
    return { ok: false, error: price.error, status: 503 };
  }

  const config = readStripeConfig(env);
  if (config.mode === "unset" && !env.BILLING_ALLOW_MEMORY_STRIPE) {
    // Memory Stripe port is still usable in tests via injected stripe arg.
  }

  let customerId = input.existingStripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe.createCustomer({
      email: input.customerEmail,
      name: input.customerName,
      metadata: {
        businessId: input.businessId,
        tradecatch: "1",
      },
      idempotencyKey: input.idempotencyKey
        ? `cust_${input.idempotencyKey}`
        : `cust_${input.businessId}`,
    });
    customerId = customer.id;
  }

  const planDef = getPlanDefinition(input.plan);
  const trialDays =
    input.withTrial && planDef.trialDays > 0 ? planDef.trialDays : undefined;

  const session = await stripe.createCheckoutSession({
    customerId,
    priceId: price.priceId,
    mode: "subscription",
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    trialPeriodDays: trialDays,
    metadata: {
      businessId: input.businessId,
      plan: input.plan,
      interval: input.interval,
    },
    subscriptionMetadata: {
      businessId: input.businessId,
      plan: input.plan,
      interval: input.interval,
    },
    automaticTax: config.automaticTax,
    clientReferenceId: input.businessId,
    idempotencyKey: input.idempotencyKey
      ? `checkout_${input.idempotencyKey}`
      : undefined,
  });

  if (!session.url) {
    return {
      ok: false,
      error: "Stripe Checkout session missing redirect URL.",
      status: 502,
    };
  }

  return {
    ok: true,
    sessionId: session.id,
    url: session.url,
    stripeCustomerId: customerId,
  };
}
