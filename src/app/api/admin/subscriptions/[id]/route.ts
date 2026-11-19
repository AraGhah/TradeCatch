import { z } from "zod";
import { adminReply, guardAdmin } from "@/lib/admin-route";
import { readJsonBody } from "@/lib/request-body";
import { recordAdminAction } from "@/product/admin-console/audit";
import { findOrganizationByCustomer } from "@/product/admin-console/billing-db";
import {
  SUBSCRIPTION_ACTIONS,
  SUBSCRIPTION_CONFIRM,
  changeSubscription,
  resolveStripe,
  type SubscriptionChangeError,
} from "@/product/admin-console/stripe-admin";
import { clearPlatformSnapshot } from "@/product/admin/platform-snapshot";
import { PUBLIC_PLAN_IDS } from "@/product/saas/entitlements";
import { getSaasStore } from "@/product/saas/runtime";
import { synchronizeStripeBilling } from "@/product/saas/stripe-billing";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    action: z.enum(SUBSCRIPTION_ACTIONS),
    targetPlan: z.enum(PUBLIC_PLAN_IDS).optional(),
    confirm: z.string().max(40),
  })
  .strict();

const FAILURE: Record<SubscriptionChangeError, [number, string]> = {
  invalid_id: [400, "That is not a subscription id."],
  confirm: [400, "Type the confirmation word exactly to continue."],
  stripe_unconfigured: [503, "Stripe is not configured on this server."],
  not_found: [404, "Stripe has no such subscription."],
  not_managed: [
    403,
    "That subscription does not belong to a TradeCatch business.",
  ],
  invalid_state: [
    409,
    "That subscription cannot be changed right now (it is not active, has more than one item, or is in a different Stripe mode).",
  ],
  same_plan: [409, "The subscription is already on that plan."],
  price_not_configured: [
    503,
    "No Stripe price is configured for that plan on this server.",
  ],
  price_invalid: [
    409,
    "The configured Stripe price for that plan is not a usable monthly price.",
  ],
  nothing_to_change: [
    409,
    "Nothing to change: the subscription is already in that state.",
  ],
  unavailable: [
    502,
    "Stripe could not be reached. Nothing was changed; check the subscription before retrying.",
  ],
  rejected: [422, "Stripe refused the change. Nothing was changed."],
};

/**
 * Change an existing subscription: switch between Essential and Professional,
 * cancel at the end of the current period, or resume a pending cancellation.
 *
 * This never creates a subscription, an invoice or a charge. A plan change
 * updates the existing subscription item with proration off, so the new price
 * applies from the next invoice. The administrator types a confirmation word;
 * the change is read back from Stripe and the database is synchronized (which is
 * what updates the business's entitlements) before the response.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await guardAdmin(request, "billing.write");
  if (!guard.ok) return guard.response;
  const { actor } = guard.access;
  const { id } = await context.params;

  const read = await readJsonBody(request, 1024);
  if (!read.ok) return adminReply({ error: read.error }, read.status);
  const parsed = schema.safeParse(read.data);
  if (!parsed.success) return adminReply({ error: "Invalid request." }, 400);
  const { action, targetPlan, confirm } = parsed.data;

  const stripe = resolveStripe();
  if (!stripe.configured) {
    return adminReply(
      { error: FAILURE.stripe_unconfigured[1], code: "stripe_unconfigured" },
      503,
    );
  }
  const store = getSaasStore();

  try {
    const result = await changeSubscription(
      { subscriptionId: id, action, targetPlan, confirm },
      {
        http: stripe.http,
        livemode: stripe.livemode,
        organizationForCustomer: (customerId) =>
          findOrganizationByCustomer(customerId),
        synchronize: ({ subscriptionId, customerId, livemode }) =>
          synchronizeStripeBilling({
            id: `evt_admin_${subscriptionId}_${Date.now()}`,
            type: "customer.subscription.updated",
            livemode,
            data: { object: { id: subscriptionId, customer: customerId } },
          }),
        organizationPlan: async (organizationId) =>
          (await store.getOrganization(organizationId))?.plan ?? null,
      },
    );

    if (!result.ok) {
      await recordAdminAction(actor, {
        action: `admin_subscription_${action}_refused`,
        target: id,
        outcome: "failed",
        detail: result.error,
      });
      const [status, message] = FAILURE[result.error];
      return adminReply({ error: message, code: result.error }, status);
    }

    clearPlatformSnapshot();
    await recordAdminAction(actor, {
      action: `admin_subscription_${action}`,
      organizationId: result.organizationId,
      target: id,
      changes: [
        {
          field: "plan",
          from: result.before.plan ?? "unknown",
          to: result.after.plan ?? "unknown",
        },
        {
          field: "cancelAtPeriodEnd",
          from: String(result.before.cancelAtPeriodEnd),
          to: String(result.after.cancelAtPeriodEnd),
        },
      ],
      detail: `synchronized=${result.synchronized}`,
    });
    return adminReply({
      ok: true,
      organizationId: result.organizationId,
      before: result.before,
      after: result.after,
      synchronized: result.synchronized,
      entitlementsUpdated: result.entitlementsUpdated,
      confirmWord: SUBSCRIPTION_CONFIRM[action],
    });
  } catch (error) {
    console.error("[admin] subscription change failed", error);
    return adminReply(
      { error: FAILURE.unavailable[1], code: "unavailable" },
      502,
    );
  }
}
