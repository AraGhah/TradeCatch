/**
 * Customer-record hygiene (pure, no I/O).
 *
 * A caller's words arrive as speech-recognition fragments and one-word text
 * replies ("EN", "Ara", a street address, "Test"). Those belong in the raw
 * conversation, never in the one-line problem a business owner reads first.
 * These helpers keep that line clean without inventing anything: they only
 * remove greetings, filler, duplicates and obvious transcription artifacts,
 * and never translate or reword what the customer said.
 */

import type { LeadSource } from "./types";

/** Words that carry no request on their own. */
const FILLER = new Set([
  "salut", "bonjour", "bonsoir", "allo", "allô", "hello", "hi", "hey",
  "test", "ok", "okay", "oui", "non", "yes", "no", "euh", "uh", "um", "umm",
  "hmm", "merci", "thanks", "thank", "you", "please", "svp", "stp", "en",
  "fr", "stop", "oh", "ah", "alors", "donc", "voila", "voilà",
]);

/**
 * Labels the product itself writes ("Demande de service · Ara (Message pris)").
 * Only a label on its own, or followed by a " · " / " | " separator, counts:
 * a customer's "Call me back about my sink" is a request, not a label.
 */
const LABEL =
  /^(?:demande de service|service request|demande de rendez-vous|appointment request|message pris|message taken|appel de la réceptionniste|rendez-vous|appointment|urgence|emergency|appel|call)\s*(?:$|[·|]\s)/i;

const GREETING_PREFIX = /^(?:(?:salut|bonjour|bonsoir|allo|allô|hello|hi|hey)\b[\s,!.\-\u2013]*)+/i;
const HESITATION = /\b(?:e+uh+|u+h+|u+m+|h+m+|ben|bah)\b[\s,]*/gi;

/** Speech-to-text drops apostrophes and accents on a few very common words. */
const FR_FIXES: [RegExp, string][] = [
  [/\bjai\b/gi, "j'ai"],
  [/\bcest\b/gi, "c'est"],
  [/\bjsuis\b/gi, "je suis"],
  [/\bprobleme\b/gi, "problème"],
  [/\bproblemes\b/gi, "problèmes"],
  [/\bdegat\b/gi, "dégât"],
  [/\bdegats\b/gi, "dégâts"],
];

/** Lower case with accents removed, so a search for "cote" finds "Côté". */
export function searchFold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Lower-case, accent-free, punctuation-free form used only to compare texts. */
export function comparisonKey(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsWords(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return ` ${haystack} `.includes(` ${needle} `);
}

function capitalize(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function cleanSegment(raw: string): string {
  let text = raw
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || LABEL.test(text)) return "";
  text = text.replace(GREETING_PREFIX, "").replace(HESITATION, " ");
  for (const [pattern, fix] of FR_FIXES) text = text.replace(pattern, fix);
  // "the the" -> "the"
  text = text.replace(/\b(\p{L}+)(\s+\1\b)+/giu, "$1");
  text = text.replace(/[\s,;:\-\u2013·]+$/g, "").replace(/\s+/g, " ").trim();
  // A clause said twice in a row, with or without a comma: "X, X" -> "X".
  for (let i = 0; i < 3; i += 1) {
    const collapsed = text.replace(/^(.{6,}?)(?:\s*[,;]\s*|\s+)\1$/i, "$1");
    if (collapsed === text) break;
    text = collapsed;
  }
  const words = comparisonKey(text).split(" ").filter(Boolean);
  if (words.length === 0) return "";
  if (words.length <= 4 && words.every((w) => FILLER.has(w))) return "";
  return text.replace(/[.!?\u2026]+$/, "").trim();
}

/**
 * The problem as a short, readable statement: greetings, filler, language
 * replies, product labels and repeated sentences removed; sentences capitalised
 * and punctuated. Returns "" when nothing real is left. The customer's own
 * words are kept as they are (no translation, no rewording).
 */
export function cleanProblemText(raw: string | undefined, maxLength = 600): string {
  if (!raw) return "";
  const segments = raw
    .split(/\n+/)
    // A product label line ("Demande de service · Ara (Message pris)") goes whole.
    .filter((line) => !LABEL.test(line.trim()))
    .flatMap((line) => line.split(/(?<=[.!?\u2026])\s+|;\s*/))
    .map(cleanSegment)
    .filter(Boolean);

  const kept: { text: string; key: string }[] = [];
  for (const text of segments) {
    const key = comparisonKey(text);
    if (!key) continue;
    // Already said (or said more completely): do not repeat it.
    if (kept.some((k) => containsWords(k.key, key))) continue;
    // This one says more than an earlier fragment: it replaces that fragment.
    const index = kept.findIndex((k) => containsWords(key, k.key));
    if (index >= 0) {
      kept[index] = { text, key };
      // A later fragment may now be covered by the longer one.
      for (let i = kept.length - 1; i > index; i -= 1) {
        if (containsWords(key, kept[i]!.key)) kept.splice(i, 1);
      }
      continue;
    }
    kept.push({ text, key });
  }

  let out = "";
  for (const { text } of kept) {
    const sentence = `${capitalize(text)}.`;
    if ((out ? `${out} ${sentence}` : sentence).length > maxLength) {
      // One very long statement: keep its beginning rather than nothing at all.
      if (!out)
        out = `${sentence.slice(0, maxLength - 1).replace(/\s+\S*$/, "")}…`;
      break;
    }
    out = out ? `${out} ${sentence}` : sentence;
  }
  return out;
}

/** Same problem, ignoring case, accents, punctuation and filler. */
export function sameProblem(a: string | undefined, b: string | undefined): boolean {
  return comparisonKey(cleanProblemText(a)) === comparisonKey(cleanProblemText(b));
}

/**
 * How much a source's free text can be trusted as "the problem".
 * - ai_receptionist: a model-written statement from the whole call: replaces.
 * - website / manual: a person typed it: added when it says something new.
 * - sms / missed_call: one text from a back-and-forth (a name, an address, "EN"):
 *   only ever the first statement; the rest stays in the conversation thread.
 */
export function problemMergeMode(
  source: LeadSource,
): "replace" | "append" | "fill_only" {
  if (source === "ai_receptionist") return "replace";
  if (source === "website" || source === "manual") return "append";
  return "fill_only";
}

export function mergeProblem(
  existing: string | undefined,
  incoming: string | undefined,
  source: LeadSource,
  maxLength = 4000,
): string | undefined {
  const next = cleanProblemText(incoming, maxLength);
  const current = existing?.trim() ? existing : undefined;
  if (!next) return current;
  if (!current) return next;
  if (sameProblem(current, next)) return current;
  const mode = problemMergeMode(source);
  if (mode === "fill_only") return current;
  if (mode === "replace") return next;
  // append: only what is not already there
  const merged = cleanProblemText(`${current}\n${next}`, maxLength);
  return merged || current;
}

/** True when `incoming` completes `current` ("Ara" -> "Ara Ghahramanyan"). */
function extendsName(current: string, incoming: string): boolean {
  const a = comparisonKey(current);
  const b = comparisonKey(incoming);
  return b.length > a.length && b.startsWith(`${a} `);
}

/**
 * A name or address already on file is not replaced by an automated capture:
 * a later speech fragment is less reliable than what was verified. It is only
 * filled when missing, or when the new value completes the old one.
 */
export function keepVerified(
  current: string | undefined,
  incoming: string | undefined,
  source: LeadSource,
): string | undefined {
  const next = incoming?.trim() || undefined;
  if (!next) return undefined;
  if (source === "manual" || !current?.trim()) return next;
  return extendsName(current, next) ? next : undefined;
}

const INTENT_CODES = new Set([
  "service_request", "appointment", "faq", "transfer", "message", "emergency",
  "other", "missed_call", "sms", "website", "ai_receptionist",
]);

/** A call "intent" code is not a service ("service_request" is not plumbing). */
export function isIntentCode(value: string | undefined): boolean {
  return Boolean(value && INTENT_CODES.has(value.trim().toLowerCase()));
}

/** "+14389936997" -> "438-993-6997"; anything that is not a North American number is kept as is. */
export function formatPhoneDisplay(phone: string | undefined): string {
  const raw = (phone ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length === 10 && (digits.length === 10 || digits.startsWith("1"))) {
    return `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`;
  }
  return raw;
}
