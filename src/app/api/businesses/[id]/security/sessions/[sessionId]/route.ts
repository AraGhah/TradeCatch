import { NextRequest, NextResponse } from "next/server";
import { safeErrorResponse } from "@/lib/api-error";
import { SecurityError } from "@/product/security/service";
import { getSecurityService } from "@/product/security/runtime";
import { requireSameBusiness } from "@/product/security/access";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; sessionId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id, sessionId } = await params;
  const access = await requireSameBusiness(id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    await getSecurityService().revokeOwnSession(access.ctx.user.id, sessionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeErrorResponse(error, {
      route: "security.sessions.revoke",
      request,
      publicErrors: [SecurityError],
      fallback: "Failed.",
    });
  }
}
