/**
 * Unpadded base64url for signed tokens built on Node Buffers (unsubscribe
 * links, business-test state). The JWT code uses Web Crypto bytes instead:
 * see src/product/saas/auth/jwt.ts.
 */

export function encodeBase64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Lenient decode, exactly like Buffer's base64 parser: callers verify the signature first. */
export function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
