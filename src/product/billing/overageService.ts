import { getPlanDefinition } from "./plans";
import type { UsageMetric, UsageSummary } from "./types";
import type { PlanId } from "@/product/saas/entitlements";

export function estimateOverageCharges(
  plan: PlanId,
  usage: UsageSummary,
): {
  totalCents: number;
  lines: Array<{ metric: UsageMetric; quantity: number; amountCents: number }>;
} {
  const def = getPlanDefinition(plan);
  const lines = usage.metrics
    .filter((m) => m.overage > 0)
    .map((m) => ({
      metric: m.metric,
      quantity: m.overage,
      amountCents: m.overage * (def.overageRatesCents[m.metric] ?? 0),
    }));
  return {
    totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
    lines,
  };
}

/**
 * Metered Stripe reporting is optional. TradeCatch always tracks usage locally;
 * call this only when metered prices are configured and verified.
 */
export function shouldReportMeteredUsage(
  plan: PlanId,
  metric: UsageMetric,
): boolean {
  const def = getPlanDefinition(plan);
  return (
    def.usagePolicy === "paid_overage" &&
    (def.overageRatesCents[metric] ?? 0) > 0
  );
}
