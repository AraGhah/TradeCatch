import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison for secrets and tokens.
 *
 * Both sides are hashed first so the comparison always runs over two 32-byte
 * values: unlike comparing the raw strings, neither the content nor the length
 * of the expected secret shows up in how long the check takes.
 */
export function safeEqual(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
