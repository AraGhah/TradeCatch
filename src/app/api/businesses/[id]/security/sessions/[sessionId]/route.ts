import { NextRequest, NextResponse } from "next/server";
import { SecurityError } from "@/product/security/service";
import { getSecurityService } from "@/product/security/runtime";
import { requireSameBusiness } from "@/product/security/access";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; sessionId: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  const { id, sessionId } = await params;
  const access = await requireSameBusiness(id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    await getSecurityService().revokeOwnSession(access.ctx.user.id, sessionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof SecurityError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed." }, { status });
  }
}
