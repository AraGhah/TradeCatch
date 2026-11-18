/**
 * What the billing page says about the customer's subscription: its state, its
 * next charge and whether it is about to end. Read from the rows the Stripe
 * webhook already keeps in tc_stripe_subscriptions (no new table), so the page
 * reports what Stripe last confirmed, never a guess from a cookie or the plan id.
 */
import { getPgPool } from "@/product/missed-call/postgres-store";
import type { PlanId } from "./entitlements";

export type StripeSubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

export type SubscriptionSummary = {
  status: StripeSubscriptionStatus;
  plan: PlanId;
  cancelAtPeriodEnd: boolean;
  /** ISO timestamp: the next charge, or the end of the paid period. */
  currentPeriodEnd: string | null;
};

/** The three things a customer is told about their subscription. */
export type SubscriptionStatusKind = "active" | "payment_needed" | "canceled";

/**
 * Same split the webhook uses to decide access: active and trialing are
 * entitled, canceled and expired are over, everything else is a payment problem.
 */
export function subscriptionStatusKind(
  status: StripeSubscriptionStatus | string,
): SubscriptionStatusKind {
  if (status === "active" || status === "trialing") return "active";
  if (status === "canceled" || status === "incomplete_expired") return "canceled";
  return "payment_needed";
}

/**
 * The subscription that decides the organization's plan: an entitled one first,
 * then one still in payment recovery, then a finished one, the latest period
 * first. Null when the organization has no subscription (or storage is not the
 * durable database).
 */
export async function getSubscriptionSummary(
  organizationId: string,
): Promise<SubscriptionSummary | null> {
  const url = process.env.DATABASE_URL?.trim();
  if (
    !url ||
    (process.env.SAAS_DURABLE_STORE !== "1" &&
      process.env.MISSED_CALL_DURABLE_STORE !== "1")
  ) {
    return null;
  }
  const row = (
    await getPgPool(url).query(
      `SELECT status, plan, cancel_at_period_end, current_period_end
         FROM tc_stripe_subscriptions
        WHERE organization_id = $1
        ORDER BY CASE
                   WHEN status IN ('active','trialing') THEN 0
                   WHEN status IN ('canceled','incomplete_expired') THEN 2
                   ELSE 1
                 END,
                 current_period_end DESC NULLS LAST,
                 synced_at DESC
        LIMIT 1`,
      [organizationId],
    )
  ).rows[0] as
    | {
        status: StripeSubscriptionStatus;
        plan: PlanId;
        cancel_at_period_end: boolean;
        current_period_end: Date | string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    status: row.status,
    plan: row.plan,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    currentPeriodEnd: row.current_period_end
      ? new Date(row.current_period_end).toISOString()
      : null,
  };
}
