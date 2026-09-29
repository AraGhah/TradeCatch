/**
 * Deterministic language helpers for spoken input (FR-CA + EN).
 * Used by the rule brain and as guardrails around the LLM brain.
 */

import type { FaqEntry, ReceptionistLanguage, RoutingTarget } from "./types";

export function normalizeSpeech(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasPhrase(normalized: string, phrases: string[]): boolean {
  const padded = ` ${normalized} `;
  return phrases.some((p) => {
    const n = normalizeSpeech(p);
    return n.length > 0 && padded.includes(` ${n} `);
  });
}

const YES = [
  "oui",
  "ouais",
  "ouin",
  "exact",
  "exactement",
  "c'est ca",
  "correct",
  "parfait",
  "absolument",
  "yes",
  "yeah",
  "yep",
  "yup",
  "right",
  "that's right",
  "sure",
  "ok",
  "okay",
  "d'accord",
];
const NO = [
  "non",
  "pas vraiment",
  "c'est tout",
  "rien d'autre",
  "non merci",
  "no",
  "nope",
  "nah",
  "no thanks",
  "no thank you",
  "that's all",
  "that's it",
  "nothing else",
  "i'm good",
];

export function detectYesNo(text: string): "yes" | "no" | null {
  const n = normalizeSpeech(text);
  if (!n) return null;
  const no = hasPhrase(n, NO);
  const yes = hasPhrase(n, YES);
  if (no && !yes) return "no";
  if (yes && !no) return "yes";
  // "non, c'est correct" style answers: the first token wins.
  if (yes && no) {
    const first = n.split(" ")[0] ?? "";
    if (["non", "no", "nope", "nah"].includes(first)) return "no";
    return "yes";
  }
  return null;
}

const EN_MARKERS = [
  "english",
  "anglais",
  "the",
  "my",
  "is",
  "i",
  "i'm",
  "have",
  "need",
  "please",
  "can",
  "you",
  "what",
  "hi",
  "hello",
  "yes",
  "no",
  "water",
  "leak",
  "heat",
  "furnace",
  "call",
];
const FR_MARKERS = [
  "francais",
  "french",
  "le",
  "la",
  "les",
  "mon",
  "ma",
  "est",
  "je",
  "j'ai",
  "besoin",
  "bonjour",
  "oui",
  "non",
  "fuite",
  "chauffage",
  "eau",
  "une",
  "des",
  "pour",
  "avec",
  "rappeler",
  "c'est",
];

/** Explicit menu choice or a best-effort guess from function words. */
export function detectLanguage(
  text: string,
  digits?: string,
): ReceptionistLanguage | null {
  if (digits === "1") return "fr";
  if (digits === "2") return "en";
  const n = normalizeSpeech(text);
  if (!n) return null;
  if (/\b(english|anglais)\b/.test(n)) return "en";
  if (/\b(francais|french)\b/.test(n)) return "fr";
  const tokens = n.split(" ");
  let en = 0;
  let fr = 0;
  for (const t of tokens) {
    if (EN_MARKERS.includes(t)) en += 1;
    if (FR_MARKERS.includes(t)) fr += 1;
  }
  if (en === fr) return null;
  return en > fr ? "en" : "fr";
}

const HUMAN_REQUEST = [
  "parler a quelqu'un",
  "parler a une personne",
  "parler a un humain",
  "un humain",
  "une vraie personne",
  "un agent",
  "la reception",
  "parler au patron",
  "parler au proprietaire",
  "operateur",
  "operatrice",
  "speak to someone",
  "speak to a person",
  "talk to someone",
  "talk to a person",
  "real person",
  "a human",
  "an agent",
  "operator",
  "representative",
  "speak to the owner",
  "talk to the owner",
];

export function wantsHuman(text: string): boolean {
  return hasPhrase(normalizeSpeech(text), HUMAN_REQUEST);
}

const APPOINTMENT = [
  "rendez vous",
  "rendez-vous",
  "rdv",
  "soumission",
  "estimation",
  "devis",
  "prendre un rendez vous",
  "appointment",
  "book",
  "booking",
  "schedule",
  "quote",
  "estimate",
  "visit",
  "come by",
];

export function mentionsAppointment(text: string): boolean {
  return hasPhrase(normalizeSpeech(text), APPOINTMENT);
}

export function matchRoutingTarget(
  text: string,
  routing: RoutingTarget[],
): RoutingTarget | null {
  const n = normalizeSpeech(text);
  if (!n) return null;
  for (const target of routing) {
    if (hasPhrase(n, [target.name, ...target.keywords])) return target;
  }
  return null;
}

/**
 * Score FAQ entries by keyword hits; require at least one full-phrase hit.
 * Returns the best entry or null.
 */
export function matchFaq(text: string, faqs: FaqEntry[]): FaqEntry | null {
  const n = normalizeSpeech(text);
  if (!n) return null;
  let best: { entry: FaqEntry; score: number } | null = null;
  for (const entry of faqs) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (hasPhrase(n, [kw])) score += normalizeSpeech(kw).split(" ").length;
    }
    if (score > 0 && (!best || score > best.score)) best = { entry, score };
  }
  return best?.entry ?? null;
}

const NAME_PREFIXES = [
  /^(?:mon nom (?:c'est|est)|je m'appelle|je suis|moi c'est|c'est)\s+/i,
  /^(?:my name is|my name's|this is|i am|i'm|it's|it is|name is)\s+/i,
];

/** Pull a plausible name out of "je m'appelle Marie Tremblay" style answers. */
export function extractName(text: string): string | null {
  let t = text.trim().replace(/[.!?,]+$/g, "");
  for (const re of NAME_PREFIXES) t = t.replace(re, "");
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return null;
  const words = t.split(" ").slice(0, 4);
  if (words.length === 0) return null;
  const name = words
    .map((w) => (w.length > 1 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
  return name.length >= 2 && name.length <= 60 ? name : null;
}

const SPOKEN_DIGITS: Record<string, string> = {
  zero: "0",
  zéro: "0",
  oh: "0",
  one: "1",
  un: "1",
  une: "1",
  two: "2",
  deux: "2",
  three: "3",
  trois: "3",
  four: "4",
  quatre: "4",
  five: "5",
  cinq: "5",
  six: "6",
  seven: "7",
  sept: "7",
  eight: "8",
  huit: "8",
  nine: "9",
  neuf: "9",
};

/** Parse a North-American callback number from DTMF or speech. */
export function extractPhoneE164(text: string, digits?: string): string | null {
  const fromWords = text
    .toLowerCase()
    .split(/[\s,.-]+/)
    .map((w) => SPOKEN_DIGITS[w] ?? w)
    .join(" ");
  const raw = (digits && digits.length >= 10 ? digits : fromWords).replace(
    /\D/g,
    "",
  );
  if (raw.length === 10) return `+1${raw}`;
  if (raw.length === 11 && raw.startsWith("1")) return `+${raw}`;
  return null;
}

/** "+15145551234" → "5 1 4, 5 5 5, 1 2 3 4" so TTS reads it digit by digit. */
export function speakablePhone(e164: string): string {
  const d = e164.replace(/\D/g, "");
  const national = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (national.length !== 10) return national.split("").join(" ");
  const g = (s: string) => s.split("").join(" ");
  return `${g(national.slice(0, 3))}, ${g(national.slice(3, 6))}, ${g(national.slice(6))}`;
}
