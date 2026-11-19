import {
  adminReply,
  dateParam,
  guardAdmin,
  pageParams,
} from "@/lib/admin-route";
import {
  BILLING_OUTCOMES,
  listBillingEvents,
  listSubscriptionRows,
  type BillingOutcome,
} from "@/product/admin-console/billing-db";
import { loadInvoices } from "@/product/admin-console/billing-views";
import {
  INVOICE_STATUS_FILTERS,
  resolveStripe,
  type InvoiceStatusFilter,
} from "@/product/admin-console/stripe-admin";
import { getSaasStore } from "@/product/saas/runtime";

export const dynamic = "force-dynamic";

const CURSOR = /^in_[A-Za-z0-9]{6,80}$/;

/**
 * Payment history. Two views of it:
 *  - `invoices`: what Stripe holds (amounts, status, dates, outstanding balance),
 *    paged by Stripe cursor, filterable by status and business.
 *  - `events`: the payment outcomes Stripe reported to TradeCatch (failed,
 *    action required, succeeded), recorded by the verified webhook, filterable by
 *    outcome, business and date. This is what shows a failure even when Stripe
 *    cannot be reached.
 */
export async function GET(request: Request) {
  const guard = await guardAdmin(request, "admin.read");
  if (!guard.ok) return guard.response;
  const params = new URL(request.url).searchParams;

  const status = (params.get("status") || "all") as InvoiceStatusFilter;
  if (!INVOICE_STATUS_FILTERS.includes(status))
    return adminReply({ error: "Unknown status." }, 400);
  const outcome = (params.get("outcome") || undefined) as
    BillingOutcome | undefined;
  if (outcome && !BILLING_OUTCOMES.includes(outcome))
    return adminReply({ error: "Unknown outcome." }, 400);
  const after = params.get("after") || undefined;
  if (after && !CURSOR.test(after))
    return adminReply({ error: "Bad cursor." }, 400);
  const businessId = params.get("businessId") || undefined;
  const { page, pageSize, offset } = pageParams(params);

  try {
    const [events, rows] = await Promise.all([
      listBillingEvents({
        outcome,
        organizationId: businessId,
        from: dateParam(params.get("from")),
        to: dateParam(params.get("to")),
        limit: pageSize,
        offset,
      }).catch(() => ({ rows: [], total: 0 })),
      listSubscriptionRows().catch(() => []),
    ]);

    // A business filter narrows Stripe's invoices to that business's customer.
    const customerId = businessId
      ? rows.find((r) => r.organizationId === businessId)?.customerId
      : undefined;
    let invoices: Awaited<ReturnType<typeof loadInvoices>> | null = null;
    let invoicesError: string | null = null;
    if (!businessId || customerId) {
      try {
        invoices = await loadInvoices({
          stripe: resolveStripe(),
          store: getSaasStore(),
          status,
          customerId,
          cursor: after,
          limit: pageSize,
        });
      } catch {
        invoicesError =
          "Stripe could not be reached, so invoices are not shown. Payment events below are still current.";
      }
    }

    // Enrich recorded events with the business name.
    const store = getSaasStore();
    const names = new Map<string, string>();
    await Promise.all(
      [
        ...new Set(
          events.rows
            .map((e) => e.organizationId)
            .filter((id): id is string => Boolean(id)),
        ),
      ].map(async (id) => {
        const org = await store.getOrganization(id).catch(() => null);
        if (org) names.set(id, org.name);
      }),
    );

    return adminReply({
      ok: true,
      generatedAt: new Date().toISOString(),
      invoices,
      invoicesError,
      events: {
        rows: events.rows.map((e) => ({
          ...e,
          organizationName: e.organizationId
            ? (names.get(e.organizationId) ?? null)
            : null,
        })),
        total: events.total,
        page,
        pageSize,
        pages: Math.max(1, Math.ceil(events.total / pageSize)),
      },
    });
  } catch (error) {
    console.error("[admin] payments failed", error);
    return adminReply({ error: "Payments are unavailable." }, 503);
  }
}
