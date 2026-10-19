import { cookies } from "next/headers";
import { isPlatformAdminUser } from "@/product/saas/platform-admin";
import {
  featuresForPlan,
  orgHasFeature,
  type FeatureId,
} from "./entitlements";
import { getSaasStore } from "./runtime";
import { getAuthSecret } from "./auth/secret";
import {
  SESSION_COOKIE,
  verifySessionClaims,
} from "./auth/session-token";
import type { TenantContext } from "./types";

export { getAuthSecret };

export async function readSessionClaimsFromCookies(): Promise<{
  claims: Awaited<ReturnType<typeof verifySessionClaims>>;
  secret: string | null;
}> {
  const secret = getAuthSecret();
  if (!secret) return { claims: null, secret: null };
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return { claims: null, secret };
  const claims = await verifySessionClaims(token, secret);
  return { claims, secret };
}

/**
 * Full tenant context for Server Components / route handlers.
 * Verifies signed cookie then loads org membership from the SaaS store
 * (revocation + status checks).
 */
export async function requireTenantContext(): Promise<
  | { ok: true; ctx: TenantContext }
  | { ok: false; status: 401 | 403; error: string }
> {
  const { claims, secret } = await readSessionClaimsFromCookies();
  if (!secret) {
    return {
      ok: false,
      status: 401,
      error: "Auth is not configured (AUTH_SECRET).",
    };
  }
  if (!claims) {
    return { ok: false, status: 401, error: "Not authenticated." };
  }

  const store = getSaasStore();
  const session = await store.getSession(claims.sid);
  if (
    !session ||
    session.revokedAt ||
    Date.parse(session.expiresAt) <= Date.now()
  ) {
    return { ok: false, status: 401, error: "Session expired." };
  }
  if (
    session.userId !== claims.uid ||
    session.organizationId !== claims.oid
  ) {
    return { ok: false, status: 401, error: "Session mismatch." };
  }

  const [user, organization, membership] = await Promise.all([
    store.getUser(claims.uid),
    store.getOrganization(claims.oid),
    store.getMembership(claims.oid, claims.uid),
  ]);

  if (!user || !organization || !membership) {
    return { ok: false, status: 403, error: "Membership not found." };
  }
  if (organization.status !== "active") {
    return { ok: false, status: 403, error: "Organization is not active." };
  }

  // Being on the administrator list identifies a person; it grants nothing by
  // itself. Cross-tenant power (`isPlatformAdmin`) additionally needs a second
  // factor verified for this very session, so every access helper that checks
  // `ctx.isPlatformAdmin` is covered without each one remembering to ask.
  const adminIdentity = isPlatformAdminUser(user);
  let adminVerified = false;
  if (adminIdentity) {
    const { getSecurityService } = await import("@/product/security/runtime");
    adminVerified = await getSecurityService().sessionAllowsAdmin(user.id, session.id);
  }

  return {
    ok: true,
    ctx: {
      session,
      user,
      organization,
      membership,
      features: featuresForPlan(organization.plan),
      isPlatformAdminIdentity: adminIdentity,
      isPlatformAdmin: adminIdentity && adminVerified,
    },
  };
}

export function tenantHasFeature(
  ctx: TenantContext,
  feature: FeatureId,
): boolean {
  return orgHasFeature(ctx.organization.plan, feature);
}

export function forbiddenFeatureResponse(feature: FeatureId) {
  return Response.json(
    {
      error: "Feature not included in your plan.",
      feature,
      upgrade: "growth",
    },
    { status: 402 },
  );
}

export function unauthorizedTenantResponse(message = "Unauthorized") {
  return Response.json({ error: message }, { status: 401 });
}
