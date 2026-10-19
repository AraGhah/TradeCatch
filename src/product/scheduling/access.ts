import { requireTenantContext } from "@/product/saas/tenant";
import { allows } from "@/product/security/permissions";

export async function requireSchedulingAccess(
  organizationId: string,
  mode: "read" | "write",
) {
  const tenant = await requireTenantContext();
  if (!tenant.ok) return tenant;
  const sameBusiness = tenant.ctx.organization.id === organizationId;
  if (!sameBusiness && !tenant.ctx.isPlatformAdmin) {
    return {
      ok: false as const,
      status: 403 as const,
      error: "Not a member of this business.",
    };
  }
  if (
    mode === "write" &&
    !allows(tenant.ctx.membership.role, "manage_settings", tenant.ctx.isPlatformAdmin)
  ) {
    return {
      ok: false as const,
      status: 403 as const,
      error: "Insufficient permissions.",
    };
  }
  return { ok: true as const, ctx: tenant.ctx };
}
