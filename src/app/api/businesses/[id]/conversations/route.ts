import { NextRequest, NextResponse } from "next/server";
import { getCrmService } from "@/product/crm/runtime";
import { authorizeBusinessMemberOrAdmin } from "../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;
  try {
    const conversations = await getCrmService().listConversations(id);
    return NextResponse.json({ ok: true, conversations });
  } catch (err) {
    console.error("[crm] list conversations", err);
    return NextResponse.json(
      { error: "Could not load conversations." },
      { status: 500 },
    );
  }
}
