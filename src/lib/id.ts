/**
 * UUID v4 that works where `crypto.randomUUID` is missing (some Cloudflare
 * Workers / OpenNext SSR bundles and older browsers) but `getRandomValues` is
 * available — the same Web Crypto surface already used elsewhere in the app.
 */
export function randomUUID(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") {
    return c.randomUUID();
  }
  if (typeof c?.getRandomValues !== "function") {
    throw new Error("Secure random unavailable");
  }

  const bytes = c.getRandomValues(new Uint8Array(16));
  // RFC 4122 §4.4 — set version 4 and variant 1 bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Prefixed opaque id for durable rows and in-memory records. */
export function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
