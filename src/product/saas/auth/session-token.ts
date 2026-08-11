/**
 * HMAC-signed session cookies (Web Crypto) — works in Node and Edge middleware.
 */

import type { PlanId } from "../entitlements";
import { isPlanId } from "../entitlements";
import type { SessionClaims } from "../types";

const encoder = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < u8.length; i += 1) binary += String.fromCharCode(u8[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSessionClaims(
  claims: SessionClaims,
  secret: string,
): Promise<string> {
  const payload = b64url(encoder.encode(JSON.stringify(claims)));
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifySessionClaims(
  token: string,
  secret: string,
  nowMs = Date.now(),
): Promise<SessionClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  const key = await importKey(secret);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    Uint8Array.from(b64urlToBytes(sig)),
    encoder.encode(payload),
  );
  if (!ok) return null;

  try {
    const json = JSON.parse(
      new TextDecoder().decode(b64urlToBytes(payload)),
    ) as Partial<SessionClaims>;
    if (
      typeof json.sid !== "string" ||
      typeof json.uid !== "string" ||
      typeof json.oid !== "string" ||
      typeof json.plan !== "string" ||
      typeof json.exp !== "number" ||
      !isPlanId(json.plan)
    ) {
      return null;
    }
    if (json.exp * 1000 <= nowMs) return null;
    return {
      sid: json.sid,
      uid: json.uid,
      oid: json.oid,
      plan: json.plan as PlanId,
      exp: json.exp,
    };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = "tc_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days
