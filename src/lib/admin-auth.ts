import { cookies } from "next/headers";
import { authorizeOpsRequest, getOpsSecret } from "@/lib/ops-auth";
import {
  ADMIN_JWT_COOKIE,
  verifyAdminJwt,
} from "@/product/saas/auth/admin-jwt";
import { isPlatformAdminUser } from "@/product/saas/platform-admin";
import { getAuthSecret, requireTenantContext } from "@/product/saas/tenant";
import type { TenantContext } from "@/product/saas/types";

export { isPlatformAdminUser, parseAdminEmails } from "@/product/saas/platform-admin";

export async function requirePlatformAdmin(): Promise<
  | { ok: true; via: "session"; ctx: TenantContext }
  | { ok: false; status: 401 | 403; error: string }
> {
  const auth = await requireTenantContext();
  if (!auth.ok) {
    return { ok: false, status: auth.status, error: auth.error };
  }
  if (!isPlatformAdminUser(auth.ctx.user)) {
    return {
      ok: false,
      status: 403,
      error: "Platform administrator access required.",
    };
  }
  return {
    ok: true,
    via: "session",
    ctx: {
      ...auth.ctx,
      isPlatformAdmin: true,
    },
  };
}

export function requirePlatformAdminFromRequest(request: Request): {
  ok: true;
  via: "ops";
} | null {
  if (getOpsSecret() && authorizeOpsRequest(request)) {
    return { ok: true, via: "ops" };
  }
  return null;
}

export async function authorizeAdminRequest(request: Request): Promise<
  | { ok: true; via: "ops" | "session"; ctx?: TenantContext }
  | { ok: false; status: 401 | 403; error: string }
> {
  const ops = requirePlatformAdminFromRequest(request);
  if (ops) return ops;

  const session = await requirePlatformAdmin();
  if (!session.ok) return session;
  const { getSecurityService } = await import("@/product/security/runtime");
  const allowed = await getSecurityService().sessionAllowsAdmin(session.ctx.user.id, session.ctx.session.id);
  if (!allowed) return { ok: false, status: 403, error: "Administrator MFA verification is required." };
  const token = await readMatchingAdminJwt(session.ctx.user.id, session.ctx.session.id);
  if (!token) return { ok: false, status: 401, error: "Admin token required." };
  return { ok: true, via: "session", ctx: session.ctx };
}

export async function readMatchingAdminJwt(userId: string, sessionId: string) {
  const secret = getAuthSecret();
  if (!secret) return null;
  const jar = await cookies();
  const raw = jar.get(ADMIN_JWT_COOKIE)?.value;
  if (!raw) return null;
  const claims = await verifyAdminJwt(raw, secret);
  if (!claims || claims.sub !== userId || claims.sid !== sessionId) return null;
  return claims;
}
