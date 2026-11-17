/**
 * Phone numbers: one place that reads, stores and shows them.
 *
 * Stored as E.164 (`+15145551234`). Shown the way people read them: a North
 * American number as `(514) 555-1234`, any other country in its international
 * grouping (`+33 1 42 68 53 00`), an extension after the number (`ext. 22`).
 *
 * Parsing uses libphonenumber (the `min` metadata: enough to split and group
 * numbers, ~80 KB smaller than the full build, which matters on a Worker).
 * `isPossible()` is the gate, not `isValid()`: a number that is the right
 * length for its country is kept, so a carrier's newly issued range or a
 * business's test line is never refused just because the metadata is older
 * than the carrier.
 *
 * Two rules every helper follows:
 *   - A number is never altered when it cannot be read. `formatPhone` returns
 *     what it was given; `parsePhone` returns null.
 *   - An extension is never merged into the digits. "514 555 1234 x22" is the
 *     number +15145551234 with extension 22, not +514555123422.
 */

import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";

/** Numbers with no country code are read as Canadian (the product's market). */
const DEFAULT_REGION: CountryCode = "CA";

/** Longest input considered: a real number with an extension is well under this. */
const MAX_INPUT_CHARS = 64;

/**
 * Caller IDs carriers and Twilio use for a withheld number
 * (anonymous, unknown, restricted, blocked).
 */
export const WITHHELD_CALLER_IDS: ReadonlySet<string> = new Set([
  "+266696687",
  "+86282452253",
  "+7378742833",
  "+2562533",
  "anonymous",
  "unknown",
  "restricted",
  "private",
  "blocked",
  "unavailable",
]);

/** A number written with digits, spaces and the usual punctuation, then an optional extension. */
const WRITTEN_NUMBER =
  /^\+?[\d\s().\-]+(?:[\s,;]*(?:ext\.?|extension|x|poste|p\.|#)\s*\d{1,6})?$/i;

const E164_SHAPE = /^\+[1-9]\d{7,14}$/;

export type ParsedPhone = {
  /** `+` and digits only. */
  e164: string;
  /** Digits after "ext", "x", "poste" or "#"; not part of `e164`. */
  extension?: string;
  country?: CountryCode;
};

/** True for a caller ID that carries no number ("anonymous", Twilio's placeholder digits, ...). */
export function isWithheldCaller(raw: string | null | undefined): boolean {
  const text = (raw ?? "").trim().toLowerCase();
  if (!text) return false;
  if (WITHHELD_CALLER_IDS.has(text)) return true;
  const digits = text.replace(/[^\d+]/g, "");
  return WITHHELD_CALLER_IDS.has(digits.startsWith("+") ? digits : `+${digits}`);
}

/**
 * The number in `raw`, or null when it is not a phone number. Accepts `+1`,
 * other country codes, spaces, dots, dashes, parentheses and an extension.
 * It never pulls a number out of a sentence.
 */
export function parsePhone(
  raw: string | null | undefined,
  region: CountryCode = DEFAULT_REGION,
): ParsedPhone | null {
  const text = (raw ?? "").trim();
  if (!text || text.length > MAX_INPUT_CHARS) return null;
  if (isWithheldCaller(text)) return null;
  if (!WRITTEN_NUMBER.test(text)) return null;

  // libphonenumber knows "ext." and "x"; French "poste" is the same thing.
  const parsed = parsePhoneNumberFromString(
    text.replace(/\bposte\b/gi, "ext"),
    region,
  );
  if (!parsed || !parsed.isPossible()) return null;
  // "Possible" includes a local-only length ("555-0123", seven digits, no area
  // code), which would be stored as the wrong number. Only a full number counts:
  // E.164 length, and ten digits after +1.
  if (!E164_SHAPE.test(parsed.number)) return null;
  if (parsed.number.startsWith("+1") && !/^\+1\d{10}$/.test(parsed.number)) return null;
  return {
    e164: parsed.number,
    ...(parsed.ext ? { extension: parsed.ext } : {}),
    ...(parsed.country ? { country: parsed.country } : {}),
  };
}

/** E.164 for `raw`, or null. The extension, if any, is dropped: use `parsePhone` to keep it. */
export function toE164(
  raw: string | null | undefined,
  region: CountryCode = DEFAULT_REGION,
): string | null {
  return parsePhone(raw, region)?.e164 ?? null;
}

/**
 * What to store for a number a provider sent: E.164 when it can be read, else
 * the text as received (trimmed and bounded). Nothing is invented, so a
 * withheld caller ID or an odd SIP address stays recognisable.
 */
export function normalizeProviderNumber(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  return toE164(text) ?? text.slice(0, MAX_INPUT_CHARS);
}

/**
 * The number as a person reads it. North American: `(514) 555-1234`. Other
 * countries: international grouping. Unreadable input comes back unchanged
 * (and "" for nothing), so a caller who withheld their number is not shown a
 * made-up one.
 */
export function formatPhone(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return "";
  const parsed = parsePhone(text);
  if (!parsed) return text;

  const nanp = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(parsed.e164);
  let shown: string;
  if (nanp) {
    shown = `(${nanp[1]}) ${nanp[2]}-${nanp[3]}`;
  } else {
    shown =
      parsePhoneNumberFromString(parsed.e164)?.formatInternational() ??
      parsed.e164;
  }
  return parsed.extension ? `${shown} ext. ${parsed.extension}` : shown;
}
