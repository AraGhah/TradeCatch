import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { canManageBilling } from "@/product/billing/requireEntitlement";
import { getSaasStore } from "@/product/saas/runtime";
import { requireTenantContext } from "@/product/saas/tenant";
import type { Organization, TenantContext } from "@/product/saas/types";

export type BillingAccess =
  | {
      ok: true;
      organization: Organization;
      ctx: TenantContext | null;
      canManage: boolean;
      via: "admin" | "member";
    }
  | { ok: false; response: NextResponse };

export async function authorizeBillingAccess(
  request: NextRequest,
  businessId: string,
  opts?: { manage?: boolean },
): Promise<BillingAccess> {
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
      via: "admin",
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
        { error: "Billing is isolated per business." },
        { status: 403 },
      ),
    };
  }
  if (opts?.manage && !canManageBilling(tenant.ctx)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Only owners and admins can manage billing." },
        { status: 403 },
      ),
    };
  }
  return {
    ok: true,
    organization: tenant.ctx.organization,
    ctx: tenant.ctx,
    canManage: canManageBilling(tenant.ctx),
    via: "member",
  };
}
