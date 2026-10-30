/**
 * Checks on what a language model is about to say on the phone (pure, no I/O).
 *
 * The model proposes a reply; these decide whether it may be spoken. A reply
 * that fails is replaced by the rule brain's, so a hallucination never reaches
 * the caller:
 *
 * - an amount the owner never approved ("about $150 an hour");
 * - a claim to be a person ("I'm a real person");
 * - the same price/identity rules apply to the LiveKit agent's prompt, but there
 *   the model speaks directly, so the instructions carry them (agents/receptionist).
 */

import { normalizeSpeech } from "./nlu";

const MONEY: RegExp[] = [
  /\$\s?\d[\d\s.,]*/g,
  // "500 $" / "500$" (no word boundary after "$"), "500 dollars", "500 CAD".
  /\b\d[\d\s.,]*\s?(?:\$|(?:dollars?|piastres?|cad|bucks?)\b)/gi,
  /\b\d[\d.,]*\s?(?:\/|per |par |l['’]|the )\s?(?:h|hr|hour|heure|hre)\b/gi,
];

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Does the reply state an amount that is not in the owner's approved wording?
 * Numbers that appear in `approvedText` are fine; any other amount is not.
 */
export function claimsUnapprovedPrice(
  reply: string,
  approvedText: string | undefined,
): boolean {
  const approved = new Set<string>();
  for (const re of MONEY) {
    for (const m of (approvedText ?? "").matchAll(re)) {
      const d = digitsOnly(m[0]);
      if (d) approved.add(d);
    }
  }
  for (const re of MONEY) {
    for (const m of reply.matchAll(re)) {
      const d = digitsOnly(m[0]);
      if (d && !approved.has(d)) return true;
    }
  }
  return false;
}

const CLAIMS_HUMAN: RegExp[] = [
  /\bi (?:m|am) (?:a |an )?(?:real|actual|live) (?:person|human)\b/,
  /\bi (?:m|am) (?:a )?(?:person|human)\b/,
  /\bi (?:m|am) not (?:a |an )?(?:robot|ai|bot|machine|computer|virtual|automated)\b/,
  /\bje suis (?:une? )?(?:vraie? )?(?:personne|humain|humaine)\b/,
  /\bje ne suis pas (?:une? )?(?:robot|ia|machine|assistante? virtuelle?|ordinateur)\b/,
];

/** The reply says it is a person or denies being automated. */
export function claimsToBeHuman(reply: string): boolean {
  const n = normalizeSpeech(reply)
    .replace(/'/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return CLAIMS_HUMAN.some((re) => re.test(n));
}
