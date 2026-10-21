import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SecurityError } from "@/product/security/service";
import { getSecurityService } from "@/product/security/runtime";
import { requireTenantContext } from "@/product/saas/tenant";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  kind: z.enum(["access", "correction", "deletion"]),
  subjectRef: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/),
});

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const tenant = await requireTenantContext();
  if (!tenant.ok)
    return NextResponse.json(
      { error: tenant.error },
      { status: tenant.status },
    );
  if (tenant.ctx.organization.id !== id && !tenant.ctx.isPlatformAdmin) {
    return NextResponse.json(
      { error: "Not a member of this business." },
      { status: 403 },
    );
  }
  try {
    getSecurityService().assertPermission(
      tenant.ctx.membership.role,
      "manage_security",
      tenant.ctx.isPlatformAdmin,
    );
  } catch {
    return NextResponse.json(
      { error: "Insufficient permissions." },
      { status: 403 },
    );
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid privacy request." },
      { status: 400 },
    );
  const row = await getSecurityService().openPrivacyRequest({
    organizationId: id,
    ...parsed.data,
  });
  return NextResponse.json({
    ok: true,
    request: { id: row.id, kind: row.kind, status: row.status },
  });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const tenant = await requireTenantContext();
  if (!tenant.ok)
    return NextResponse.json(
      { error: tenant.error },
      { status: tenant.status },
    );
  if (tenant.ctx.organization.id !== id && !tenant.ctx.isPlatformAdmin) {
    return NextResponse.json(
      { error: "Not a member of this business." },
      { status: 403 },
    );
  }
  try {
    getSecurityService().assertPermission(
      tenant.ctx.membership.role,
      "manage_security",
      tenant.ctx.isPlatformAdmin,
    );
  } catch {
    return NextResponse.json(
      { error: "Insufficient permissions." },
      { status: 403 },
    );
  }
  const body = z
    .object({
      requestId: z.string(),
      name: z.string().max(120).optional(),
      phone: z.string().max(20).optional(),
      address: z.string().max(200).optional(),
    })
    .safeParse(await request.json().catch(() => null));
  if (!body.success)
    return NextResponse.json(
      { error: "Invalid privacy request." },
      { status: 400 },
    );
  try {
    await getSecurityService().completePrivacyRequest(
      id,
      body.data.requestId,
      body.data,
    );
    return NextResponse.json(
      { error: "Privacy fulfillment has not been verified." },
      { status: 409 },
    );
  } catch (error) {
    const status = error instanceof SecurityError ? error.status : 500;
    return NextResponse.json(
      {
        error:
          error instanceof SecurityError
            ? error.message
            : "Privacy request could not be processed.",
      },
      { status },
    );
  }
}
