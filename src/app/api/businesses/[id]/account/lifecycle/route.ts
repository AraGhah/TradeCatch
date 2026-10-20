import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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
      { error: "Only the owner can change service status." },
      { status: 403 },
    );
  }
  const parsed = z
    .object({ kind: z.enum(["suspension", "reactivation"]) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const row = await getSupportService().requestAccountChange(
    id,
    parsed.data.kind,
  );
  await recordSecurityEvent({
    organizationId: id,
    actorUserId: access.ctx.user.id,
    action:
      parsed.data.kind === "suspension"
        ? "account_suspension_requested"
        : "account_reactivation_requested",
    target: row.id,
    detail: "phone number stays routed until a confirmed transition",
  });
  return NextResponse.json({
    ok: true,
    request: row,
    phoneDisconnected: false,
  });
}
