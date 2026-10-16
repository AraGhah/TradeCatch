import type { FeatureId } from "@/product/saas/entitlements";
import { upgradePlanForFeature } from "@/product/saas/entitlements";
import {
  requireTenantContext,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import type { TenantContext } from "@/product/saas/types";
import { assertEffectiveFeature } from "./entitlementService";
import { getSubscriptionService } from "./runtime";

export async function requireBusinessEntitlement(feature: FeatureId): Promise<
  | {
      ok: true;
      ctx: TenantContext;
      entitlements: Awaited<
        ReturnType<ReturnType<typeof getSubscriptionService>["getEffective"]>
      >;
    }
  | { ok: false; response: Response }
> {
  const auth = await requireTenantContext();
  if (!auth.ok) {
    return {
      ok: false,
      response: unauthorizedTenantResponse(auth.error),
    };
  }

  const entitlements = await getSubscriptionService().getEffective(
    auth.ctx.organization.id,
    auth.ctx.organization.plan,
  );
  const check = assertEffectiveFeature(entitlements, feature);
  if (!check.ok) {
    return {
      ok: false,
      response: Response.json(
        {
          error: "Feature not included in your plan.",
          feature: check.feature,
          plan: check.plan,
          upgrade: check.upgrade,
          accessMode: check.accessMode,
          reason: check.reason,
        },
        { status: 402 },
      ),
    };
  }

  return { ok: true, ctx: auth.ctx, entitlements };
}

export function entitlementDeniedResponse(
  feature: FeatureId,
  plan: string,
) {
  return Response.json(
    {
      error: "Feature not included in your plan.",
      feature,
      plan,
      upgrade: upgradePlanForFeature(feature),
    },
    { status: 402 },
  );
}

/** Owner or admin (or platform admin) may manage billing for a business. */
export function canManageBilling(ctx: TenantContext): boolean {
  return (
    ctx.isPlatformAdmin ||
    ctx.membership.role === "owner" ||
    ctx.membership.role === "admin"
  );
}
