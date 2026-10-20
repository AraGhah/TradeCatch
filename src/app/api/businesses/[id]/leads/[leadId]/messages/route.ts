import { NextRequest, NextResponse } from "next/server";
import { forbiddenUnless } from "@/product/security/access";
import { shouldUseDryRunSms } from "@/lib/environment";
import { CrmError, getCrmService } from "@/product/crm/runtime";
import { authorizeBusinessMemberOrAdmin } from "../../../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; leadId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id, leadId } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;
  const denied = forbiddenUnless(
    access.role,
    "write_leads",
    access.via === "admin",
  );
  if (denied) return denied;

  let body: { body?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const lead = await getCrmService().getLead(id, leadId);
  if (!lead?.conversationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const message = await getCrmService().sendHumanMessage({
      organizationId: id,
      conversationId: lead.conversationId,
      body: body.body ?? "",
      actor: access.userEmail,
      simulated:
        shouldUseDryRunSms() || access.organization.accountType === "demo",
    });
    return NextResponse.json({ ok: true, message });
  } catch (err) {
    if (err instanceof CrmError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[crm] send message", err);
    return NextResponse.json(
      { error: "Could not save the message." },
      { status: 500 },
    );
  }
}
