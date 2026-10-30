/**
 * Deterministic language helpers for spoken input (FR-CA + EN).
 * Used by the rule brain and as guardrails around the LLM brain.
 */

import type { FaqEntry, RoutingTarget } from "./types";

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

/* Language choice lives in language-select.ts: it is keypad-first by design,
   and guessing a language from function words let background noise or a
   half-heard sentence flip the call. */

/** Spaces instead of apostrophes, so patterns can say "don t", "l anglais". */
function plain(text: string): string {
  return normalizeSpeech(text).replace(/'/g, " ").replace(/\s+/g, " ").trim();
}

const AI_KINDS =
  "(?:robot|bot|chatbot|ai|a i|artificial intelligence|machine|computer|recording|automated|virtual|human|real person|person|live person|actual person)";
const AI_KINDS_FR =
  "(?:robot|ia|intelligence artificielle|machine|ordinateur|enregistrement|automatise\\w*|virtuel\\w*|humain|humaine|personne|vraie personne|vrai humain|vraie humaine)";

const ASKS_IF_AI: RegExp[] = [
  new RegExp(`\\b(?:are you|you are|you re) (?:an? )?(?:really |actually )?(?:real |actual |live )?${AI_KINDS}\\b`),
  new RegExp(`\\bis (?:this|that|it) (?:an? )?(?:really |actually )?(?:real |actual |live )?${AI_KINDS}\\b`),
  new RegExp(`\\bam i (?:talking|speaking|chatting) (?:to|with) (?:an? )?(?:real |actual |live )?${AI_KINDS}\\b`),
  new RegExp(`\\b(?:etes vous|vous etes|es tu|t es) (?:vraiment )?(?:un |une |une vraie |un vrai )?${AI_KINDS_FR}\\b`),
  new RegExp(`\\b(?:est ce que )?(?:c est|ce n est|je parle a|je parle avec) (?:un |une )?(?:vraie? )?${AI_KINDS_FR}\\b`),
];

/**
 * "Are you a robot?" / "Est-ce que je parle à une vraie personne?" — a question
 * about who is on the line, not a request to be connected (that is wantsHuman).
 */
export function asksIfAi(text: string): boolean {
  const n = plain(text);
  return n.length > 0 && ASKS_IF_AI.some((re) => re.test(n));
}

const ASKS_PRICE: RegExp[] = [
  /\bhow much\b/,
  /\bwhat (?:do|would|will) (?:you|it|that|this) (?:charge|cost)\b/,
  /\bwhat s (?:the|your) (?:price|cost|rate|rates|fee|fees|charge)\b/,
  /\b(?:price|prices|pricing|cost|costs|rate|rates|fee|fees|ballpark)\b/,
  /\bhourly (?:rate|fee)\b/,
  /\bcombien (?:ca|cela|il|elle|vous|ca va|ca peut|je dois|on doit|pour|environ|a peu pres)\b/,
  /\bc est combien\b/,
  /\bcombien (?:ca |cela )?(?:coute|coutent|couterait|va couter|charg\w+|prenez|demandez|factur\w+)\b/,
  /\b(?:prix|tarif|tarifs|taux horaire|cout|couts|frais)\b/,
];

/**
 * A price question, at any point in the call. "Estimate" or "quote" alone is a
 * request for a visit (appointment), not a price question.
 */
export function asksPrice(text: string): boolean {
  const n = plain(text);
  return n.length > 0 && ASKS_PRICE.some((re) => re.test(n));
}

// Questions that have nothing to do with the business. Deliberately specific:
// a real customer's unusual request must never be turned away as "off topic".
const OFF_TOPIC: RegExp[] = [
  /\b(?:weather|meteo|forecast)\b/,
  /\bcapital of\b|\bcapitale d[eu]\b/,
  /\bdo you (?:like|love|watch|play|support)\b/,
  /\b(?:aimez vous|est ce que vous aimez|tu aimes)\b/,
  /\btell me (?:a )?(?:joke|story)\b/,
  /\braconte(?:z)? moi (?:une |un )?(?:blague|histoire)\b/,
  /\bwho (?:won|is winning)\b|\bqui a gagne\b/,
  /\bwhat time is it\b|\bquelle heure est il\b/,
  /\bwho (?:is|are) the (?:president|prime minister)\b|\bqui est le (?:president|premier ministre)\b/,
  /\bmeaning of life\b|\bsens de la vie\b/,
];

/** Chit-chat or trivia with no link to a service, a price, an appointment or the team. */
export function matchesOffTopic(text: string): boolean {
  const n = plain(text);
  return n.length > 0 && OFF_TOPIC.some((re) => re.test(n));
}

const SMALL_TALK: RegExp[] = [
  /^(?:bonjour |hello |hi |salut )?(?:and )?how are you(?: doing| today)?$/,
  /^(?:bonjour |hello |hi |salut )?how s it going$/,
  /^(?:bonjour |salut )?(?:et )?comment (?:allez|vas|va) (?:vous|tu)(?: aujourd hui)?$/,
  /^(?:bonjour |salut )?(?:et )?ca va$/,
];

/** "How are you?" — answered in a few words, then back to the call. */
export function isSmallTalk(text: string): boolean {
  const n = plain(text);
  return n.length > 0 && SMALL_TALK.some((re) => re.test(n));
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

/**
 * A job for a contractor, as opposed to a personal note ("I'm sick").
 * Unknown trade wording still counts when the caller describes a problem.
 */
const SERVICE_REQUEST = [
  "fuite",
  "coule",
  "evier",
  "toilette",
  "drain",
  "chauffe",
  "gaz",
  "eau",
  "plomb",
  "electric",
  "panne",
  "bris",
  "repar",
  "install",
  "chauffage",
  "clim",
  "toiture",
  "robinet",
  "tuyau",
  "egout",
  "odeur",
  "bruit",
  "probleme",
  "urgence",
  "feu",
  "inond",
  "refoul",
  "pompe",
  "chaudiere",
  "disjoncteur",
  "leak",
  "sink",
  "toilet",
  "water",
  "gas",
  "broken",
  "repair",
  "heat",
  "furnace",
  "clog",
  "flood",
  "smell",
  "noise",
  "problem",
  "emergency",
  "fire",
  "pipe",
  "sewer",
  "faucet",
  "boiler",
  "pump",
  "outlet",
  "power",
  "not working",
  "fonctionne pas",
  "marche pas",
  "besoin",
  "need ",
];

export function looksLikeServiceRequest(text: string): boolean {
  return hasPhrase(normalizeSpeech(text), SERVICE_REQUEST);
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

/**
 * Words that show an answer is a sentence, a yes/no or a filler rather than a
 * name. Surname particles (de, la, le, du, des, van, von, di) are deliberately
 * absent so "Jean de la Fontaine" survives.
 */
const NOT_NAME_WORDS = new Set([
  // English
  "i", "im", "ive", "id", "ill", "my", "me", "you", "your", "we", "he", "she", "it", "its",
  "is", "are", "was", "am", "be", "do", "does", "did", "dont", "don", "know", "what", "how",
  "why", "when", "where", "who", "which", "can", "could", "would", "should", "the", "a", "an",
  "this", "that", "these", "those", "like", "love", "want", "need", "have", "has", "not", "no",
  "yes", "yeah", "ok", "okay", "hello", "hi", "hey", "thanks", "thank", "please", "sorry",
  "about", "for", "with", "from", "and", "but", "or", "if", "so", "because", "there", "here",
  "call", "calling", "speak", "talk", "urgent", "important", "nothing", "nobody", "never",
  "maybe", "sure", "fine", "good", "uh", "um", "hmm",
  // French
  "je", "j", "jai", "moi", "mon", "ma", "mes", "tu", "vous", "votre", "nous", "notre", "il",
  "elle", "on", "est", "sont", "suis", "fait", "faire", "ne", "pas", "sais", "savoir", "quoi",
  "comment", "pourquoi", "quand", "ou", "qui", "quel", "quelle", "un", "une", "ce", "cette",
  "ces", "ca", "cela", "aime", "veux", "voudrais", "besoin", "avoir", "oui", "non", "bonjour",
  "bonsoir", "salut", "allo", "merci", "desole", "desolee", "svp", "pour", "avec", "dans",
  "sur", "mais", "et", "que", "si", "parce", "rien", "jamais", "peut", "etre", "parfait",
  "bien", "correct", "euh", "hum",
]);

/**
 * Pull a plausible name out of "je m'appelle Marie Tremblay" style answers.
 * Stops at the first word that cannot be part of a name, and returns null for
 * "yes", "my sink is leaking" or "do you like hockey" so the caller is asked
 * again instead of being recorded under a sentence.
 */
export function extractName(text: string): string | null {
  let t = text.trim().replace(/[.!?,]+$/g, "");
  for (const re of NAME_PREFIXES) t = t.replace(re, "");
  t = t.replace(/\s+/g, " ").trim();
  if (!t || /\d/.test(t)) return null;
  const words: string[] = [];
  for (const word of t.split(" ")) {
    const key = normalizeSpeech(word).replace(/'/g, "");
    if (!key || NOT_NAME_WORDS.has(key)) break;
    words.push(word);
    if (words.length === 4) break;
  }
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
