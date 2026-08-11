import { NextResponse } from "next/server";
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
  if (!tenantHasFeature(auth.ctx, "MISSED_CALL_RECOVERY")) {
    return forbiddenFeatureResponse("MISSED_CALL_RECOVERY");
  }

  const clientId = auth.ctx.organization.missedCallClientId;
  if (!clientId) {
    return NextResponse.json({ ok: true, linked: false, leads: [] });
  }

  // Tenant isolation: only this org's missed-call client id.
  const { store } = await ensureMissedCallReady();
  const leads = await store.listLeads(clientId);

  return NextResponse.json({
    ok: true,
    linked: true,
    leads: leads.map((l) => ({
      id: l.id,
      callerE164: l.callerE164,
      customerName: l.customerName,
      serviceAddress: l.serviceAddress,
      issueDescription: l.issueDescription,
      urgency: l.urgency,
      humanReviewRequired: l.humanReviewRequired,
      jobAccepted: l.jobAccepted,
      outcome: l.outcome,
      source: "phone" as const,
      updatedAt: l.updatedAt,
      createdAt: l.createdAt,
    })),
  });
}
