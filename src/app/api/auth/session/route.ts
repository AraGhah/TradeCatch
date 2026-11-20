import { NextRequest } from "next/server";
import { resolveAccountState } from "@/product/saas/auth/account-destination";
import {
  authJson,
  clearSessionCookies,
} from "@/product/saas/auth/route-helpers";
import {
  REFRESH_COOKIE,
  SESSION_COOKIE,
} from "@/product/saas/auth/session-token";

export const dynamic = "force-dynamic";

/**
 * Who is looking at the site, for the profile icon in the header: signed out,
 * or signed in with where their account lives. The answer comes from the
 * signed access token and the session row (or a refresh token that is still
 * good), never from anything the browser claims.
 *
 * It carries no token, name, email or business: only a state, a role word and a
 * page address, so there is nothing here worth stealing. It never rotates a
 * refresh token (that is POST /api/auth/refresh's job, and two tabs rotating
 * at once would look like theft), so asking costs nothing and can be repeated.
 * Sign-in cookies that no longer work are removed in the same answer; when the
 * store cannot be reached it answers 503 and removes nothing.
 */
export async function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get("locale") === "fr" ? "fr" : "en";
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  const hasCredentials =
    Boolean(refreshToken) || request.cookies.has(SESSION_COOKIE);

  try {
    const account = await resolveAccountState({
      locale,
      refreshToken,
      hasCredentials,
    });
    if (account.state === "signed_in") {
      return authJson({
        state: "signed_in",
        role: account.role,
        destination: account.destination,
      });
    }
    const response = authJson({
      state: "anonymous",
      destination: account.destination,
    });
    if (account.invalid) clearSessionCookies(response);
    return response;
  } catch {
    console.error("[auth/session] session check unavailable");
    return authJson({ state: "unavailable" }, 503);
  }
}
