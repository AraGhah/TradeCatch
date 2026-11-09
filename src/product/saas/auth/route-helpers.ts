import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieOptions } from "./magic-link";
import { safeReturnPath } from "./return-path";
import type { StartedSession } from "./session-start";

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

/** Where a freshly signed-in person lands. */
export function homePathFor(locale: "en" | "fr", billingOnly: boolean): string {
  if (billingOnly) return localePath(locale, "/billing", "/fr/facturation");
  return localePath(locale, "/app", "/fr/app");
}

/** A JSON success answer that also sets the session cookie. */
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
    next: back ?? homePathFor(locale, session.billingOnly),
  });
  const options = sessionCookieOptions(session.maxAge);
  response.cookies.set(options.name, session.cookieValue, options);
  return response;
}
