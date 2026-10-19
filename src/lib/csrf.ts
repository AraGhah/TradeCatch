/**
 * Cross-site request forgery guard for cookie-authenticated API calls.
 *
 * The session cookies are SameSite=Lax (the admin token Strict), which already
 * keeps browsers from attaching them to a cross-site POST. This is the second
 * layer, for what SameSite does not cover: another site under the same
 * registrable domain, and browsers that ignore the attribute.
 *
 * It only ever refuses a request that carries one of our sign-in cookies, so
 * webhooks, bearer-secret cron calls and the public lead API (none of which
 * carry them) are not affected. No framework imports: this runs in the Edge
 * middleware.
 */

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Literals so the Edge middleware does not import auth code. A unit test checks
// they equal SESSION_COOKIE and ADMIN_JWT_COOKIE.
export const AUTH_COOKIE_NAMES = ["tc_session", "tc_admin"] as const;

export function carriesAuthCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(";").some((part) => {
    const name = part.split("=")[0]?.trim();
    return (
      name !== undefined &&
      (AUTH_COOKIE_NAMES as readonly string[]).includes(name)
    );
  });
}

/**
 * True when a state-changing request that is authenticated by cookie was
 * started by a different origin than the one it is being sent to.
 *
 * `Sec-Fetch-Site` is set by the browser and cannot be forged by page script,
 * so it decides when present. `Origin` covers clients without it. A request
 * with neither is not from a browser page (browsers always send one of the
 * two on a cross-origin POST), so it cannot be a forged form or fetch.
 */
export function isCrossSiteMutation(input: {
  method: string;
  headers: Headers;
  /** Hostnames this deployment answers to, e.g. the Host header and the public site URL. */
  hosts: Array<string | null | undefined>;
}): boolean {
  if (!UNSAFE_METHODS.has(input.method.toUpperCase())) return false;
  if (!carriesAuthCookie(input.headers.get("cookie"))) return false;

  const fetchSite = input.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite) return fetchSite !== "same-origin" && fetchSite !== "none";

  const origin = input.headers.get("origin");
  if (!origin) return false;
  if (origin === "null") return true;
  try {
    const originHost = new URL(origin).host;
    return !input.hosts.some((host) => host && host === originHost);
  } catch {
    return true;
  }
}
