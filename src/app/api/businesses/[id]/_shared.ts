import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import type { ClientAccount } from "@/product/missed-call/types";
import { getSaasStore } from "@/product/saas/runtime";
import { requireTenantContext } from "@/product/saas/tenant";
import type { Organization, TenantContext } from "@/product/saas/types";
import { orgHasFeature } from "@/product/saas/entitlements";

export type BusinessAccess =
  | {
      ok: true;
      via: "admin" | "member";
      organization: Organization;
      role: "owner" | "admin" | "member" | "viewer";
      userEmail: string;
      ctx?: TenantContext;
    }
  | { ok: false; response: NextResponse };

export async function authorizeBusinessMemberOrAdmin(
  request: NextRequest,
  organizationId: string,
): Promise<BusinessAccess> {
  const admin = await authorizeAdminRequest(request);
  if (admin.ok) {
    const org = await getSaasStore().getOrganization(organizationId);
    if (!org) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Not found" }, { status: 404 }),
      };
    }
    return {
      ok: true,
      via: "admin",
      organization: org,
      role: "owner",
      userEmail: admin.ctx?.user.email ?? "ops@tradecatch.local",
      ctx: admin.ctx,
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
  if (tenant.ctx.organization.id !== organizationId) {
    const { recordSecurityEvent } = await import("@/product/security/hooks");
    await recordSecurityEvent({
      organizationId: tenant.ctx.organization.id,
      actorUserId: tenant.ctx.user.id,
      action: "cross_business_denied",
      target: organizationId,
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Not a member of this business." },
        { status: 403 },
      ),
    };
  }
  if (!orgHasFeature(tenant.ctx.organization.plan, "MISSED_CALL_RECOVERY")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "The Receptionist is not available on this plan." },
        { status: 403 },
      ),
    };
  }
  return {
    ok: true,
    via: "member",
    organization: tenant.ctx.organization,
    role: tenant.ctx.membership.role,
    userEmail: tenant.ctx.user.email,
    ctx: tenant.ctx,
  };
}

export async function loadClientForOrg(
  org: Organization,
): Promise<ClientAccount | null> {
  if (!org.missedCallClientId) return null;
  try {
    const { store } = await ensureMissedCallReady();
    return await store.getClient(org.missedCallClientId);
  } catch {
    return null;
  }
}
