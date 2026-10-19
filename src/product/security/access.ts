import { NextResponse } from "next/server";
import { requireTenantContext } from "@/product/saas/tenant";
import type { MemberRole } from "@/product/saas/types";
import { allows, type SecurityAction } from "./permissions";

/**
 * The 403 to return when `role` may not perform `action`, or null when it may.
 * Owners and admins can do everything, members can read and work leads, and
 * viewers can only read (see permissions.ts).
 */
export function forbiddenUnless(role: MemberRole, action: SecurityAction, platformAdmin = false): NextResponse | null {
  return allows(role, action, platformAdmin)
    ? null
    : NextResponse.json({ error: "Insufficient permissions." }, { status: 403 });
}

export async function requireSameBusiness(organizationId: string) {
  const tenant = await requireTenantContext();
  if (!tenant.ok) return tenant;
  if (tenant.ctx.organization.id !== organizationId && !tenant.ctx.isPlatformAdmin) {
    return { ok: false as const, status: 403 as const, error: "Not a member of this business." };
  }
  return { ok: true as const, ctx: tenant.ctx };
}
