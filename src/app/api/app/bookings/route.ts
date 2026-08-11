import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { getGrowthServices, getGrowthStore } from "@/product/growth";
import {
  looksLikeE164,
  resolveBusinessNameForOrganization,
  resolveSmsFromForOrganization,
} from "@/product/starter/org-context";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  customerName: z.string().trim().max(120).optional(),
  customerPhoneE164: z.string().trim().min(8).max(32).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function GET() {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  if (!tenantHasFeature(auth.ctx, "APPOINTMENT_BOOKING")) {
    return forbiddenFeatureResponse("APPOINTMENT_BOOKING");
  }

  const appointments = await getGrowthStore().listAppointments(
    auth.ctx.organization.id,
  );
  return NextResponse.json({ ok: true, appointments });
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  if (!tenantHasFeature(auth.ctx, "APPOINTMENT_BOOKING")) {
    return forbiddenFeatureResponse("APPOINTMENT_BOOKING");
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid booking body.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  let phone = parsed.data.customerPhoneE164?.trim();
  if (phone) {
    if (!phone.startsWith("+")) phone = `+${phone.replace(/\D/g, "")}`;
    if (!looksLikeE164(phone)) {
      return NextResponse.json(
        { error: "customerPhoneE164 must be E.164." },
        { status: 400 },
      );
    }
  }

  const orgId = auth.ctx.organization.id;
  const [smsFromE164, businessName] = await Promise.all([
    resolveSmsFromForOrganization(orgId),
    resolveBusinessNameForOrganization(orgId),
  ]);

  const appointment = await getGrowthServices().bookAppointment({
    organizationId: orgId,
    title: parsed.data.title,
    startsAt: parsed.data.startsAt,
    endsAt: parsed.data.endsAt,
    customerName: parsed.data.customerName,
    customerPhoneE164: phone,
    notes: parsed.data.notes,
    businessName,
    smsFromE164: smsFromE164 ?? undefined,
  });

  return NextResponse.json({ ok: true, appointment });
}
