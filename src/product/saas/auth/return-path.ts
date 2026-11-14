/**
 * Where signing in may send someone afterwards.
 *
 * A sign-in page that redirects to whatever the address says is an open
 * redirect: a link on another site could land a customer on a hostile page
 * straight after they typed their password. So only our own signed-in
 * workspace paths are accepted ("/app/..." and "/fr/app/..."), written as a
 * plain path. Anything else (another site, a scheme, "//host", a backslash,
 * control characters, the login page itself) is ignored and the person lands on
 * their usual home instead. Pure and framework-free (it only imports jwt.ts) so
 * the Edge-bundled login preview and the proxy can use it too.
 */
import { unverifiedExpiry } from "./jwt";

const MAX_LENGTH = 300;
const WORKSPACE_PATH = /^\/(?:fr\/)?app(?:\/[A-Za-z0-9._~%!$&'()*+,;=:@-]*)*$/;
// Control characters and backslashes never belong in a path we send people to.
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f\\]/;

const SIGNED_IN_PATH =
  /^\/(?:fr\/)?(?:app|admin)(?:\/[A-Za-z0-9._~%!$&'()*+,;=:@-]*)*$|^\/billing$|^\/fr\/facturation$/;

function checkedPath(raw: unknown, allowed: RegExp): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_LENGTH) return null;
  if (UNSAFE_CHARACTERS.test(value)) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;

  const separator = value.indexOf("?");
  const path = separator === -1 ? value : value.slice(0, separator);
  const query = separator === -1 ? "" : value.slice(separator + 1);
  if (value.includes("#")) return null;
  if (!allowed.test(path)) return null;
  // Encoded dot segments would let "/app/%2e%2e/..." climb out of the workspace.
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (decoded.split("/").some((part) => part === ".." || part === ".")) return null;
  if (UNSAFE_CHARACTERS.test(decoded) || decoded.includes("//")) return null;
  return query ? `${path}?${query}` : path;
}

export function safeReturnPath(raw: unknown): string | null {
  return checkedPath(raw, WORKSPACE_PATH);
}

/**
 * Any page that needs a signed-in person: the workspace, the admin dashboard
 * and billing. Used where a renewed sign-in sends someone back to the page they
 * were opening; same rules as safeReturnPath otherwise.
 */
export function safeSignedInPath(raw: unknown): string | null {
  return checkedPath(raw, SIGNED_IN_PATH);
}

/** True for a page path that only a signed-in person can open. */
export function isSignedInPage(pathname: string): boolean {
  return SIGNED_IN_PATH.test(pathname);
}

/** Renew a little before the access token runs out, so a page never renders with it expiring mid-request. */
const ACCESS_RENEW_MARGIN_MS = 5_000;

/**
 * Where the proxy sends a request for a signed-in page, or null to let it
 * through. Without a usable access token (none, or expired) the page goes
 * through /api/auth/refresh, which renews the sign-in with the refresh token
 * and comes straight back, or sends a signed-out visitor to log in carrying the
 * page they asked for. The expiry is read WITHOUT checking the signature: this
 * only decides where to route. The page itself always verifies the token and
 * the session row.
 */
export function renewalRedirectPath(
  pathname: string,
  search: string,
  accessToken: string | undefined,
  nowMs = Date.now(),
): string | null {
  if (!isSignedInPage(pathname)) return null;
  const exp = unverifiedExpiry(accessToken);
  if (exp !== null && exp * 1000 > nowMs + ACCESS_RENEW_MARGIN_MS) return null;
  const next = safeSignedInPath(`${pathname}${search}`) ?? safeSignedInPath(pathname);
  return next
    ? `/api/auth/refresh?next=${encodeURIComponent(next)}`
    : "/api/auth/refresh";
}
