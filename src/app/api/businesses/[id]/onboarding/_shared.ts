import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { getSaasStore } from "@/product/saas/runtime";
import { requireTenantContext } from "@/product/saas/tenant";
import type { Organization, TenantContext } from "@/product/saas/types";

export type OnboardingAccess =
  | {
      ok: true;
      organization: Organization;
      ctx: TenantContext | null;
      canManage: boolean;
    }
  | { ok: false; response: NextResponse };

export async function authorizeOnboardingAccess(
  request: NextRequest,
  businessId: string,
  opts?: { manage?: boolean },
): Promise<OnboardingAccess> {
  const admin = await authorizeAdminRequest(request);
  if (admin.ok) {
    const org = await getSaasStore().getOrganization(businessId);
    if (!org) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Not found" }, { status: 404 }),
      };
    }
    return {
      ok: true,
      organization: org,
      ctx: admin.ctx ?? null,
      canManage: true,
    };
  }

  const tenant = await requireTenantContext();
  if (!tenant.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: tenant.error },
        { status: tenant.status },
      ),
    };
  }
  if (tenant.ctx.organization.id !== businessId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Onboarding is isolated per business." },
        { status: 403 },
      ),
    };
  }
  const canManage =
    tenant.ctx.isPlatformAdmin ||
    tenant.ctx.membership.role === "owner" ||
    tenant.ctx.membership.role === "admin";
  if (opts?.manage && !canManage) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Only owners and admins can change onboarding." },
        { status: 403 },
      ),
    };
  }
  return {
    ok: true,
    organization: tenant.ctx.organization,
    ctx: tenant.ctx,
    canManage,
  };
}
