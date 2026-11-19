import { adminReply, guardAdmin } from "@/lib/admin-route";
import { adminDb } from "@/product/admin-console/db";
import { buildOverview } from "@/product/admin-console/overview";
import { resolveStripe } from "@/product/admin-console/stripe-admin";
import { loadPlatformSnapshot } from "@/product/admin/platform-snapshot";
import { getReliabilityService } from "@/product/reliability/runtime";
import { getSecurityService } from "@/product/security/runtime";
import { getWebsiteRequestService } from "@/product/website-services/runtime";

export const dynamic = "force-dynamic";

/**
 * The Overview numbers and alerts. Always computed at request time from the
 * systems of record; the response says when (generatedAt) and where the revenue
 * figure came from (Stripe or the catalog).
 */
export async function GET(request: Request) {
  const guard = await guardAdmin(request, "admin.read");
  if (!guard.ok) return guard.response;

  try {
    const snapshot = await loadPlatformSnapshot();
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const [pendingWebsiteRequests, denied] = await Promise.all([
      getWebsiteRequestService()
        .countAll({ status: "submitted" })
        .catch(() => 0),
      getSecurityService()
        .searchAudit({ outcome: "denied", from: dayAgo, limit: 1 })
        .then((page) => page.total)
        .catch(() => 0),
    ]);
    const overview = await buildOverview({
      platform: snapshot,
      stripe: resolveStripe(),
      reliability: getReliabilityService(),
      db: adminDb(),
      pendingWebsiteRequests,
      deniedAdminAttempts24h: denied,
    });
    return adminReply({ ok: true, ...overview });
  } catch (error) {
    console.error("[admin] overview failed", error);
    return adminReply({ error: "The overview is unavailable." }, 503);
  }
}
