import { NextRequest, NextResponse } from "next/server";
import { forbiddenUnless } from "@/product/security/access";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { getGrowthServices, getGrowthStore } from "@/product/growth";

export const dynamic = "force-dynamic";

async function context() {
  const auth = await requireTenantContext();
  if (!auth.ok) return { error: unauthorizedTenantResponse(auth.error) };
  if (!tenantHasFeature(auth.ctx, "CONTRACT_RENEWAL_AUTOMATION")) {
    return { error: forbiddenFeatureResponse("CONTRACT_RENEWAL_AUTOMATION") };
  }
  return { ctx: auth.ctx };
}

type PatchBody = { action?: unknown };

/** Owner/admin records a renewal (advances the cycle) or cancels a contract. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const c = await context();
  if ("error" in c) return c.error;
  const { organization, membership } = c.ctx;

  const denied = forbiddenUnless(
    membership.role,
    "manage_settings",
    c.ctx.isPlatformAdmin,
  );
  if (denied) return denied;

  const { id } = await params;
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (body.action === "renew") {
    const updated = await getGrowthServices().recordContractRenewal({
      organizationId: organization.id,
      contractId: id,
    });
    if (!updated) {
      return NextResponse.json(
        { error: "Contract not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, contract: updated });
  }

  if (body.action === "cancel") {
    const updated = await getGrowthStore().updateServiceContract(
      id,
      organization.id,
      { status: "cancelled" },
    );
    if (!updated) {
      return NextResponse.json(
        { error: "Contract not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, contract: updated });
  }

  return NextResponse.json(
    { error: 'action must be "renew" or "cancel".' },
    { status: 400 },
  );
}
