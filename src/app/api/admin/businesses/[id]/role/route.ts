import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { decideRoleChange } from "@/product/admin/account-actions";
import { clearPlatformSnapshot } from "@/product/admin/platform-snapshot";
import { recordSecurityEvent } from "@/product/security/hooks";
import { getSaasStore } from "@/product/saas/runtime";

export const dynamic = "force-dynamic";

const schema = z.object({
  userId: z.string().min(1),
  role: z.string(),
  confirm: z.literal(true),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  if (!access.ctx)
    return NextResponse.json({ error: "session" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "role" }, { status: 400 });
  const { id } = await context.params;
  const store = getSaasStore();
  const members = await store.listMembershipsForOrganization(id);
  const decision = decideRoleChange({
    members,
    userId: parsed.data.userId,
    next: parsed.data.role,
  });
  if (!decision.ok)
    return NextResponse.json({ error: decision.error }, { status: 400 });
  const updated = await store.setMembershipRole(
    id,
    parsed.data.userId,
    decision.role,
  );
  if (!updated) return NextResponse.json({ error: "member" }, { status: 404 });
  clearPlatformSnapshot();
  await recordSecurityEvent({
    organizationId: id,
    actorUserId: access.ctx.user.id,
    action: "admin_member_role",
    target: parsed.data.userId,
    detail: decision.role,
  });
  return NextResponse.json({ ok: true, role: updated.role });
}
