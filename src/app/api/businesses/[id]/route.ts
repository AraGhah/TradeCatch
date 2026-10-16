import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { toDemoBusinessProfile } from "@/product/demo/business-service";
import { getSaasStore } from "@/product/saas/runtime";
import { requireTenantContext } from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    industry: z.string().trim().max(60).nullable().optional(),
    phoneNumber: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/)
      .nullable()
      .optional(),
    city: z.string().trim().max(80).nullable().optional(),
    serviceArea: z.string().trim().max(240).optional(),
    timezone: z.string().trim().min(3).max(64).optional(),
    language: z.enum(["en", "fr"]).optional(),
    subscriptionPlan: z.enum(["starter", "growth"]).optional(),
    accountStatus: z.enum(["active", "suspended"]).optional(),
    features: z
      .object({
        aiReceptionist: z.boolean().optional(),
        appointmentBooking: z.boolean().optional(),
        callTransfer: z.boolean().optional(),
        missedCallRecovery: z.boolean().optional(),
        quoteFollowups: z.boolean().optional(),
      })
      .optional(),
  })
  .strict();

type Params = { params: Promise<{ id: string }> };

async function authorizeBusinessAccess(
  request: NextRequest,
  organizationId: string,
): Promise<
  | { ok: true; via: "admin" | "member" }
  | { ok: false; status: 401 | 403 | 404; error: string }
> {
  const admin = await authorizeAdminRequest(request);
  if (admin.ok) return { ok: true, via: "admin" };

  const tenant = await requireTenantContext();
  if (!tenant.ok) {
    return { ok: false, status: tenant.status, error: tenant.error };
  }
  if (tenant.ctx.organization.id !== organizationId) {
    return {
      ok: false,
      status: 403,
      error: "Not a member of this business.",
    };
  }
  return { ok: true, via: "member" };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessAccess(request, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const saas = getSaasStore();
  const org = await saas.getOrganization(id);
  if (!org) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const members = await saas.listMembershipsForOrganization(org.id);
  const ownerMem = members.find((m) => m.role === "owner") ?? members[0];
  const owner = ownerMem ? await saas.getUser(ownerMem.userId) : null;

  return NextResponse.json({
    ok: true,
    business: toDemoBusinessProfile(org, owner),
  });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessAccess(request, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // Employees (member role) cannot change plan/features — owners and admins can.
  if (access.via === "member") {
    const tenant = await requireTenantContext();
    if (
      tenant.ok &&
      tenant.ctx.membership.role === "member" &&
      !tenant.ctx.isPlatformAdmin
    ) {
      return NextResponse.json(
        { error: "Insufficient permissions to update business settings." },
        { status: 403 },
      );
    }
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const saas = getSaasStore();
  const updated = await saas.updateOrganization(id, {
    name: parsed.data.name,
    industry: parsed.data.industry,
    phoneE164: parsed.data.phoneNumber,
    city: parsed.data.city,
    serviceArea: parsed.data.serviceArea,
    timezone: parsed.data.timezone,
    localeDefault: parsed.data.language,
    plan: parsed.data.subscriptionPlan,
    status: parsed.data.accountStatus,
    features: parsed.data.features,
  });

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    business: toDemoBusinessProfile(updated),
  });
}
