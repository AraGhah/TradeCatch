/**
 * Signed unsubscribe tokens (CASL requires a working unsubscribe mechanism in
 * every commercial electronic message). Token = base64url(orgId\nemail).hmac
 */

import { createHmac, timingSafeEqual } from "node:crypto";

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(payload: string, secret: string): string {
  return b64url(
    createHmac("sha256", secret).update(`unsubscribe:${payload}`).digest(),
  );
}

export function createUnsubscribeToken(
  input: { organizationId: string; email: string },
  secret: string,
): string {
  const payload = b64url(
    Buffer.from(
      `${input.organizationId}\n${input.email.trim().toLowerCase()}`,
      "utf8",
    ),
  );
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyUnsubscribeToken(
  token: string,
  secret: string,
): { organizationId: string; email: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [organizationId, email] = fromB64url(payload)
    .toString("utf8")
    .split("\n");
  if (!organizationId || !email) return null;
  return { organizationId, email };
}
