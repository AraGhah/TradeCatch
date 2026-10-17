import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { decideStatusChange } from "@/product/admin/account-actions";
import { clearPlatformSnapshot } from "@/product/admin/platform-snapshot";
import { recordSecurityEvent } from "@/product/security/hooks";
import { getSaasStore } from "@/product/saas/runtime";

export const dynamic = "force-dynamic";

const schema = z.object({
  status: z.string(),
  confirm: z.string(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.ctx) {
    return NextResponse.json({ error: "session" }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "status" }, { status: 400 });
  const { id } = await context.params;
  const decision = decideStatusChange({
    next: parsed.data.status,
    confirm: parsed.data.confirm,
    sessionOrganizationId: access.ctx.organization.id,
    targetOrganizationId: id,
  });
  if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: 400 });
  const updated = await getSaasStore().updateOrganization(id, { status: decision.status });
  if (!updated) return NextResponse.json({ error: "missing" }, { status: 404 });
  clearPlatformSnapshot();
  await recordSecurityEvent({
    organizationId: id,
    actorUserId: access.ctx.user.id,
    action: "admin_account_status",
    target: id,
    detail: decision.status,
  });
  return NextResponse.json({ ok: true, status: updated.status });
}
