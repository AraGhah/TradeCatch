import { NextRequest, NextResponse } from "next/server";
import { requireSameBusiness } from "@/product/security/access";
import { getSecurityService } from "@/product/security/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

async function gate(organizationId: string) {
  return requireSameBusiness(organizationId);
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await gate(id);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  const service = getSecurityService();
  const sessions = await service.sessions(access.ctx.user.id);
  return NextResponse.json({
    ok: true,
    sessions: sessions.filter(
      (row) => row.organizationId === id || access.ctx.isPlatformAdmin,
    ),
    role: access.ctx.membership.role,
  });
}
