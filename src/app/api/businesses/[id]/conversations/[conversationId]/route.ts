import { NextRequest, NextResponse } from "next/server";
import { forbiddenUnless } from "@/product/security/access";
import { CrmError, getCrmService } from "@/product/crm/runtime";
import { authorizeBusinessMemberOrAdmin } from "../../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; conversationId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id, conversationId } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;
  const bundle = await getCrmService().getConversationBundle(id, conversationId);
  if (!bundle) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...bundle });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, conversationId } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;
  const denied = forbiddenUnless(access.role, "write_leads", access.via === "admin");
  if (denied) return denied;

  let body: { control?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!body.control) {
    return NextResponse.json({ error: "Missing control." }, { status: 400 });
  }
  try {
    const conversation = await getCrmService().setControl(
      id,
      conversationId,
      body.control,
      access.userEmail,
    );
    return NextResponse.json({ ok: true, conversation });
  } catch (err) {
    if (err instanceof CrmError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[crm] set control", err);
    return NextResponse.json({ error: "Could not update control." }, { status: 500 });
  }
}
