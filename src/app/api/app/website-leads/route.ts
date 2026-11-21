import { NextResponse } from "next/server";
import { requireTenantFeature } from "@/product/saas/tenant";
import { getStarterStore } from "@/product/starter/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireTenantFeature("WEBSITE_LEAD_CAPTURE");
  if (!auth.ok) return auth.response;

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
