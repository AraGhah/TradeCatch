import { cookies } from "next/headers";
import {
  DEFAULT_READ_PERMISSION,
  DEFAULT_WRITE_PERMISSION,
  roleAllows,
  type AdminActor,
  type AdminPermission,
  type AdminRole,
} from "@/lib/admin-rbac";
import { authorizeOpsRequest, getOpsSecret } from "@/lib/ops-auth";
import {
  ADMIN_JWT_COOKIE,
  verifyAdminJwt,
} from "@/product/saas/auth/admin-jwt";
import { adminRoleOf } from "@/product/saas/platform-admin";
import { getAuthSecret, requireTenantContext } from "@/product/saas/tenant";
import type { TenantContext } from "@/product/saas/types";

export {
  isPlatformAdminUser,
  parseAdminEmails,
} from "@/product/saas/platform-admin";

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

export type { AdminActor };

function requestPath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "unknown";
  }
}

async function record(
  request: Request,
  actor: AdminActor,
  extra: { action: string; outcome?: "success" | "denied"; detail?: string },
) {
  const { recordSecurityEvent } = await import("@/product/security/hooks");
  await recordSecurityEvent({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: extra.action,
    target: `${request.method.toUpperCase()} ${requestPath(request)}`.slice(
      0,
      200,
    ),
    outcome: extra.outcome,
    detail: extra.detail,
  });
}

/**
 * Every state-changing administrator request leaves an audit row, whether it
 * arrived with an administrator session or the shared ops secret. Recorded at
 * the single choke point so a new admin route cannot forget to log itself.
 * Only the method and path are stored: never the body, never a secret.
 */
async function auditAdminMutation(request: Request, actor: AdminActor) {
  if (READ_ONLY_METHODS.has(request.method.toUpperCase())) return;
  await record(request, actor, {
    action: "admin_request",
    detail:
      actor.via === "ops"
        ? `via ops secret, actor ${actor.label.replace(/^ops:/, "")}`
        : `via ${actor.via}`,
  });
}

/**
 * Refusing an administrator who reaches past their role is itself a security
 * signal ("suspicious administrative activity"), so it is recorded too.
 */
async function denyForRole(
  request: Request,
  actor: AdminActor,
  permission: AdminPermission,
): Promise<{ ok: false; status: 403; error: string }> {
  await record(request, actor, {
    action: "admin_permission_denied",
    outcome: "denied",
    detail: `needs ${permission}`,
  });
  return {
    ok: false,
    status: 403,
    error: "Your administrator role does not allow this action.",
  };
}

export type AdminAccess =
  | {
      ok: true;
      via: "ops" | "session";
      ctx?: TenantContext;
      role: AdminRole;
      actor: AdminActor;
    }
  | { ok: false; status: 401 | 403; error: string };

/**
 * The single authorization entry point for every /api/admin route.
 *
 * `permission` is what the route needs. When a route does not say, reading
 * needs `admin.read` and any change needs `admin.manage` (super administrators
 * only), so an older route never silently becomes available to a lesser role.
 */
export async function authorizeAdminRequest(
  request: Request,
  permission?: AdminPermission,
): Promise<AdminAccess> {
  const needed: AdminPermission =
    permission ??
    (READ_ONLY_METHODS.has(request.method.toUpperCase())
      ? DEFAULT_READ_PERMISSION
      : DEFAULT_WRITE_PERMISSION);

  const ops = requirePlatformAdminFromRequest(request);
  if (ops) {
    // The shared ops secret is an operator credential held by the founder; it
    // acts as a super administrator and is attributed to the declared actor.
    const named = request.headers.get("x-ops-actor")?.trim().slice(0, 60);
    const actor: AdminActor = {
      label: `ops:${named || "unnamed"}`,
      role: "super_admin",
      via: "ops",
    };
    await auditAdminMutation(request, actor);
    return { ok: true, via: "ops", role: actor.role, actor };
  }

  const session = await requirePlatformAdmin();
  if (!session.ok) return session;
  // requireTenantContext already folds the second factor into isPlatformAdmin;
  // this re-check keeps the guarantee local to the admin entry point.
  const { getSecurityService } = await import("@/product/security/runtime");
  const allowed = await getSecurityService().sessionAllowsAdmin(
    session.ctx.user.id,
    session.ctx.session.id,
  );
  if (!allowed)
    return {
      ok: false,
      status: 403,
      error: "Administrator MFA verification is required.",
    };
  const token = await readMatchingAdminJwt(
    session.ctx.user.id,
    session.ctx.session.id,
  );
  if (!token) return { ok: false, status: 401, error: "Admin token required." };

  const role = adminRoleOf(session.ctx.user);
  if (!role) {
    // Unreachable while requirePlatformAdmin passes, but fail closed anyway.
    return {
      ok: false,
      status: 403,
      error: "Platform administrator access required.",
    };
  }
  const actor: AdminActor = {
    userId: session.ctx.user.id,
    email: session.ctx.user.email,
    label: session.ctx.user.email,
    role,
    via: "session",
  };
  if (!roleAllows(role, needed)) return denyForRole(request, actor, needed);
  await auditAdminMutation(request, actor);
  return { ok: true, via: "session", ctx: session.ctx, role, actor };
}

export async function readMatchingAdminJwt(
  userId: string,
  sessionId: string,
  minValidityMs = 0,
) {
  const secret = getAuthSecret();
  if (!secret) return null;
  const jar = await cookies();
  const raw = jar.get(ADMIN_JWT_COOKIE)?.value;
  if (!raw) return null;
  const claims = await verifyAdminJwt(raw, secret);
  if (!claims || claims.sub !== userId || claims.sid !== sessionId) return null;
  if (claims.exp * 1000 <= Date.now() + minValidityMs) return null;
  return claims;
}
