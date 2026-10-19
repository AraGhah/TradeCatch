import { NextRequest, NextResponse } from "next/server";
import { allows } from "@/product/security/permissions";
import { z } from "zod";
import { requireTenantContext } from "@/product/saas/tenant";
import { getReliabilityService } from "@/product/reliability/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  aiUnavailable: z.enum(["transfer", "voicemail"]),
  transferFailed: z.enum(["voicemail", "backup"]),
});

async function access(organizationId: string, write: boolean) {
  const tenant = await requireTenantContext();
  if (!tenant.ok) return tenant;
  if (tenant.ctx.organization.id !== organizationId && !tenant.ctx.isPlatformAdmin) {
    return { ok: false as const, status: 403 as const, error: "Not a member of this business." };
  }
  if (write && !allows(tenant.ctx.membership.role, "manage_settings", tenant.ctx.isPlatformAdmin)) {
    return { ok: false as const, status: 403 as const, error: "Insufficient permissions." };
  }
  return { ok: true as const, ctx: tenant.ctx };
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const gate = await access(id, false);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  return NextResponse.json({ ok: true, settings: await getReliabilityService().fallback(id) });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const gate = await access(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid fallback settings." }, { status: 400 });
  const current = await getReliabilityService().fallback(id);
  const settings = await getReliabilityService().saveFallback({
    ...current,
    organizationId: id,
    aiUnavailable: parsed.data.aiUnavailable,
    transferFailed: parsed.data.transferFailed,
  });
  return NextResponse.json({ ok: true, settings });
}
