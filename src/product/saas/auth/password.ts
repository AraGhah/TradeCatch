import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing for customer sign-in.
 *
 * scrypt (memory-hard) with a per-password random salt. The cost is chosen to
 * take a few tens of milliseconds, which fits a Worker request, and is stored in
 * the hash string so it can be raised later without invalidating old hashes.
 *
 * Format: scrypt$<N>$<r>$<p>$<salt base64url>$<hash base64url>
 */
const COST = { N: 16384, r: 8, p: 1 } as const;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
// A hash that claims a larger cost than we would ever issue is refused rather
// than letting a corrupted or hostile row exhaust memory.
const MAX_N = 1 << 17;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

function derive(
  password: string,
  salt: Buffer,
  N: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_BYTES,
      { N, r, p, maxmem: 256 * N * r },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST.N, COST.r, COST.p);
  return [
    "scrypt",
    COST.N,
    COST.r,
    COST.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    N < 2 ||
    N > MAX_N ||
    (N & (N - 1)) !== 0 ||
    r < 1 ||
    r > 16 ||
    p < 1 ||
    p > 4
  ) {
    return false;
  }
  const salt = Buffer.from(parts[4]!, "base64url");
  const expected = Buffer.from(parts[5]!, "base64url");
  if (salt.length < 8 || expected.length < 16) return false;
  try {
    const actual = await derive(password, salt, N, r, p);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * Spends the same time as a real check. Used when the email is unknown, or the
 * account has no password, so response time does not reveal which emails exist.
 */
export async function spendPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("not-a-real-password-for-timing-only");
  await verifyPassword(password, await dummyHash);
}

export type PasswordProblem =
  | "too_short"
  | "too_long"
  | "common"
  | "contains_email";

// The passwords people choose first. Not a full breach list: a floor, so the
// most guessed values are refused even though they meet the length rule.
const COMMON = new Set(
  [
    "password12",
    "password123",
    "password1234",
    "passw0rd123",
    "1234567890",
    "12345678910",
    "123456789012",
    "qwertyuiop",
    "qwerty12345",
    "qwerty123456",
    "iloveyou123",
    "welcome123",
    "welcome1234",
    "letmein1234",
    "admin12345",
    "administrator",
    "abcdefghij",
    "abc1234567",
    "tradecatch",
    "tradecatch1",
    "tradecatch123",
    "motdepasse",
    "motdepasse1",
    "motdepasse123",
    "bonjour1234",
    "montreal123",
    "plombier123",
  ].map((value) => value.toLowerCase()),
);

/** Returns what is wrong with a proposed password, or null when it is acceptable. */
export function checkPasswordStrength(
  password: string,
  email?: string,
): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) return "too_short";
  if (password.length > PASSWORD_MAX_LENGTH) return "too_long";
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return "common";
  if (email) {
    const address = email.trim().toLowerCase();
    const local = address.split("@")[0] ?? "";
    if (lower === address || (local.length >= 4 && lower.includes(local))) {
      return "contains_email";
    }
  }
  return null;
}
