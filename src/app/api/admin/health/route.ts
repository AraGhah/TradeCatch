import { adminReply, dateParam, guardAdmin } from "@/lib/admin-route";
import {
  loadSystemHealth,
  type HealthFilter,
} from "@/product/admin-console/health";
import { getReliabilityService } from "@/product/reliability/runtime";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["open", "investigating", "resolved"]);

/**
 * Platform health: database connectivity, provider probes (Twilio, Stripe,
 * email), which integrations are configured, API error rate and latency, recent
 * errors, webhook failures, failed jobs and open incidents. Real backend data;
 * each reading says when it was taken, and a value that cannot be known is
 * reported as unknown rather than invented.
 *
 * Filters: businessId, status, service, from / to.
 */
export async function GET(request: Request) {
  const guard = await guardAdmin(request, "admin.read");
  if (!guard.ok) return guard.response;
  const params = new URL(request.url).searchParams;
  const status = params.get("status") || undefined;
  if (status && !STATUSES.has(status))
    return adminReply({ error: "Unknown status." }, 400);
  const filter: HealthFilter = {
    organizationId: params.get("businessId")?.slice(0, 80) || undefined,
    status: status as HealthFilter["status"],
    service: params.get("service")?.slice(0, 60) || undefined,
    from: dateParam(params.get("from")),
    to: dateParam(params.get("to")),
  };
  try {
    const health = await loadSystemHealth(getReliabilityService(), filter);
    return adminReply({ ok: true, ...health });
  } catch (error) {
    console.error("[admin] health failed", error);
    return adminReply({ error: "Health data is unavailable." }, 503);
  }
}
