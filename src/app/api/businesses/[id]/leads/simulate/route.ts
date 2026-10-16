import { NextRequest, NextResponse } from "next/server";
import { CrmError, getCrmService } from "@/product/crm/runtime";
import { authorizeBusinessMemberOrAdmin } from "../../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;
  if (access.organization.accountType !== "demo") {
    return NextResponse.json(
      { error: "Simulated leads are limited to demo businesses." },
      { status: 403 },
    );
  }

  const suffix = String(Math.floor(1000000 + Math.random() * 8999999));
  try {
    const result = await getCrmService().capture({
      organizationId: id,
      source: "manual",
      phoneE164: `+1438${suffix}`,
      displayName: "Alex Démo",
      service: "plumbing",
      description: "Simulated leak under the kitchen sink. No real customer was contacted.",
      location: "Montréal",
      priority: "high",
      preferredLanguage: "fr",
      actor: "test-center",
      message: {
        direction: "inbound",
        body: "Bonjour, j'ai une fuite sous l'évier. C'est une simulation.",
        automated: false,
        simulated: true,
        deliveryStatus: "delivered",
      },
    });
    return NextResponse.json({
      ok: true,
      leadId: result.lead.id,
      simulated: true,
    });
  } catch (err) {
    if (err instanceof CrmError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[crm] simulate lead", err);
    return NextResponse.json({ error: "Could not simulate a lead." }, { status: 500 });
  }
}
