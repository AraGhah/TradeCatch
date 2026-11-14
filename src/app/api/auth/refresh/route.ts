import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/rate-limit";
import { consumePolicy } from "@/lib/rate-limit-policy";
import { tooManyRequests } from "@/lib/rate-limit-response";
import { refreshSession } from "@/product/saas/auth/refresh-token";
import {
  safeReturnPath,
  safeSignedInPath,
} from "@/product/saas/auth/return-path";
import {
  authJson,
  clearSessionCookies,
  homePathFor,
  loginPath,
  NO_STORE,
  setSessionCookies,
} from "@/product/saas/auth/route-helpers";
import { REFRESH_COOKIE } from "@/product/saas/auth/session-token";

export const dynamic = "force-dynamic";

const PRIVATE = {
  ...NO_STORE,
  "Referrer-Policy": "no-referrer",
} as const;

function localeOf(path: string | null): "en" | "fr" {
  return path?.startsWith("/fr/") ? "fr" : "en";
}

/**
 * GET: used by the proxy when a page in the signed-in area is opened after the
 * short-lived access token expired. Renews the sign-in and sends the browser
 * back to the page, or to the login page when there is nothing to renew.
 * Renewing only rotates the person's own tokens in their own browser, so it is
 * safe even when the navigation started on another site.
 */
export async function GET(request: NextRequest) {
  const next = safeSignedInPath(request.nextUrl.searchParams.get("next"));
  const locale = localeOf(next);

  const toLogin = () => {
    const back = safeReturnPath(next);
    const target = new URL(loginPath(locale), request.url);
    if (back) target.searchParams.set("next", back);
    const response = NextResponse.redirect(target, {
      status: 303,
      headers: PRIVATE,
    });
    clearSessionCookies(response);
    return response;
  };

  const raw = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!raw) return toLogin();

  const budget = await consumePolicy("auth.refresh", {
    ip: getClientIp(request),
  });
  if (!budget.allowed) return toLogin();

  try {
    const result = await refreshSession({ rawToken: raw });
    if (!result.ok) return toLogin();
    const fallback = homePathFor(
      locale,
      result.billingOnly,
      result.isPlatformAdmin,
    );
    // A billing-only business may not enter the workspace or admin pages.
    const target =
      next &&
      (!result.billingOnly || next === "/billing" || next === "/fr/facturation")
        ? next
        : fallback;
    const response = NextResponse.redirect(new URL(target, request.url), {
      status: 303,
      headers: PRIVATE,
    });
    setSessionCookies(response, result.tokens);
    return response;
  } catch {
    console.error("[auth/refresh] renewal unavailable");
    return toLogin();
  }
}

/**
 * POST: the signed-in pages call this shortly before the access token expires
 * (and once more when an API call answers 401). Answers only with the new
 * expiry; the tokens themselves travel only in HttpOnly cookies.
 */
export async function POST(request: NextRequest) {
  const budget = await consumePolicy("auth.refresh", {
    ip: getClientIp(request),
  });
  if (!budget.allowed)
    return tooManyRequests(budget, { error: "rate_limited" }, NO_STORE);

  const raw = request.cookies.get(REFRESH_COOKIE)?.value;
  const failed = (error: string, status: number) => {
    const response = authJson({ error }, status);
    clearSessionCookies(response);
    return response;
  };
  if (!raw) return failed("not_authenticated", 401);

  try {
    const result = await refreshSession({ rawToken: raw });
    if (!result.ok) {
      return result.error === "unavailable"
        ? authJson({ error: "unavailable" }, 503)
        : failed("session_expired", 401);
    }
    const response = authJson({
      ok: true,
      accessExpiresAt: result.tokens.accessExpiresAt,
    });
    setSessionCookies(response, result.tokens);
    return response;
  } catch {
    console.error("[auth/refresh] renewal unavailable");
    return authJson({ error: "unavailable" }, 503);
  }
}
