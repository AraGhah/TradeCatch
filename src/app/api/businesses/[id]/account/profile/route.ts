import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSameBusiness } from "@/product/security/access";
import { canManageAccount } from "@/product/support/access";
import { recordSecurityEvent } from "@/product/security/hooks";
import { getSaasStore } from "@/product/saas/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  name: z.string().min(2).max(120),
  city: z.string().max(80).optional(),
  serviceArea: z.string().max(160).optional(),
  industry: z.string().max(80).optional(),
  phoneE164: z
    .string()
    .max(16)
    .refine((value) => value === "" || /^\+[1-9]\d{7,14}$/.test(value))
    .optional(),
});

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSameBusiness(id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!canManageAccount(access.ctx.membership.role, access.ctx.isPlatformAdmin)) {
    return NextResponse.json({ error: "Insufficient permissions." }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid account." }, { status: 400 });
  const updated = await getSaasStore().updateOrganization(id, {
    name: parsed.data.name,
    city: parsed.data.city ?? null,
    serviceArea: parsed.data.serviceArea,
    industry: parsed.data.industry ?? null,
    phoneE164:
      parsed.data.phoneE164 === undefined
        ? undefined
        : parsed.data.phoneE164 || null,
  });
  if (!updated) return NextResponse.json({ error: "Business not found." }, { status: 404 });
  await recordSecurityEvent({
    organizationId: id,
    actorUserId: access.ctx.user.id,
    action: "account_profile_updated",
    target: id,
  });
  return NextResponse.json({ ok: true, organization: { id: updated.id, name: updated.name, city: updated.city, serviceArea: updated.serviceArea } });
}
