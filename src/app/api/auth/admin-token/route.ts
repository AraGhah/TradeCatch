import { NextResponse } from "next/server";
import {
  ADMIN_JWT_COOKIE,
  ADMIN_JWT_TTL_SECONDS,
  adminJwtCookieOptions,
  signAdminJwt,
} from "@/product/saas/auth/admin-jwt";
import { isPlatformAdminUser } from "@/product/saas/platform-admin";
import { getAuthSecret, requireTenantContext } from "@/product/saas/tenant";
import { getSecurityService } from "@/product/security/runtime";

export const dynamic = "force-dynamic";

/** Creates the short-lived admin JWT. A signed-in contractor who is not an admin gets nothing. */
export async function POST() {
  const auth = await requireTenantContext();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!isPlatformAdminUser(auth.ctx.user)) {
    return NextResponse.json(
      { error: "Platform administrator access required." },
      { status: 403 },
    );
  }
  const allowed = await getSecurityService().sessionAllowsAdmin(
    auth.ctx.user.id,
    auth.ctx.session.id,
  );
  if (!allowed) {
    return NextResponse.json(
      { error: "Administrator MFA verification is required." },
      { status: 403 },
    );
  }
  const secret = getAuthSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "Auth is not configured (AUTH_SECRET)." },
      { status: 401 },
    );
  }
  const token = await signAdminJwt(
    { sub: auth.ctx.user.id, sid: auth.ctx.session.id },
    secret,
  );
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    ADMIN_JWT_COOKIE,
    token,
    adminJwtCookieOptions(ADMIN_JWT_TTL_SECONDS),
  );
  return response;
}
