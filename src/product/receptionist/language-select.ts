/**
 * French-first language selection for incoming calls (pure, no I/O).
 *
 * Every call starts in Canadian French, whatever the caller's number or region:
 *
 *   "Bonjour! Merci d'avoir appelé X. Pour continuer en français, restez en
 *    ligne. For English, press 1."
 *
 * - Nothing pressed (or any key other than 1 / 2)  → French, after a short wait.
 * - 1 → English.   2 → French, explicitly.
 * - Speech is never used to pick the language at the menu: a cough, a TV in the
 *   background or a caller who simply starts explaining must not flip the call.
 * - Later in the call a caller can still ask out loud ("in English please");
 *   that is an explicit request, detected by `detectLanguageSwitch`.
 *
 * The same rules are mirrored by the LiveKit agent (agents/receptionist/language.py)
 * from the values `buildLanguageSelect` returns, so both voice paths agree.
 */

import { normalizeSpeech } from "./nlu";
import type { ReceptionistLanguage } from "./types";

/** How long the menu waits for a key after the greeting, in seconds. */
export const DEFAULT_LANGUAGE_SELECT_TIMEOUT_SECONDS = 3;
const MIN_TIMEOUT = 2;
const MAX_TIMEOUT = 10;

export function languageSelectTimeoutSeconds(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number(env.RECEPTIONIST_LANGUAGE_SELECT_TIMEOUT_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_LANGUAGE_SELECT_TIMEOUT_SECONDS;
  }
  return Math.min(MAX_TIMEOUT, Math.max(MIN_TIMEOUT, Math.round(raw)));
}

/**
 * The language a call starts in. French whenever it is enabled; an
 * English-only line starts in English.
 */
export function firstLanguage(
  languages: readonly ReceptionistLanguage[],
  fallback: ReceptionistLanguage = "fr",
): ReceptionistLanguage {
  if (languages.includes("fr")) return "fr";
  return languages[0] ?? fallback;
}

/** Menu key → language. Only a lone "1" or "2" counts; anything else is ignored. */
export function languageForDigits(
  digits: string | undefined,
): ReceptionistLanguage | null {
  const d = (digits ?? "").replace(/[^\d*#]/g, "");
  if (d === "1") return "en";
  if (d === "2") return "fr";
  return null;
}

/* ------------------------------------------------------------------------- */
/* Asking for another language out loud                                       */
/* ------------------------------------------------------------------------- */

const EN_WORD = "(?:english|anglais)";
const FR_WORD = "(?:french|francais)";

// Compounds that name a thing, not a language ("french drain", "French doors").
const FRENCH_NOUN_AFTER =
  /\b(?:french|francais) (?:drain|drains|door|doors|window|windows|style|cleat|cut|press|fries|toast|kiss|vanilla|bulldog|braid|manicure|curve)\b/;

// "I don't speak French", "je ne parle pas français" → wants English.
const NOT_FRENCH: RegExp[] = [
  /\b(?:do not|dont|don t|cannot|can t|no) (?:really )?(?:speak|understand) (?:much |any )?(?:french|francais)\b/,
  /\bje (?:ne )?(?:parle|comprends) (?:pas|presque pas|peu) (?:le )?(?:de )?francais\b/,
];
// "I don't speak English", "je ne parle pas anglais" → wants French.
const NOT_ENGLISH: RegExp[] = [
  /\b(?:do not|dont|don t|cannot|can t|no) (?:really )?(?:speak|understand) (?:much |any )?english\b/,
  /\bje (?:ne )?(?:parle|comprends) (?:pas|presque pas|peu) (?:l )?(?:de )?anglais\b/,
];

const WANTS_ENGLISH: RegExp[] = [
  /\bi (?:only |just )?speak english\b/,
  /\bje (?:parle|comprends) (?:seulement|juste|uniquement) (?:l )?anglais\b/,
  // "in English", "en anglais"
  new RegExp(`\\b(?:in|en|a|au) (?:l )?${EN_WORD}\\b`),
  // "speak / continue / switch to English", "parlez anglais"
  new RegExp(
    `\\b(?:speak|talk|continue|switch(?: over)? to|change to|go to|answer|respond|reply|parl\\w*|continu\\w*|passer|repond\\w*|prefer\\w*) (?:in |en |l |le |to )?${EN_WORD}\\b`,
  ),
  new RegExp(`\\b(?:do|can|could|would|will) you (?:please )?(?:speak|talk|continue)(?: in)? ${EN_WORD}\\b`),
  new RegExp(`\\b(?:parlez|parle|parles) (?:vous|tu) (?:l )?${EN_WORD}\\b`),
  new RegExp(`\\b(?:i prefer|je prefere) (?:to speak |parler )?(?:in |en |l |le )?${EN_WORD}\\b`),
];

const WANTS_FRENCH: RegExp[] = [
  /\bje (?:parle|comprends) (?:seulement|juste|uniquement) (?:le )?francais\b/,
  new RegExp(`\\b(?:in|en|a|au) (?:le )?${FR_WORD}\\b`),
  new RegExp(
    `\\b(?:speak|talk|continue|switch(?: over)? to|change to|go to|answer|respond|reply|parl\\w*|continu\\w*|passer|repond\\w*|prefer\\w*) (?:in |en |le |to )?${FR_WORD}\\b`,
  ),
  new RegExp(`\\b(?:do|can|could|would|will) you (?:please )?(?:speak|talk|continue)(?: in)? ${FR_WORD}\\b`),
  new RegExp(`\\b(?:parlez|parle|parles) (?:vous|tu) (?:le )?${FR_WORD}\\b`),
  new RegExp(`\\b(?:i prefer|je prefere) (?:to speak |parler )?(?:in |en |le )?${FR_WORD}\\b`),
];

// Just the name of a language, optionally with "please": "English", "français s'il vous plaît".
const BARE_ENGLISH = new RegExp(`^(?:${EN_WORD})(?: (?:please|s il vous plait|svp|thanks|merci))?$`);
const BARE_FRENCH = new RegExp(`^(?:${FR_WORD})(?: (?:please|s il vous plait|svp|thanks|merci))?$`);

/**
 * An explicit request to talk in another language, or null. Deliberately
 * conservative: it fires on "in English please" / "je préfère l'anglais" /
 * "I don't speak French", never on a sentence that merely contains a word like
 * "French drain", and never on noise.
 */
export function detectLanguageSwitch(text: string): ReceptionistLanguage | null {
  // normalizeSpeech keeps apostrophes; the patterns above expect plain spaces.
  const n = normalizeSpeech(text).replace(/'/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return null;
  if (BARE_ENGLISH.test(n)) return "en";
  if (BARE_FRENCH.test(n)) return "fr";
  if (FRENCH_NOUN_AFTER.test(n)) return null;
  // A negation ("I don't speak English") decides on its own: the positive
  // patterns would also match "speak English" inside it.
  const notFrench = NOT_FRENCH.some((re) => re.test(n));
  const notEnglish = NOT_ENGLISH.some((re) => re.test(n));
  if (notFrench !== notEnglish) return notFrench ? "en" : "fr";
  if (notFrench && notEnglish) return null;
  const en = WANTS_ENGLISH.some((re) => re.test(n));
  const fr = WANTS_FRENCH.some((re) => re.test(n));
  if (en === fr) return null; // neither, or contradictory
  return en ? "en" : "fr";
}

const GREETING_FILLER = new Set([
  "bonjour",
  "bonsoir",
  "salut",
  "allo",
  "hello",
  "hi",
  "hey",
  "oui",
  "yes",
  "ok",
  "okay",
  "d accord",
  "uh",
  "um",
  "euh",
  "hum",
  "mm",
  "merci",
  "thanks",
]);

/**
 * "Bonjour." / "Hello?" / "Allô oui" — a caller saying hello is not yet saying
 * what they want, so the opening question is still owed to them.
 */
export function isGreetingOnly(text: string): boolean {
  const n = normalizeSpeech(text).replace(/'/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return true;
  const words = n.split(" ");
  return words.length <= 3 && words.every((w) => GREETING_FILLER.has(w));
}

/* ------------------------------------------------------------------------- */
/* Greeting text                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Split an owner-written greeting into the part that welcomes the caller and a
 * trailing question ("How can I help you?"), so the question can be asked after
 * the language window instead of before the caller could pick a language.
 */
export function splitGreeting(greeting: string): {
  statement: string;
  question?: string;
} {
  const text = greeting.trim().replace(/\s+/g, " ");
  if (!text.endsWith("?")) return { statement: text };
  // The last sentence is the one that ends with "?"; a "?" earlier on is kept in the statement.
  const body = text.slice(0, -1);
  const cut = Math.max(
    body.lastIndexOf(". "),
    body.lastIndexOf("! "),
    body.lastIndexOf("? "),
  );
  if (cut < 0) return { statement: "", question: text };
  return {
    statement: text.slice(0, cut + 1).trim(),
    question: text.slice(cut + 2).trim(),
  };
}

/* ------------------------------------------------------------------------- */
/* Which language is being spoken                                             */
/* ------------------------------------------------------------------------- */

// Function words that belong to one language only ("a", "on", "me" are in both).
const ENGLISH_WORDS = new Set([
  "i", "im", "ive", "my", "the", "is", "are", "you", "your", "please", "hello", "hi", "hey",
  "want", "would", "like", "have", "has", "with", "for", "to", "of", "and", "can", "could",
  "need", "needs", "there", "this", "that", "what", "how", "some", "someone", "our", "we",
  "it", "its", "do", "does", "not", "at", "in", "from", "about",
]);
const FRENCH_WORDS = new Set([
  "je", "j", "jai", "le", "la", "les", "un", "une", "des", "du", "de", "et", "est", "pour",
  "avec", "mon", "ma", "mes", "besoin", "vous", "nous", "que", "qui", "pas", "dans", "sur",
  "au", "aux", "ce", "cette", "ces", "voudrais", "veux", "ai", "suis", "chez",
]);

/**
 * Does this sentence read as English? Used only to offer "For English, press 1"
 * to a caller who talked instead of pressing a key; it never switches language
 * by itself. Needs two English function words and more of them than French ones.
 */
export function looksEnglish(text: string): boolean {
  const words = normalizeSpeech(text).replace(/'/g, " ").split(" ").filter(Boolean);
  let english = 0;
  let french = 0;
  for (const word of words) {
    if (ENGLISH_WORDS.has(word)) english += 1;
    else if (FRENCH_WORDS.has(word)) french += 1;
  }
  return english >= 2 && english > french;
}
