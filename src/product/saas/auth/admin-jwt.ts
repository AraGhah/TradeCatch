/**
 * Short-lived HS256 JWT for platform admin pages and /api/admin.
 * Signed with Web Crypto so it works in Node and on the edge.
 * A normal session cookie is not this token and cannot be swapped in.
 */

const encoder = new TextEncoder();

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

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < u8.length; i += 1) binary += String.fromCharCode(u8[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  try {
    const binary = atob(padded + pad);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`admin-jwt:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

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
  const header = b64url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

export async function verifyAdminJwt(
  token: string,
  secret: string,
  nowMs = Date.now(),
): Promise<AdminJwtClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, sigPart] = parts;
  if (!headerPart || !payloadPart || !sigPart) return null;

  const headerBytes = b64urlToBytes(headerPart);
  const sigBytes = b64urlToBytes(sigPart);
  if (!headerBytes || !sigBytes) return null;

  try {
    const header = JSON.parse(new TextDecoder().decode(headerBytes)) as { alg?: string; typ?: string };
    if (header.alg !== "HS256" || header.typ !== "JWT") return null;
  } catch {
    return null;
  }

  const key = await importKey(secret);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    Uint8Array.from(sigBytes),
    encoder.encode(`${headerPart}.${payloadPart}`),
  );
  if (!ok) return null;

  const payloadBytes = b64urlToBytes(payloadPart);
  if (!payloadBytes) return null;

  try {
    const json = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<AdminJwtClaims>;
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
