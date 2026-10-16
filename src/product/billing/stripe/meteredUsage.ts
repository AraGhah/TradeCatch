/**
 * Optional Stripe metered usage reporting.
 * TradeCatch tracks usage locally first; enable metered prices only after
 * reconciliation is verified.
 */

import type Stripe from "stripe";
import type { UsageMetric } from "../types";

export async function reportMeteredUsageQuantity(input: {
  stripe: Stripe;
  subscriptionItemId: string;
  quantity: number;
  timestamp?: number;
  action?: "increment" | "set";
  idempotencyKey?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.quantity <= 0) return { ok: true };
  try {
    await input.stripe.subscriptionItems.createUsageRecord(
      input.subscriptionItemId,
      {
        quantity: Math.ceil(input.quantity),
        timestamp: input.timestamp ?? Math.floor(Date.now() / 1000),
        action: input.action ?? "increment",
      },
      input.idempotencyKey
        ? { idempotencyKey: input.idempotencyKey }
        : undefined,
    );
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "metered_usage_failed",
    };
  }
}

export function meteredItemEnvKey(metric: UsageMetric): string {
  if (metric === "ai_call_minutes") return "STRIPE_METERED_PRICE_AI_MINUTES";
  if (metric === "sms_segments") return "STRIPE_METERED_PRICE_SMS";
  return "STRIPE_METERED_PRICE_TELEPHONE_MINUTES";
}
