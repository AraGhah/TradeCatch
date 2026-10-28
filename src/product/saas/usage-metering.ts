/**
 * Per-organization usage metering against the provisional plan allowances
 * in `src/lib/plans.ts` (USAGE_ALLOWANCES).
 *
 * This module is infrastructure: it tracks and reports usage recorded by
 * other engines, it never calls Twilio or an AI provider itself. Wiring the
 * actual increments into the SMS and voice call paths (missed-call,
 * sms-automation, receptionist engines) is a separate, cross-cutting change
 * — until that lands, counts recorded here only reflect whatever callers
 * choose to report with `recordUsage`.
 *
 * Soft limits only: nothing here disconnects an active call or blocks a
 * message. Callers get a usage snapshot and decide what, if anything, to do
 * with a near-limit or over-limit organization (e.g. notify, not block).
 */
import { getPgPool } from "@/product/missed-call/postgres-store";
import { USAGE_ALLOWANCES, type PlanId, type UsageMetric } from "@/lib/plans";

export type { UsageMetric };

export const METERED_METRICS = [
  "smsSegmentsPerMonth",
  "voiceMinutesPerMonth",
] as const satisfies readonly UsageMetric[];

const METRIC_COLUMN: Record<(typeof METERED_METRICS)[number], string> = {
  smsSegmentsPerMonth: "sms_segments",
  voiceMinutesPerMonth: "voice_minutes",
};

export type UsageSnapshot = {
  metric: (typeof METERED_METRICS)[number];
  periodStart: string;
  used: number;
  allowance: number;
  /** null when the plan has no allowance for this metric (e.g. Starter voice). */
  percentUsed: number | null;
  nearLimit: boolean;
  overLimit: boolean;
};

function currentPeriodStart(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Soft warning threshold: notify before the hard allowance is reached. */
const NEAR_LIMIT_RATIO = 0.8;

export function evaluateUsage(
  plan: PlanId,
  metric: (typeof METERED_METRICS)[number],
  used: number,
  now = new Date(),
): UsageSnapshot {
  const allowance = USAGE_ALLOWANCES[plan][metric];
  const percentUsed = allowance > 0 ? Math.round((used / allowance) * 100) : null;
  return {
    metric,
    periodStart: currentPeriodStart(now),
    used,
    allowance,
    percentUsed,
    nearLimit: allowance > 0 && used >= allowance * NEAR_LIMIT_RATIO && used < allowance,
    overLimit: allowance > 0 ? used >= allowance : used > 0,
  };
}

/**
 * Adds `amount` to the organization's counter for the current calendar
 * month. Safe to call concurrently (upsert with an atomic increment).
 */
export async function recordUsage(
  organizationId: string,
  metric: (typeof METERED_METRICS)[number],
  amount: number,
  now = new Date(),
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const url = process.env.DATABASE_URL?.trim();
  if (
    !url ||
    (process.env.SAAS_DURABLE_STORE !== "1" &&
      process.env.MISSED_CALL_DURABLE_STORE !== "1")
  ) {
    return;
  }
  await getPgPool(url).query(
    `INSERT INTO tc_usage_counters (organization_id, metric, period_start, count)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, metric, period_start)
     DO UPDATE SET count = tc_usage_counters.count + EXCLUDED.count, updated_at = now()`,
    [organizationId, METRIC_COLUMN[metric], currentPeriodStart(now), amount],
  );
}

/** Current-month usage for every metered metric, for dashboard display. */
export async function usageSummary(
  organizationId: string,
  plan: PlanId,
  now = new Date(),
): Promise<UsageSnapshot[]> {
  const url = process.env.DATABASE_URL?.trim();
  const period = currentPeriodStart(now);
  const counts = new Map<string, number>();
  if (
    url &&
    (process.env.SAAS_DURABLE_STORE === "1" ||
      process.env.MISSED_CALL_DURABLE_STORE === "1")
  ) {
    const rows = (
      await getPgPool(url).query(
        "SELECT metric, count FROM tc_usage_counters WHERE organization_id=$1 AND period_start=$2",
        [organizationId, period],
      )
    ).rows as { metric: string; count: string | number }[];
    for (const row of rows) counts.set(row.metric, Number(row.count));
  }
  return METERED_METRICS.map((metric) =>
    evaluateUsage(plan, metric, counts.get(METRIC_COLUMN[metric]) ?? 0, now),
  );
}
