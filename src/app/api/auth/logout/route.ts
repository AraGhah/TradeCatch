import { NextRequest } from "next/server";
import { sessionIdForRefreshToken } from "@/product/saas/auth/refresh-token";
import {
  authJson,
  clearSessionCookies,
} from "@/product/saas/auth/route-helpers";
import { REFRESH_COOKIE } from "@/product/saas/auth/session-token";
import { getSaasStore } from "@/product/saas/runtime";
import { readSessionClaimsFromCookies } from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

/**
 * Signs out: the session row is revoked on the server (so the access token,
 * the refresh token and the admin token all stop working at once, on every
 * copy), then every sign-in cookie is removed. Works even when the access
 * token has already expired, by finding the session from the refresh token.
 */
export async function POST(request: NextRequest) {
  const now = new Date().toISOString();
  const store = getSaasStore();
  try {
    const { claims } = await readSessionClaimsFromCookies();
    let sessionId = claims?.sid ?? null;
    let userId = claims?.uid;
    if (!sessionId) {
      const raw = request.cookies.get(REFRESH_COOKIE)?.value;
      sessionId = raw ? await sessionIdForRefreshToken(raw) : null;
      userId = undefined;
    }
    if (sessionId) {
      const session = await store.getSession(sessionId);
      await store.revokeSession(sessionId, now);
      const { recordSecurityEvent } = await import("@/product/security/hooks");
      await recordSecurityEvent({
        organizationId: session?.organizationId,
        actorUserId: userId ?? session?.userId,
        action: "logout",
        target: sessionId,
      });
    }
  } catch {
    // Still remove the cookies: a sign-out button must always sign this browser out.
    console.error("[auth/logout] session revoke failed");
  }

  const response = authJson({ ok: true });
  clearSessionCookies(response);
  return response;
}
