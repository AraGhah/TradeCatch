import { orgHasFeature } from "@/product/saas/entitlements";
import { getSaasStore } from "@/product/saas/runtime";
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
  // Appointments and the calendar are part of Professional. The check runs here,
  // on the server, for every scheduling endpoint; hiding the menu entry is not
  // the control.
  const organization = sameBusiness
    ? tenant.ctx.organization
    : await getSaasStore().getOrganization(organizationId);
  if (!organization) {
    return {
      ok: false as const,
      status: 404 as const,
      error: "Business not found.",
    };
  }
  if (!orgHasFeature(organization.plan, "APPOINTMENT_BOOKING")) {
    return {
      ok: false as const,
      status: 403 as const,
      error: "Appointments are included with the Professional plan.",
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
