import type { PlanId } from "@/product/saas/entitlements";
import type { BillingStore } from "./store";
import type { SubscriptionService } from "./subscriptionService";
import type { StripePort } from "./stripe/stripeClient";
import { planFromStripePriceId } from "./stripe/config";
import type { BillingInterval, CurrencyCode } from "./types";

/**
 * Pull latest Stripe subscription state when a webhook may have been missed.
 * Safe to run periodically for active Stripe-backed accounts.
 */
export async function reconcileBusinessSubscription(input: {
  store: BillingStore;
  subscriptions: SubscriptionService;
  stripe: StripePort;
  businessId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<
  | { ok: true; changed: boolean; status: string }
  | { ok: false; error: string }
> {
  const env = input.env ?? process.env;
  const local = await input.store.getSubscription(input.businessId);
  if (!local?.stripeSubscriptionId) {
    return { ok: false, error: "No Stripe subscription to reconcile." };
  }

  try {
    const sub = await input.stripe.retrieveSubscription(
      local.stripeSubscriptionId,
    );
    const priceId = sub.items.data[0]?.price?.id ?? null;
    const mapped = priceId ? planFromStripePriceId(priceId, env) : null;
    const plan: PlanId =
      (sub.metadata?.plan as PlanId | undefined) &&
      ["starter", "growth", "ai_receptionist"].includes(
        String(sub.metadata?.plan),
      )
        ? (sub.metadata.plan as PlanId)
        : (mapped?.plan ?? local.plan);
    const interval: BillingInterval =
      mapped?.interval ??
      (sub.items.data[0]?.price?.recurring?.interval === "year"
        ? "year"
        : "month");

    const before = JSON.stringify({
      status: local.status,
      plan: local.plan,
      periodEnd: local.currentPeriodEnd,
    });

    await input.subscriptions.applyStripeSubscription({
      businessId: input.businessId,
      stripeCustomerId:
        typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      plan,
      status: sub.status,
      interval,
      currency: (sub.currency as CurrencyCode) || local.currency,
      unitAmountCents: sub.items.data[0]?.price?.unit_amount ?? null,
      currentPeriodStart: sub.current_period_start,
      currentPeriodEnd: sub.current_period_end,
      trialEnd: sub.trial_end,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      canceledAt: sub.canceled_at,
      latestInvoiceId:
        typeof sub.latest_invoice === "string"
          ? sub.latest_invoice
          : sub.latest_invoice?.id ?? null,
      eventType: "reconciliation",
    });

    const afterLocal = await input.store.getSubscription(input.businessId);
    const after = JSON.stringify({
      status: afterLocal?.status,
      plan: afterLocal?.plan,
      periodEnd: afterLocal?.currentPeriodEnd,
    });

    return {
      ok: true,
      changed: before !== after,
      status: afterLocal?.status ?? sub.status,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "reconciliation_failed",
    };
  }
}
