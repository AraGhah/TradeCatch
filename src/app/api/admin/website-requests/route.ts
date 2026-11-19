import {
  adminReply,
  dateParam,
  guardAdmin,
  pageParams,
} from "@/lib/admin-route";
import {
  WEBSITE_PAYMENT_STATUSES,
  WEBSITE_REQUEST_STATUSES,
  WEBSITE_STATUS_LABELS,
  type WebsitePaymentStatus,
  type WebsiteRequestStatus,
} from "@/product/website-services/model";
import { getWebsiteRequestService } from "@/product/website-services/runtime";

export const dynamic = "force-dynamic";

/**
 * Every website-service request across all businesses, for platform
 * administrators (MFA session) or the operations secret. These rows hold
 * visitors' contact details, so this is never reachable by a customer.
 *
 * Filters: status, paymentStatus, q (business / contact / email), businessId,
 * from / to (submission date). Paged with page / pageSize.
 */
export async function GET(request: Request) {
  const guard = await guardAdmin(request, "admin.read");
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  if (
    status &&
    !(WEBSITE_REQUEST_STATUSES as readonly string[]).includes(status)
  ) {
    return adminReply({ error: "Unknown status." }, 400);
  }
  const paymentStatus = params.get("paymentStatus");
  if (
    paymentStatus &&
    !(WEBSITE_PAYMENT_STATUSES as readonly string[]).includes(paymentStatus)
  ) {
    return adminReply({ error: "Unknown payment status." }, 400);
  }
  const { page, pageSize, offset } = pageParams(params);
  const filter = {
    status: (status as WebsiteRequestStatus | null) ?? undefined,
    paymentStatus: (paymentStatus as WebsitePaymentStatus | null) ?? undefined,
    q: params.get("q")?.slice(0, 100) || undefined,
    organizationId: params.get("businessId") || undefined,
    from: dateParam(params.get("from")),
    to: dateParam(params.get("to")),
  };

  try {
    const service = getWebsiteRequestService();
    const [requests, total, ...counts] = await Promise.all([
      service.listAll({ ...filter, limit: pageSize, offset }),
      service.countAll(filter),
      // Per-status counts for the filter chips, ignoring the status filter itself.
      ...WEBSITE_REQUEST_STATUSES.map((s) =>
        service.countAll({ ...filter, status: s }),
      ),
    ]);
    return adminReply({
      ok: true,
      requests,
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      statusCounts: Object.fromEntries(
        WEBSITE_REQUEST_STATUSES.map((s, i) => [s, counts[i]]),
      ),
      labels: WEBSITE_STATUS_LABELS,
    });
  } catch (error) {
    console.error("[website-requests] admin list failed", error);
    return adminReply({ error: "Website requests are unavailable." }, 503);
  }
}
