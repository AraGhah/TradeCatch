import { NextResponse } from "next/server";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { getGrowthServices, getGrowthStore } from "@/product/growth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  if (!tenantHasFeature(auth.ctx, "ADVANCED_ANALYTICS")) {
    return forbiddenFeatureResponse("ADVANCED_ANALYTICS");
  }

  const store = getGrowthStore();
  const orgId = auth.ctx.organization.id;
  const includeRevenue = tenantHasFeature(auth.ctx, "REVENUE_ATTRIBUTION");

  const [pipeline, appointments, reviews, revenue] = await Promise.all([
    store.listPipeline(orgId),
    store.listAppointments(orgId),
    store.listReviewRequests(orgId),
    includeRevenue ? store.listRevenue(orgId) : Promise.resolve([]),
  ]);

  const analytics = getGrowthServices().computeAdvancedAnalytics({
    pipeline,
    revenue,
    appointments,
    reviews,
  });

  return NextResponse.json({
    ok: true,
    analytics,
    ...(includeRevenue ? { revenue } : {}),
  });
}
