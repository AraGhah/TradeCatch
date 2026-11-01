import { NextRequest, NextResponse } from "next/server";
import { purgeBusinessVoice } from "@/product/receptionist/custom-voice/runtime";
import { requireSameBusiness } from "@/product/security/access";
import { recordSecurityEvent } from "@/product/security/hooks";
import { getSupportService } from "@/product/support/runtime";
import { canCloseAccount } from "@/product/support/access";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
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
      { error: "Only the owner can request deletion." },
      { status: 403 },
    );
  }
  const row = await getSupportService().requestAccountChange(id, "deletion");
  await recordSecurityEvent({
    organizationId: id,
    actorUserId: access.ctx.user.id,
    action: "account_deletion_requested",
    target: row.id,
    detail: "phone routing unchanged until a transition is confirmed",
  });
  // The owner asked for their data to go: remove the cloned voice now rather
  // than wait for the account to be closed. Calls keep working on the standard voice.
  await purgeBusinessVoice(id);
  return NextResponse.json({
    ok: true,
    request: row,
    deleted: false,
    phoneRouting: row.phoneRouting,
  });
}
