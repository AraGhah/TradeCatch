/**
 * The one HS256 JWT implementation used by every TradeCatch token (customer
 * access tokens and the administrator token). Web Crypto only, so it runs in
 * Node, in the proxy and on Cloudflare Workers.
 *
 * Deliberately strict:
 * - only `{"alg":"HS256","typ":"JWT"}` is accepted, so "none" or an RSA/HMAC
 *   confusion can never be smuggled in through the header;
 * - every segment must be the one canonical base64url spelling we would have
 *   issued (atob ignores unused trailing bits, which would otherwise give one
 *   token several valid strings);
 * - the signature is checked with `crypto.subtle.verify` (constant time)
 *   before the payload is parsed.
 *
 * Callers pass a `purpose` that is mixed into the HMAC key, so a token minted
 * for one purpose can never verify as another even with the same secret.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const HEADER = { alg: "HS256", typ: "JWT" } as const;
const MAX_TOKEN_LENGTH = 4096;

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < u8.length; i += 1) binary += String.fromCharCode(u8[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  try {
    const binary = atob(padded + pad);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    // Accept only the one spelling we would have issued.
    return b64url(out) === value ? out : null;
  } catch {
    return null;
  }
}

async function importKey(secret: string, purpose: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`${purpose}:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Signs `claims` as a compact HS256 JWT. */
export async function signJwt(
  claims: Record<string, unknown>,
  secret: string,
  purpose: string,
): Promise<string> {
  const header = b64url(encoder.encode(JSON.stringify(HEADER)));
  const payload = b64url(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  const key = await importKey(secret, purpose);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

/**
 * Returns the payload of a correctly signed HS256 JWT, or null. Never throws.
 * Claim checks (issuer, audience, expiry, ...) are the caller's job.
 */
export async function verifyJwt(
  token: string,
  secret: string,
  purpose: string,
): Promise<Record<string, unknown> | null> {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, sigPart] = parts;
  if (!headerPart || !payloadPart || !sigPart) return null;

  const headerBytes = b64urlToBytes(headerPart);
  const payloadBytes = b64urlToBytes(payloadPart);
  const sigBytes = b64urlToBytes(sigPart);
  if (!headerBytes || !payloadBytes || !sigBytes) return null;

  try {
    const header = JSON.parse(decoder.decode(headerBytes)) as Record<string, unknown>;
    if (
      header.alg !== HEADER.alg ||
      header.typ !== HEADER.typ ||
      Object.keys(header).length !== 2
    ) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const key = await importKey(secret, purpose);
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      Uint8Array.from(sigBytes),
      encoder.encode(`${headerPart}.${payloadPart}`),
    );
    if (!ok) return null;
    const payload = JSON.parse(decoder.decode(payloadBytes)) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Reads `exp` (seconds) from a token WITHOUT checking its signature. Only for
 * routing hints (for example the proxy deciding whether to refresh before a
 * page renders); never for an access decision.
 */
export function unverifiedExpiry(token: string | undefined): number | null {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  const bytes = b64urlToBytes(parts[1]);
  if (!bytes) return null;
  try {
    const payload = JSON.parse(decoder.decode(bytes)) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}
