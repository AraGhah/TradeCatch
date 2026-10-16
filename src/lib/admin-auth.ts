import { authorizeOpsRequest, getOpsSecret } from "@/lib/ops-auth";
import { isPlatformAdminUser } from "@/product/saas/platform-admin";
import { requireTenantContext } from "@/product/saas/tenant";
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
  return { ok: true, via: "session", ctx: session.ctx };
}
