/**
 * Customer sign-in tokens.
 *
 * - Access token: a short-lived HS256 JWT in the `tc_session` cookie
 *   (HttpOnly, SameSite=Lax, Secure in production). It names the session row
 *   (`sid`), the user (`sub`), the business (`oid`) and the plan. Every request
 *   that uses it ALSO checks the session row, so sign-out and "sign out
 *   everywhere" take effect immediately, not when the token expires.
 * - Refresh token: an opaque random value in the `tc_refresh` cookie, scoped to
 *   `/api/auth` so ordinary pages and API calls never carry it. Only its
 *   SHA-256 is stored; it is rotated on every use (see refresh-token.ts).
 *
 * Neither token is ever put in a URL, in localStorage or in a response body.
 * Framework-free (Web Crypto) so the proxy, Node and Workers can all use it.
 */

import type { PlanId } from "../entitlements";
import { isPlanId } from "../entitlements";
import type { SessionClaims } from "../types";
import { signJwt, verifyJwt } from "./jwt";

export const SESSION_COOKIE = "tc_session";
export const REFRESH_COOKIE = "tc_refresh";
/** The refresh cookie is only ever sent to the sign-in endpoints. */
export const REFRESH_COOKIE_PATH = "/api/auth";

export const ACCESS_TOKEN_ISSUER = "tradecatch";
export const ACCESS_TOKEN_AUDIENCE = "tradecatch-app";
/** Access tokens are short-lived; the refresh token renews them. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** Absolute life of a sign-in (the session row and its refresh tokens). */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

const PURPOSE = "access-jwt";
/** Allowed clock difference between the machine that signed and the one checking. */
const CLOCK_SKEW_SECONDS = 60;

export type AccessTokenClaims = {
  iss: typeof ACCESS_TOKEN_ISSUER;
  aud: typeof ACCESS_TOKEN_AUDIENCE;
  sub: string;
  sid: string;
  oid: string;
  plan: PlanId;
  iat: number;
  exp: number;
  jti: string;
};

/**
 * Signs an access token for an existing session row. `claims.exp` is the
 * expiry chosen by the caller (normally now + ACCESS_TOKEN_TTL_SECONDS).
 */
export async function signSessionClaims(
  claims: SessionClaims,
  secret: string,
  nowMs = Date.now(),
): Promise<string> {
  const token: AccessTokenClaims = {
    iss: ACCESS_TOKEN_ISSUER,
    aud: ACCESS_TOKEN_AUDIENCE,
    sub: claims.uid,
    sid: claims.sid,
    oid: claims.oid,
    plan: claims.plan,
    iat: Math.floor(nowMs / 1000),
    exp: claims.exp,
    jti: crypto.randomUUID(),
  };
  return signJwt(token, secret, PURPOSE);
}

/**
 * Checks signature, algorithm, issuer, audience, issue time and expiry.
 * Returns null for anything else; never throws.
 */
export async function verifySessionClaims(
  token: string,
  secret: string,
  nowMs = Date.now(),
): Promise<SessionClaims | null> {
  const payload = await verifyJwt(token, secret, PURPOSE);
  if (!payload) return null;
  const json = payload as Partial<AccessTokenClaims>;
  if (
    json.iss !== ACCESS_TOKEN_ISSUER ||
    json.aud !== ACCESS_TOKEN_AUDIENCE ||
    typeof json.sub !== "string" ||
    !json.sub ||
    typeof json.sid !== "string" ||
    !json.sid ||
    typeof json.oid !== "string" ||
    !json.oid ||
    typeof json.plan !== "string" ||
    !isPlanId(json.plan) ||
    typeof json.jti !== "string" ||
    typeof json.iat !== "number" ||
    typeof json.exp !== "number" ||
    !Number.isFinite(json.iat) ||
    !Number.isFinite(json.exp)
  ) {
    return null;
  }
  const nowSeconds = nowMs / 1000;
  if (json.iat > nowSeconds + CLOCK_SKEW_SECONDS) return null;
  if (json.exp <= nowSeconds) return null;
  // Never longer than a whole sign-in, whatever the signer asked for.
  if (json.exp - json.iat > SESSION_TTL_SECONDS + CLOCK_SKEW_SECONDS) return null;
  return {
    sid: json.sid,
    uid: json.sub,
    oid: json.oid,
    plan: json.plan as PlanId,
    exp: json.exp,
  };
}

function secureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Cookie attributes for the access token. */
export function sessionCookieOptions(maxAge: number) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

/**
 * Cookie attributes for the refresh token. Lax (not Strict) so that following
 * a link from an email into the dashboard can still renew the sign-in; it is
 * path-scoped to the sign-in endpoints, and every state-changing request that
 * carries it is also checked by the cross-site guard in src/lib/csrf.ts.
 */
export function refreshCookieOptions(maxAge: number) {
  return {
    name: REFRESH_COOKIE,
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax" as const,
    path: REFRESH_COOKIE_PATH,
    maxAge,
  };
}
