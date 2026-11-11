import { NextRequest, NextResponse } from "next/server";
import { requireSameBusiness } from "@/product/security/access";
import { recordSecurityEvent } from "@/product/security/hooks";
import { canCloseAccount } from "@/product/support/access";
import { SupportError } from "@/product/support/errors";
import { getSupportService } from "@/product/support/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string; requestId: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  const { id, requestId } = await params;
  const access = await requireSameBusiness(id);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  if (
    !canCloseAccount(access.ctx.membership.role, access.ctx.isPlatformAdmin)
  ) {
    return NextResponse.json(
      { error: "Only the owner can withdraw an account request." },
      { status: 403 },
    );
  }
  try {
    const row = await getSupportService().withdrawAccountRequest(id, requestId);
    await recordSecurityEvent({
      organizationId: id,
      actorUserId: access.ctx.user.id,
      action: "account_request_withdrawn",
      target: row.id,
      detail: `${row.kind} withdrawn by owner`,
    });
    return NextResponse.json({ ok: true, request: row });
  } catch (error) {
    if (error instanceof SupportError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}
