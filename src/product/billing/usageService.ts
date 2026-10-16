import { newId } from "@/product/saas/ids";
import { getPlanDefinition } from "./plans";
import type { BillingStore } from "./store";
import type {
  BillingInterval,
  BusinessSubscription,
  UsageMetric,
  UsageSummary,
} from "./types";
import type { PlanId } from "@/product/saas/entitlements";

const METRICS: UsageMetric[] = [
  "ai_call_minutes",
  "telephone_minutes",
  "sms_segments",
];

export function billingPeriodBounds(
  now: Date,
  interval: BillingInterval = "month",
  anchor?: { start: string | null; end: string | null },
): { start: string; end: string } {
  if (anchor?.start && anchor?.end) {
    const endMs = Date.parse(anchor.end);
    if (Number.isFinite(endMs) && endMs > now.getTime()) {
      return { start: anchor.start, end: anchor.end };
    }
  }
  if (interval === "year") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
    return { start: start.toISOString(), end: end.toISOString() };
  }
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return { start: start.toISOString(), end: end.toISOString() };
}

export function createUsageService(deps: {
  store: BillingStore;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  async function ensureAllowances(
    businessId: string,
    plan: PlanId,
    period: { start: string; end: string },
  ) {
    const def = getPlanDefinition(plan);
    const at = now().toISOString();
    for (const metric of METRICS) {
      await deps.store.saveAllowance({
        businessId,
        plan,
        metric,
        includedQuantity: def.allowances[metric],
        policy: def.usagePolicy,
        overageRateCents: def.overageRatesCents[metric] ?? null,
        periodStart: period.start,
        periodEnd: period.end,
        updatedAt: at,
      });
    }
  }

  return {
    async recordUsage(input: {
      businessId: string;
      metric: UsageMetric;
      quantity: number;
      source: string;
      externalId?: string | null;
      occurredAt?: string;
      plan: PlanId;
      subscription?: BusinessSubscription | null;
    }) {
      if (input.quantity <= 0) {
        return { recorded: false as const, reason: "non_positive" as const };
      }
      const period = billingPeriodBounds(
        now(),
        input.subscription?.billingInterval ?? "month",
        {
          start: input.subscription?.currentPeriodStart ?? null,
          end: input.subscription?.currentPeriodEnd ?? null,
        },
      );
      await ensureAllowances(input.businessId, input.plan, period);

      const decision = await this.evaluateLimit({
        businessId: input.businessId,
        metric: input.metric,
        additional: input.quantity,
        plan: input.plan,
        subscription: input.subscription ?? null,
      });

      // Never cut an in-progress call — callers apply policy to *subsequent* sessions.
      const row = await deps.store.insertUsageRecord({
        id: newId("usage"),
        businessId: input.businessId,
        metric: input.metric,
        quantity: input.quantity,
        source: input.source,
        externalId: input.externalId ?? null,
        occurredAt: input.occurredAt ?? now().toISOString(),
        billingPeriodStart: period.start,
        billingPeriodEnd: period.end,
        createdAt: now().toISOString(),
      });

      if (!row) {
        return {
          recorded: false as const,
          reason: "duplicate" as const,
          decision,
        };
      }
      return { recorded: true as const, record: row, decision };
    },

    async evaluateLimit(input: {
      businessId: string;
      metric: UsageMetric;
      additional?: number;
      plan: PlanId;
      subscription?: BusinessSubscription | null;
    }) {
      const def = getPlanDefinition(input.plan);
      const period = billingPeriodBounds(
        now(),
        input.subscription?.billingInterval ?? "month",
        {
          start: input.subscription?.currentPeriodStart ?? null,
          end: input.subscription?.currentPeriodEnd ?? null,
        },
      );
      const used = await deps.store.sumUsage(
        input.businessId,
        input.metric,
        period.start,
        period.end,
      );
      const included = def.allowances[input.metric];
      const projected = used + (input.additional ?? 0);
      const remaining = Math.max(0, included - used);
      const overage = Math.max(0, projected - included);
      const policy = def.usagePolicy;
      const warnThreshold = included > 0 ? included * 0.8 : 0;

      let allow = true;
      let action: "allow" | "warn" | "block_new_sessions" | "charge_overage" =
        "allow";

      if (included === 0 && (input.additional ?? 0) > 0) {
        allow = false;
        action = "block_new_sessions";
      } else if (projected > included) {
        if (policy === "hard_limit") {
          allow = false;
          action = "block_new_sessions";
        } else if (policy === "paid_overage") {
          allow = true;
          action = "charge_overage";
        } else if (policy === "soft_limit" || policy === "auto_upgrade") {
          allow = true;
          action = "warn";
        }
      } else if (included > 0 && projected >= warnThreshold) {
        action = "warn";
      }

      return {
        allow,
        action,
        used,
        included,
        remaining,
        overage,
        policy,
        period,
        estimatedOverageCents:
          overage * (def.overageRatesCents[input.metric] ?? 0),
      };
    },

    async getUsageSummary(input: {
      businessId: string;
      plan: PlanId;
      subscription?: BusinessSubscription | null;
    }): Promise<UsageSummary> {
      const period = billingPeriodBounds(
        now(),
        input.subscription?.billingInterval ?? "month",
        {
          start: input.subscription?.currentPeriodStart ?? null,
          end: input.subscription?.currentPeriodEnd ?? null,
        },
      );
      await ensureAllowances(input.businessId, input.plan, period);
      const def = getPlanDefinition(input.plan);
      const metrics = [];
      for (const metric of METRICS) {
        const used = await deps.store.sumUsage(
          input.businessId,
          metric,
          period.start,
          period.end,
        );
        const included = def.allowances[metric];
        const overage = Math.max(0, used - included);
        metrics.push({
          metric,
          used,
          included,
          remaining: Math.max(0, included - used),
          overage,
          estimatedOverageCents:
            overage * (def.overageRatesCents[metric] ?? 0),
          policy: def.usagePolicy,
        });
      }
      return {
        businessId: input.businessId,
        plan: input.plan,
        billingPeriodStart: period.start,
        billingPeriodEnd: period.end,
        metrics,
      };
    },
  };
}

export type UsageService = ReturnType<typeof createUsageService>;
