import { NextResponse } from "next/server";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { getStarterStore } from "@/product/starter/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  if (!tenantHasFeature(auth.ctx, "WEBSITE_LEAD_CAPTURE")) {
    return forbiddenFeatureResponse("WEBSITE_LEAD_CAPTURE");
  }

  const leads = await getStarterStore().listWebsiteLeads(
    auth.ctx.organization.id,
  );
  return NextResponse.json({
    ok: true,
    leads: leads.map((l) => ({
      id: l.id,
      name: l.name,
      email: l.email,
      phoneE164: l.phoneE164,
      message: l.message,
      serviceRequested: l.serviceRequested,
      sourceUrl: l.sourceUrl,
      status: l.status,
      conversationMode: l.conversationMode,
      openingSmsSent: l.openingSmsSent,
      source: "website" as const,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    })),
  });
}
