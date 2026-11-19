import { adminReply, guardAdmin } from "@/lib/admin-route";
import { listSubscriptionRows } from "@/product/admin-console/billing-db";
import { loadSubscriptions } from "@/product/admin-console/billing-views";
import {
  SUBSCRIPTION_STATUS_FILTERS,
  resolveStripe,
  type SubscriptionStatusFilter,
} from "@/product/admin-console/stripe-admin";
import { getSaasStore } from "@/product/saas/runtime";

export const dynamic = "force-dynamic";

const CURSOR = /^sub_[A-Za-z0-9]{6,80}$/;

/**
 * Essential and Professional subscriptions with the actual Stripe prices and
 * statuses, billing dates and cancellation state, joined to the business that
 * owns each and flagged where Stripe and TradeCatch's record disagree.
 *
 * Filters: status. Paged by Stripe cursor (after / nextCursor).
 */
export async function GET(request: Request) {
  const guard = await guardAdmin(request, "admin.read");
  if (!guard.ok) return guard.response;
  const params = new URL(request.url).searchParams;
  const status = (params.get("status") || "all") as SubscriptionStatusFilter;
  if (!SUBSCRIPTION_STATUS_FILTERS.includes(status)) {
    return adminReply({ error: "Unknown status." }, 400);
  }
  const after = params.get("after") || undefined;
  if (after && !CURSOR.test(after))
    return adminReply({ error: "Bad cursor." }, 400);

  try {
    const result = await loadSubscriptions({
      stripe: resolveStripe(),
      rows: await listSubscriptionRows().catch(() => []),
      store: getSaasStore(),
      status,
      cursor: after,
      limit: Math.min(100, Math.max(1, Number(params.get("pageSize")) || 25)),
    });
    return adminReply({
      ok: true,
      ...result,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[admin] subscriptions failed", error);
    return adminReply(
      {
        error:
          "Stripe could not be reached. Nothing was changed; try again shortly.",
      },
      502,
    );
  }
}
