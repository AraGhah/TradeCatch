import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_JWT_COOKIE, adminJwtCookieOptions } from "./admin-jwt";
import type { SessionTokens } from "./refresh-token";
import { safeReturnPath } from "./return-path";
import type { StartedSession } from "./session-start";
import { refreshCookieOptions, sessionCookieOptions } from "./session-token";

/** Sign-in answers must never be cached by a browser, proxy or CDN. */
export const NO_STORE = { "Cache-Control": "no-store, private" } as const;

export function authJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function authOrigin(request: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    request.nextUrl.origin
  );
}

export function localePath(locale: "en" | "fr", english: string, french: string) {
  return locale === "fr" ? french : english;
}

export function loginPath(locale: "en" | "fr") {
  return localePath(locale, "/login", "/fr/connexion");
}

/**
 * Where a freshly signed-in person lands: administrators on the admin
 * dashboard (which still asks for their second factor), customers on their
 * own workspace, and a business that is not active on billing only.
 */
export function homePathFor(
  locale: "en" | "fr",
  billingOnly: boolean,
  isPlatformAdmin = false,
): string {
  if (billingOnly) return localePath(locale, "/billing", "/fr/facturation");
  if (isPlatformAdmin) return localePath(locale, "/admin", "/fr/admin");
  return localePath(locale, "/app", "/fr/app");
}

type CookieWriter = Pick<NextResponse, "cookies">;

/** Writes the access token and (when there is one) the refresh token. */
export function setSessionCookies(response: CookieWriter, tokens: SessionTokens) {
  const access = sessionCookieOptions(tokens.accessMaxAge);
  response.cookies.set(access.name, tokens.accessToken, access);
  if (tokens.refreshToken) {
    const refresh = refreshCookieOptions(tokens.refreshMaxAge);
    response.cookies.set(refresh.name, tokens.refreshToken, refresh);
  }
}

/** Removes every sign-in cookie (access, refresh and the admin token). */
export function clearSessionCookies(response: CookieWriter) {
  const access = sessionCookieOptions(0);
  response.cookies.set(access.name, "", access);
  const refresh = refreshCookieOptions(0);
  response.cookies.set(refresh.name, "", refresh);
  response.cookies.set(ADMIN_JWT_COOKIE, "", adminJwtCookieOptions(0));
}

/** A JSON success answer that also sets the sign-in cookies. */
export function signedInResponse(
  session: Extract<StartedSession, { ok: true }>,
  locale: "en" | "fr",
  returnTo?: unknown,
) {
  // Back to the page they were trying to reach, if it is one of ours. A
  // billing-only session may not enter the workspace, so it always gets billing.
  const back = session.billingOnly ? null : safeReturnPath(returnTo);
  const response = authJson({
    ok: true,
    next: back ?? homePathFor(locale, session.billingOnly, session.isPlatformAdmin),
  });
  setSessionCookies(response, session.tokens);
  return response;
}
