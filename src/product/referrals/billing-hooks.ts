/**
 * The only places billing talks to the referral program.
 *
 * Every function here is best effort and NEVER throws: a referral problem
 * (migration not applied, database hiccup, bug) must not fail, delay or roll
 * back a customer's payment or subscription. The referral module is loaded
 * lazily for the same reason. What a failed hook leaves undone is recovered by
 * the reconcile action on the admin referrals page, and by the payment check
 * made against Stripe at the moment a reward is approved.
 */
import { z } from "zod";
import type { PlanId } from "@/product/saas/plan-catalog";
import { logReferralFailure } from "./log";

const report = logReferralFailure;

/** An installation fee was paid: the referred business may now qualify. */
export async function referralInstallationPaid(input: {
  organizationId: string;
  plan: PlanId;
  checkoutSessionId: string;
  paymentIntentId?: string;
  livemode: boolean;
}): Promise<void> {
  try {
    const { getReferralService } = await import("./runtime");
    await getReferralService().qualifyReferral(input);
  } catch (error) {
    report("qualification", error);
  }
}

/** Stripe changed the organization's subscription state (cancelled, suspended, active). */
export async function referralBillingStateChanged(
  organizationId: string,
  status: "active" | "suspended" | "churned",
): Promise<void> {
  try {
    const { getReferralService } = await import("./runtime");
    await getReferralService().onBillingStateChanged(organizationId, status);
  } catch (error) {
    report("billing state update", error);
  }
}

/**
 * Links a newly provisioned business to the customer whose link it came
 * through. Reports what happened so the founder sees it; never throws.
 */
export async function referralRegisterOrganization(input: {
  code: string;
  organizationId: string;
  actor: string;
}): Promise<{ linked: boolean; reason?: string }> {
  try {
    const { getReferralService } = await import("./runtime");
    const result = await getReferralService().registerReferral({
      code: input.code,
      referredOrganizationId: input.organizationId,
      actor: input.actor,
    });
    return result.ok ? { linked: true } : { linked: false, reason: result.reason };
  } catch (error) {
    report("registration", error);
    return { linked: false, reason: "unavailable" };
  }
}

export const REFERRAL_REVERSAL_EVENTS = new Set([
  "charge.refunded",
  "charge.dispute.created",
]);

const reversalSchema = z.object({
  type: z.enum(["charge.refunded", "charge.dispute.created"]),
  account: z.string().optional(),
  data: z.object({
    object: z.object({
      payment_intent: z
        .union([z.string(), z.object({ id: z.string() })])
        .nullable()
        .optional(),
      amount: z.number().optional(),
      amount_refunded: z.number().optional(),
      refunded: z.boolean().optional(),
    }),
  }),
});

/** A refund or dispute on a charge: reject (or flag) the reward it paid for. */
export async function referralPaymentReversed(event: unknown): Promise<void> {
  try {
    const parsed = reversalSchema.safeParse(event);
    // Connect events never concern this platform's own customers.
    if (!parsed.success || parsed.data.account) return;
    const { type, data } = parsed.data;
    const intent = data.object.payment_intent;
    const paymentIntentId = typeof intent === "string" ? intent : intent?.id;
    if (!paymentIntentId) return;

    const { amount, amount_refunded: amountRefunded, refunded } = data.object;
    const kind =
      type === "charge.dispute.created"
        ? "chargeback"
        : refunded === true ||
            (amount !== undefined && amountRefunded !== undefined && amountRefunded >= amount)
          ? "refunded"
          : "partially_refunded";

    const { getReferralService } = await import("./runtime");
    await getReferralService().onPaymentReversed({ paymentIntentId, kind });
  } catch (error) {
    report("payment reversal", error);
  }
}
