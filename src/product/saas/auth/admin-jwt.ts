/**
 * Short-lived HS256 JWT for platform admin pages and /api/admin.
 * Signed with Web Crypto so it works in Node and on the edge.
 * A normal session cookie is not this token and cannot be swapped in.
 */

import { signJwt, verifyJwt } from "./jwt";

/** Mixed into the HMAC key; unchanged so tokens issued before this refactor stay valid. */
const PURPOSE = "admin-jwt";

export const ADMIN_JWT_COOKIE = "tc_admin";
export const ADMIN_JWT_TTL_SECONDS = 60 * 60 * 2;
export const ADMIN_JWT_ISSUER = "tradecatch";
export const ADMIN_JWT_AUDIENCE = "tradecatch-admin";

export type AdminJwtClaims = {
  iss: typeof ADMIN_JWT_ISSUER;
  aud: typeof ADMIN_JWT_AUDIENCE;
  sub: string;
  sid: string;
  role: "platform_admin";
  iat: number;
  exp: number;
  jti: string;
};

export async function signAdminJwt(
  input: { sub: string; sid: string },
  secret: string,
  nowMs = Date.now(),
): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const claims: AdminJwtClaims = {
    iss: ADMIN_JWT_ISSUER,
    aud: ADMIN_JWT_AUDIENCE,
    sub: input.sub,
    sid: input.sid,
    role: "platform_admin",
    iat,
    exp: iat + ADMIN_JWT_TTL_SECONDS,
    jti: crypto.randomUUID(),
  };
  return signJwt(claims, secret, PURPOSE);
}

export async function verifyAdminJwt(
  token: string,
  secret: string,
  nowMs = Date.now(),
): Promise<AdminJwtClaims | null> {
  const payload = await verifyJwt(token, secret, PURPOSE);
  if (!payload) return null;
  try {
    const json = payload as Partial<AdminJwtClaims>;
    if (
      json.iss !== ADMIN_JWT_ISSUER ||
      json.aud !== ADMIN_JWT_AUDIENCE ||
      json.role !== "platform_admin" ||
      typeof json.sub !== "string" ||
      json.sub.length < 1 ||
      typeof json.sid !== "string" ||
      json.sid.length < 1 ||
      typeof json.jti !== "string" ||
      typeof json.iat !== "number" ||
      typeof json.exp !== "number"
    ) {
      return null;
    }
    if (json.exp - json.iat > ADMIN_JWT_TTL_SECONDS + 120) return null;
    if (json.iat * 1000 > nowMs + 60_000) return null;
    if (json.exp * 1000 <= nowMs) return null;
    return {
      iss: ADMIN_JWT_ISSUER,
      aud: ADMIN_JWT_AUDIENCE,
      sub: json.sub,
      sid: json.sid,
      role: "platform_admin",
      iat: json.iat,
      exp: json.exp,
      jti: json.jti,
    };
  } catch {
    return null;
  }
}

export function adminJwtCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  };
}
