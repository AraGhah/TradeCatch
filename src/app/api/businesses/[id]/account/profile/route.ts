import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSameBusiness } from "@/product/security/access";
import { canManageAccount } from "@/product/support/access";
import { recordSecurityEvent } from "@/product/security/hooks";
import { getSaasStore } from "@/product/saas/runtime";
import { parsePhoneInput } from "@/product/crm/phone";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().max(80).optional(),
  serviceArea: z.string().trim().max(160).optional(),
  industry: z.string().trim().max(80).optional(),
  // Typed the way people write numbers ("514-555-0123"); stored as E.164.
  phoneE164: z.string().trim().max(40).optional(),
});

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSameBusiness(id);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  if (
    !canManageAccount(access.ctx.membership.role, access.ctx.isPlatformAdmin)
  ) {
    return NextResponse.json(
      { error: "Insufficient permissions." },
      { status: 403 },
    );
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    // Name the field so the form can say what to fix.
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return NextResponse.json(
      {
        error: "Invalid account.",
        code: field === "name" ? "invalid_name" : "invalid_values",
        field,
      },
      { status: 400 },
    );
  }
  const phone = parsed.data.phoneE164
    ? parsePhoneInput(parsed.data.phoneE164)
    : parsed.data.phoneE164;
  if (parsed.data.phoneE164 && !phone)
    return NextResponse.json(
      { error: "Invalid account.", code: "invalid_phone", field: "phoneE164" },
      { status: 400 },
    );
  const updated = await getSaasStore().updateOrganization(id, {
    name: parsed.data.name,
    city: parsed.data.city ?? null,
    serviceArea: parsed.data.serviceArea,
    industry: parsed.data.industry ?? null,
    phoneE164: phone === undefined ? undefined : phone || null,
  });
  if (!updated)
    return NextResponse.json({ error: "Business not found." }, { status: 404 });
  await recordSecurityEvent({
    organizationId: id,
    actorUserId: access.ctx.user.id,
    action: "account_profile_updated",
    target: id,
  });
  return NextResponse.json({
    ok: true,
    organization: {
      id: updated.id,
      name: updated.name,
      city: updated.city,
      serviceArea: updated.serviceArea,
      phoneE164: updated.phoneE164 ?? "",
    },
  });
}
