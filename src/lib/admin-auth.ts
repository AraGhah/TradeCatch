import { cookies } from "next/headers";
import { authorizeOpsRequest, getOpsSecret } from "@/lib/ops-auth";
import {
  ADMIN_JWT_COOKIE,
  verifyAdminJwt,
} from "@/product/saas/auth/admin-jwt";
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
  if (!auth.ctx.isPlatformAdminIdentity) {
    return {
      ok: false,
      status: 403,
      error: "Platform administrator access required.",
    };
  }
  // `isPlatformAdmin` is only true once this session passed the second factor.
  if (!auth.ctx.isPlatformAdmin) {
    return {
      ok: false,
      status: 403,
      error: "Administrator MFA verification is required.",
    };
  }
  return { ok: true, via: "session", ctx: auth.ctx };
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

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Every state-changing administrator request leaves an audit row, whether it
 * arrived with an administrator session or the shared ops secret. Recorded at
 * the single choke point so a new admin route cannot forget to log itself.
 * Only the method and path are stored: never the body, never a secret.
 */
async function auditAdminMutation(request: Request, via: "ops" | "session", actorUserId?: string) {
  if (READ_ONLY_METHODS.has(request.method.toUpperCase())) return;
  const { recordSecurityEvent } = await import("@/product/security/hooks");
  let path = "unknown";
  try {
    path = new URL(request.url).pathname;
  } catch {
    // keep "unknown"
  }
  const opsActor = via === "ops" ? request.headers.get("x-ops-actor")?.trim().slice(0, 60) : undefined;
  await recordSecurityEvent({
    actorUserId,
    action: "admin_request",
    target: `${request.method.toUpperCase()} ${path}`.slice(0, 200),
    detail: opsActor ? `via ops secret, actor ${opsActor}` : `via ${via}`,
  });
}

export async function authorizeAdminRequest(request: Request): Promise<
  | { ok: true; via: "ops" | "session"; ctx?: TenantContext }
  | { ok: false; status: 401 | 403; error: string }
> {
  const ops = requirePlatformAdminFromRequest(request);
  if (ops) {
    await auditAdminMutation(request, "ops");
    return ops;
  }

  const session = await requirePlatformAdmin();
  if (!session.ok) return session;
  // requireTenantContext already folds the second factor into isPlatformAdmin;
  // this re-check keeps the guarantee local to the admin entry point.
  const { getSecurityService } = await import("@/product/security/runtime");
  const allowed = await getSecurityService().sessionAllowsAdmin(session.ctx.user.id, session.ctx.session.id);
  if (!allowed) return { ok: false, status: 403, error: "Administrator MFA verification is required." };
  const token = await readMatchingAdminJwt(session.ctx.user.id, session.ctx.session.id);
  if (!token) return { ok: false, status: 401, error: "Admin token required." };
  await auditAdminMutation(request, "session", session.ctx.user.id);
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
