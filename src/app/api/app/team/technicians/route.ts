import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { forbiddenUnless } from "@/product/security/access";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { getSchedulingService } from "@/product/scheduling/runtime";
import { SchedulingError } from "@/product/scheduling/service";
import { USAGE_ALLOWANCES } from "@/lib/plans";

export const dynamic = "force-dynamic";

const upsertSchema = z
  .object({
    id: z.string().trim().min(1).max(100).optional(),
    name: z.string().trim().min(1).max(120),
    serviceArea: z.string().trim().max(200).optional(),
    active: z.boolean().optional(),
  })
  .strict();

/**
 * Multiple crew calendars is a Pro ("AI Receptionist Pro" / `receptionist`)
 * entitlement — Starter and Growth share the single on-call technician
 * created by `ensure()` in the scheduling service and never reach this
 * route from the UI, but the check here is the actual authorization: the
 * UI hiding the page is not enough.
 */
export async function GET() {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  if (!tenantHasFeature(auth.ctx, "MULTI_CREW_CALENDARS")) {
    return forbiddenFeatureResponse("MULTI_CREW_CALENDARS");
  }
  const technicians = await getSchedulingService().listTechnicians(
    auth.ctx.organization.id,
  );
  return NextResponse.json({ ok: true, technicians });
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  if (!tenantHasFeature(auth.ctx, "MULTI_CREW_CALENDARS")) {
    return forbiddenFeatureResponse("MULTI_CREW_CALENDARS");
  }
  const denied = forbiddenUnless(
    auth.ctx.membership.role,
    "manage_settings",
    auth.ctx.isPlatformAdmin,
  );
  if (denied) return denied;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = upsertSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid technician body.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const service = getSchedulingService();
  if (!parsed.data.id) {
    const existing = await service.listTechnicians(auth.ctx.organization.id);
    const limit = USAGE_ALLOWANCES[auth.ctx.organization.plan].calendars;
    if (existing.filter((tech) => tech.active).length >= limit) {
      return NextResponse.json(
        {
          error: `This plan supports up to ${limit} crew calendar${limit === 1 ? "" : "s"}.`,
          code: "calendar_limit_reached",
        },
        { status: 402 },
      );
    }
  }

  try {
    const technician = await service.upsertTechnician({
      id: parsed.data.id,
      organizationId: auth.ctx.organization.id,
      name: parsed.data.name,
      serviceArea: parsed.data.serviceArea,
      active: parsed.data.active,
    });
    return NextResponse.json({ ok: true, technician });
  } catch (error) {
    if (error instanceof SchedulingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
