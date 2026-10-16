import { createHmac, timingSafeEqual } from "node:crypto";

/** Stripe-Signature: t=unix,v1=hex hmac of `${t}.${payload}`. */
export function verifyStripeSignature(payload: string, header: string, secret: string, now = Date.now()): boolean {
  const parts = new Map(header.split(",").map((part) => {
    const [key, value] = part.split("=");
    return [key, value] as const;
  }));
  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (!timestamp || !signature) return false;
  const age = Math.abs(now / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
