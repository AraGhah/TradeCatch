import { NextResponse } from "next/server";
import { computeStarterDashboardMetrics } from "@/product/saas/analytics";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireTenantContext();
  if (!auth.ok) {
    return unauthorizedTenantResponse(auth.error);
  }
  if (!tenantHasFeature(auth.ctx, "BASIC_ANALYTICS")) {
    return forbiddenFeatureResponse("BASIC_ANALYTICS");
  }

  const clientId = auth.ctx.organization.missedCallClientId;
  if (!clientId) {
    return NextResponse.json({
      ok: true,
      linked: false,
      metrics: computeStarterDashboardMetrics([]),
      message:
        "Missed-call client is not linked to this organization yet. Contact support to connect your Twilio number.",
    });
  }

  if (!tenantHasFeature(auth.ctx, "MISSED_CALL_RECOVERY")) {
    return forbiddenFeatureResponse("MISSED_CALL_RECOVERY");
  }

  const { store } = await ensureMissedCallReady();
  const leads = await store.listLeads(clientId);
  const metrics = computeStarterDashboardMetrics(leads);

  return NextResponse.json({
    ok: true,
    linked: true,
    plan: auth.ctx.organization.plan,
    metrics,
    growthAvailable: auth.ctx.organization.plan === "starter",
  });
}
