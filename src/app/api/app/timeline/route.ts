import { NextResponse } from "next/server";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { getGrowthStore } from "@/product/growth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);

  const canView =
    tenantHasFeature(auth.ctx, "HUMAN_TAKEOVER") ||
    tenantHasFeature(auth.ctx, "BASIC_ANALYTICS");
  if (!canView) {
    return forbiddenFeatureResponse("BASIC_ANALYTICS");
  }

  const events = await getGrowthStore().listTimeline(
    auth.ctx.organization.id,
    100,
  );
  return NextResponse.json({ ok: true, events });
}
