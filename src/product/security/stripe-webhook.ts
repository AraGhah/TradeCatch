import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SIGNATURES = 5;

/**
 * Stripe-Signature: `t=unix,v1=hex,v1=hex...` where each v1 is the hex HMAC-SHA256
 * of `${t}.${payload}`. While a signing secret is being rotated Stripe sends one
 * v1 per active secret, so the event is valid if any of them matches.
 */
export function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  now = Date.now(),
  toleranceSeconds = 300,
): boolean {
  let timestamp: string | undefined;
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && timestamp === undefined) timestamp = value;
    else if (key === "v1" && candidates.length < MAX_SIGNATURES) candidates.push(value);
  }
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || candidates.length === 0) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest();
  let matched = false;
  for (const candidate of candidates) {
    if (!/^[0-9a-f]{64}$/i.test(candidate)) continue;
    // No early exit: how long this takes must not depend on which one matched.
    if (timingSafeEqual(Buffer.from(candidate, "hex"), expected)) matched = true;
  }
  return matched;
}
