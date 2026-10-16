import { requireTenantContext } from "@/product/saas/tenant";

export async function requireNotificationAccess(organizationId: string, mode: "read" | "write") {
  const tenant = await requireTenantContext();
  if (!tenant.ok) return tenant;
  if (tenant.ctx.organization.id !== organizationId && !tenant.ctx.isPlatformAdmin) {
    return { ok: false as const, status: 403 as const, error: "Not a member of this business." };
  }
  if (mode === "write" && tenant.ctx.membership.role === "member" && !tenant.ctx.isPlatformAdmin) {
    return { ok: false as const, status: 403 as const, error: "Insufficient permissions." };
  }
  return { ok: true as const, ctx: tenant.ctx };
}
