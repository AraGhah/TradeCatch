import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SecurityError } from "@/product/security/service";
import { getSecurityService } from "@/product/security/runtime";
import { requireTenantContext } from "@/product/saas/tenant";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  disclosureEnabled: z.boolean(),
  recordingEnabled: z.boolean(),
  retentionDays: z.number().int().min(1).max(365),
  onDenied: z.enum(["continue_without_recording", "end_call"]),
});

async function gate(organizationId: string, write: boolean) {
  const tenant = await requireTenantContext();
  if (!tenant.ok) return tenant;
  if (tenant.ctx.organization.id !== organizationId && !tenant.ctx.isPlatformAdmin) {
    return { ok: false as const, status: 403 as const, error: "Not a member of this business." };
  }
  if (write) {
    try {
      getSecurityService().assertPermission(tenant.ctx.membership.role, "manage_ai", tenant.ctx.isPlatformAdmin);
    } catch (error) {
      const status = error instanceof SecurityError ? error.status : 403;
      return { ok: false as const, status, error: "Insufficient permissions." };
    }
  }
  return { ok: true as const, ctx: tenant.ctx };
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await gate(id, false);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  return NextResponse.json({ ok: true, settings: await getSecurityService().recording(id) });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await gate(id, true);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid privacy settings." }, { status: 400 });
  const settings = await getSecurityService().saveRecording({ organizationId: id, ...parsed.data, updatedAt: new Date().toISOString() });
  return NextResponse.json({ ok: true, settings });
}
