/**
 * Which Bland numbers TradeCatch answers, and who may speak for each one.
 *
 * Bland's custom tools call our endpoints from Bland's servers, so the only
 * proof of who is calling is a secret in the tool's headers. That secret is
 * per line, never the general ops secret: a leaked line token can reach that
 * one business's receptionist and nothing else, and the registry stores only
 * its SHA-256, so reading the configuration does not reveal a usable token.
 *
 * The registry is trusted configuration (`BLAND_LINES_JSON`, set by us, never
 * by an owner or a caller):
 *
 *   [{ "number": "+14385550100",              // the Bland number that was dialed
 *      "receptionistNumber": "+14385550100",  // the business's receptionist number (default: number)
 *      "tokenSha256": "<64 hex>",             // sha256 of the line's tool token
 *      "smsNumber": "+14385550199" }]         // optional: a number Bland's SMS agent answers
 *
 * A line that is malformed, listed twice, or missing is simply not served.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const E164 = /^\+[1-9]\d{9,14}$/;

const lineSchema = z.object({
  number: z.string().trim().regex(E164),
  receptionistNumber: z.string().trim().regex(E164).optional(),
  tokenSha256: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f]{64}$/),
  smsNumber: z.string().trim().regex(E164).optional(),
});

export type BlandLine = {
  number: string;
  receptionistNumber: string;
  tokenSha256: string;
  smsNumber?: string;
};

// Same normalisation as the other voice endpoints: +1 514 ... and 514 ... are one number.
const digits = (value: string) =>
  value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

let cache: { raw: string; lines: BlandLine[] } | undefined;

/** The valid lines. Bad entries are skipped and counted, never logged with their values. */
export function loadBlandLines(
  env: NodeJS.ProcessEnv = process.env,
): BlandLine[] {
  const raw = env.BLAND_LINES_JSON?.trim() ?? "";
  if (cache && cache.raw === raw) return cache.lines;
  const lines = parseLines(raw);
  cache = { raw, lines };
  return lines;
}

function parseLines(raw: string): BlandLine[] {
  if (!raw) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    console.error(
      JSON.stringify({ event: "tradecatch.bland.lines_invalid", reason: "json" }),
    );
    return [];
  }
  if (!Array.isArray(json)) return [];
  const parsed: BlandLine[] = [];
  let skipped = 0;
  for (const item of json) {
    const entry = lineSchema.safeParse(item);
    if (!entry.success) {
      skipped += 1;
      continue;
    }
    parsed.push({
      number: entry.data.number,
      receptionistNumber: entry.data.receptionistNumber ?? entry.data.number,
      tokenSha256: entry.data.tokenSha256,
      ...(entry.data.smsNumber ? { smsNumber: entry.data.smsNumber } : {}),
    });
  }
  // A number listed twice is ambiguous (two tokens, maybe two businesses):
  // neither entry is served.
  const seen = new Map<string, number>();
  for (const line of parsed) {
    seen.set(digits(line.number), (seen.get(digits(line.number)) ?? 0) + 1);
  }
  const lines = parsed.filter((line) => seen.get(digits(line.number)) === 1);
  const duplicates = parsed.length - lines.length;
  if (skipped > 0 || duplicates > 0) {
    console.error(
      JSON.stringify({
        event: "tradecatch.bland.lines_invalid",
        skipped,
        duplicates,
      }),
    );
  }
  return lines;
}

export function resetBlandLinesCacheForTests() {
  cache = undefined;
}

export function findBlandLine(
  lines: BlandLine[],
  number: string | undefined,
): BlandLine | undefined {
  if (!number) return undefined;
  const wanted = digits(number);
  if (wanted.length < 10) return undefined;
  return lines.find((line) => digits(line.number) === wanted);
}

export function hashBlandToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Generates a token to paste into Bland, and the hash to put in the registry. */
export function newBlandLineToken(): { token: string; tokenSha256: string } {
  const token = `tcbl_${randomBytes(32).toString("hex")}`;
  return { token, tokenSha256: hashBlandToken(token) };
}

const UNKNOWN_LINE_DIGEST = Buffer.alloc(32, 7);

/**
 * True only when `token` is the line's token. The comparison runs against a
 * fixed digest when the line is unknown, so the time taken does not say
 * whether a number is one of ours.
 */
export function verifyBlandToken(
  line: BlandLine | undefined,
  token: string | undefined,
): boolean {
  const presented = createHash("sha256")
    .update(token ?? "", "utf8")
    .digest();
  const expected = line
    ? Buffer.from(line.tokenSha256, "hex")
    : UNKNOWN_LINE_DIGEST;
  const equal = timingSafeEqual(presented, expected);
  return Boolean(line && token) && equal;
}

/** `Authorization: Bearer <token>` → the token. */
export function bearerToken(header: string | null): string | undefined {
  if (!header || !header.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token && token.length <= 200 ? token : undefined;
}

/**
 * Numbers whose texts Bland's SMS agent answers. Twilio's responder must never
 * answer on one of these, and TradeCatch must never send from one, or a
 * customer's reply would be answered twice or by the wrong system.
 */
export function blandOwnedSmsNumbers(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  return new Set(
    loadBlandLines(env)
      .map((line) => line.smsNumber)
      .filter((n): n is string => Boolean(n))
      .map(digits),
  );
}

export function isBlandOwnedSmsNumber(
  number: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!number) return false;
  return blandOwnedSmsNumbers(env).has(digits(number));
}
