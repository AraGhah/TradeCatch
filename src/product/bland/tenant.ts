/**
 * Which business is on this Bland call.
 *
 * The answer comes only from trusted configuration: the operator's
 * BLAND_ROUTES_JSON maps the Bland number that was dialed to one receptionist
 * config. Nothing the model or the caller says can change it, and there is no
 * default tenant. Each request then re-checks, in this order:
 *
 *   1. the number is routed, and the config is enabled
 *   2. the owner has not switched the line off (fresh read, not the 30 s cache)
 *   3. for an owner's business: the organization is active and its CURRENT
 *      plan still includes the voice receptionist; the plan's limits (phone
 *      booking, live transfer, emergency routing) are re-applied to the config
 *
 * Founder-managed env configs have no plan to enforce, like everywhere else.
 * A call id is then bound to this tenant for good by the call service
 * (CallTenantMismatchError), so a leaked or guessed id cannot reach another
 * business's session.
 */

import {
  applyVoicePlanLimits,
  voiceCapabilitiesForPlan,
  type VoiceCapabilities,
} from "@/product/receptionist/plan-limits";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import type { ReceptionistConfig } from "@/product/receptionist/types";
import type { PlanId } from "@/product/saas/entitlements";
import { findBlandRoute, type BlandRoute } from "./routes";

export type BlandTenant = {
  route: BlandRoute;
  /** The receptionist config with the plan's limits applied. */
  config: ReceptionistConfig;
  /** Present for an owner's business; null for a founder env config. */
  organizationId: string | null;
  capabilities?: VoiceCapabilities;
};

export type TenantFailure = {
  ok: false;
  status: 403 | 404 | 503;
  code:
    | "no_route"
    | "no_receptionist"
    | "line_inactive"
    | "organization_inactive"
    | "plan_without_voice"
    | "unavailable";
};

export type TenantDeps = {
  findRoute(to: string): BlandRoute | null;
  refresh(): Promise<void>;
  configs(): ReceptionistConfig[];
  confirmLineActive(config: ReceptionistConfig): Promise<boolean>;
  findOrganization(
    clientAccountId: string,
  ): Promise<{ id: string; status: string; plan: PlanId } | null>;
};

export function defaultTenantDeps(): TenantDeps {
  const runtime = getReceptionistRuntime();
  return {
    findRoute: (to) => findBlandRoute(to),
    refresh: () => runtime.refresh(false),
    configs: () => runtime.configs,
    confirmLineActive: (config) => runtime.confirmLineActive(config),
    async findOrganization(clientAccountId) {
      const { getSaasStore } = await import("@/product/saas/runtime");
      return getSaasStore().findOrganizationByMissedCallClientId(clientAccountId);
    },
  };
}

export async function resolveBlandTenant(
  to: string,
  deps: TenantDeps = defaultTenantDeps(),
): Promise<{ ok: true; tenant: BlandTenant } | TenantFailure> {
  const route = deps.findRoute(to);
  if (!route) return { ok: false, status: 404, code: "no_route" };
  try {
    await deps.refresh();
    const found = deps.configs().find((c) => c.id === route.configId && c.enabled);
    if (!found) return { ok: false, status: 404, code: "no_receptionist" };
    if (!(await deps.confirmLineActive(found))) {
      return { ok: false, status: 403, code: "line_inactive" };
    }
    if (found.source !== "profile") {
      return {
        ok: true,
        tenant: { route, config: found, organizationId: null },
      };
    }
    const org = await deps.findOrganization(found.clientAccountId);
    if (!org || org.status !== "active") {
      return { ok: false, status: 403, code: "organization_inactive" };
    }
    const capabilities = voiceCapabilitiesForPlan(org.plan);
    if (!capabilities.voice) {
      return { ok: false, status: 403, code: "plan_without_voice" };
    }
    return {
      ok: true,
      tenant: {
        route,
        config: applyVoicePlanLimits(found, capabilities),
        organizationId: org.id,
        capabilities,
      },
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "tradecatch.bland.tenant_failed",
        code: error instanceof Error ? error.name : "Error",
      }),
    );
    return { ok: false, status: 503, code: "unavailable" };
  }
}
