/**
 * Referral codes. Dependency-free on purpose: the book-audit form imports the
 * pattern, and it must not pull the plan catalog into the browser bundle.
 */

/** No 0/O/1/I/L: a code read aloud or typed from a screenshot survives. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const REFERRAL_CODE_LENGTH = 10;
const CODE_SHAPE = /^[2-9A-HJKMNP-Z]{10}$/;

/** Unguessable by design: random, not derived from an organization id. */
export function generateReferralCode(
  randomBytes: (n: number) => Uint8Array,
): string {
  // Rejection sampling keeps every letter equally likely.
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let out = "";
  while (out.length < REFERRAL_CODE_LENGTH) {
    for (const byte of randomBytes(REFERRAL_CODE_LENGTH * 2)) {
      if (byte >= limit) continue;
      out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (out.length === REFERRAL_CODE_LENGTH) break;
    }
  }
  return out;
}

/** Visitor-typed or link-supplied code → canonical form, or null if it cannot be one. */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/[\s-]/g, "").toUpperCase();
  return CODE_SHAPE.test(code) ? code : null;
}

/** Shape a client may send to the book-audit API. */
export const REFERRAL_CODE_PATTERN = /^[2-9A-HJKMNP-Za-hjkmnp-z]{10}$/;

