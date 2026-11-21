/**
 * Signed unsubscribe tokens (CASL requires a working unsubscribe mechanism in
 * every commercial electronic message). Token = base64url(orgId\nemail).hmac
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { decodeBase64Url, encodeBase64Url } from "@/lib/base64url";

function sign(payload: string, secret: string): string {
  return encodeBase64Url(
    createHmac("sha256", secret).update(`unsubscribe:${payload}`).digest(),
  );
}

export function createUnsubscribeToken(
  input: { organizationId: string; email: string },
  secret: string,
): string {
  const payload = encodeBase64Url(
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
  const [organizationId, email] = decodeBase64Url(payload)
    .toString("utf8")
    .split("\n");
  if (!organizationId || !email) return null;
  return { organizationId, email };
}
