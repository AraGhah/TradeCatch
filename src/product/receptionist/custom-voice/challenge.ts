/**
 * The spoken verification challenge.
 *
 * Before we clone a voice we need some assurance that the person recording is
 * the person agreeing to it, in the moment, and not replaying a clip taken from
 * a podcast or a video. So the owner is asked to read a short sentence that
 * contains three random words we just chose. After the upload we transcribe the
 * sample and check the words are in it: a pre-existing recording of someone
 * else cannot contain words nobody had picked yet.
 *
 * The challenge is stateless: a signed token carries the expiry, the language
 * and a nonce, bound to the business and the signed-in user. The words are
 * re-derived from the token on the server, so nothing is stored and the browser
 * cannot choose them. Uses Web Crypto only, so it runs on Node and Workers.
 */

import { CHALLENGE_TTL_MS } from "./model";

export type ChallengeLocale = "en" | "fr";

const WORDS: Record<ChallengeLocale, readonly string[]> = {
  en: [
    "river", "maple", "copper", "window", "garden", "silver", "harbor", "lantern",
    "meadow", "pebble", "canyon", "falcon", "velvet", "thunder", "willow", "cobalt",
    "juniper", "marble", "saddle", "timber", "anchor", "bridge", "cactus", "dolphin",
    "engine", "forest", "glacier", "hammer", "island", "jacket", "kitchen", "ladder",
    "magnet", "nickel", "oyster", "pepper", "quartz", "rocket", "summit", "tunnel",
    "umbrella", "violin", "walnut", "yellow", "basket", "candle", "desert", "feather",
  ],
  fr: [
    "riviere", "erable", "cuivre", "fenetre", "jardin", "argent", "lanterne", "prairie",
    "galet", "canyon", "faucon", "velours", "tonnerre", "saule", "cobalt", "braise",
    "marbre", "ancre", "cactus", "dauphin", "moteur", "foret", "glacier", "marteau",
    "veste", "cuisine", "echelle", "aimant", "nickel", "huitre", "poivre", "quartz",
    "fusee", "sommet", "tunnel", "parapluie", "violon", "noyer", "jaune", "panier",
    "bougie", "desert", "plume", "casque", "jungle", "citron", "miroir", "aiguille",
  ],
};

/** Words shown to the owner, with the accents a French reader expects. */
const DISPLAY_FR: Record<string, string> = {
  riviere: "rivière",
  erable: "érable",
  fenetre: "fenêtre",
  foret: "forêt",
  echelle: "échelle",
  huitre: "huître",
  fusee: "fusée",
  desert: "désert",
};

export type IssuedChallenge = {
  token: string;
  /** The three words, as the owner should read them. */
  words: string[];
  expiresAt: string;
};

export type ChallengeCheck =
  | { ok: true; words: string[]; locale: ChallengeLocale; nonce: string }
  | { ok: false; reason: "invalid" | "expired" };

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function deriveWords(
  secret: string,
  context: string,
  locale: ChallengeLocale,
): Promise<string[]> {
  const bytes = await hmac(secret, `words|${context}`);
  const list = WORDS[locale];
  const picked: string[] = [];
  for (let i = 0; picked.length < 3 && i + 1 < bytes.length; i += 2) {
    const word = list[((bytes[i]! << 8) | bytes[i + 1]!) % list.length]!;
    if (!picked.includes(word)) picked.push(word);
  }
  return picked;
}

/** The words as the owner should say them (French accents restored). */
export function displayWords(words: readonly string[], locale: ChallengeLocale): string[] {
  return words.map((w) => (locale === "fr" ? (DISPLAY_FR[w] ?? w) : w));
}

function bind(organizationId: string, userId: string): string {
  return `${organizationId}|${userId}`;
}

export async function issueChallenge(input: {
  secret: string;
  organizationId: string;
  userId: string;
  locale: ChallengeLocale;
  now: Date;
}): Promise<IssuedChallenge> {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(12));
  const nonce = toBase64Url(nonceBytes);
  const expires = input.now.getTime() + CHALLENGE_TTL_MS;
  const payload = `v1.${input.locale}.${expires}.${nonce}`;
  const context = `${payload}|${bind(input.organizationId, input.userId)}`;
  const signature = await hmac(input.secret, `sig|${context}`);
  const words = await deriveWords(input.secret, context, input.locale);
  return {
    token: `${toBase64Url(encoder.encode(payload))}.${toBase64Url(signature)}`,
    words: displayWords(words, input.locale),
    expiresAt: new Date(expires).toISOString(),
  };
}

/**
 * Checks a token came from us, for THIS business and user, and has not
 * expired. Returns the words the sample must contain. A token issued to one
 * business or user verifies for no other: the binding is part of what is signed.
 */
export async function verifyChallengeToken(input: {
  secret: string;
  token: string;
  organizationId: string;
  userId: string;
  now: Date;
}): Promise<ChallengeCheck> {
  const [payloadPart, signaturePart, extra] = input.token.split(".");
  if (!payloadPart || !signaturePart || extra !== undefined) {
    return { ok: false, reason: "invalid" };
  }
  const payloadBytes = fromBase64Url(payloadPart);
  const signature = fromBase64Url(signaturePart);
  if (!payloadBytes || !signature) return { ok: false, reason: "invalid" };
  const payload = new TextDecoder().decode(payloadBytes);
  const match = /^v1\.(en|fr)\.(\d{10,16})\.([A-Za-z0-9_-]{8,32})$/.exec(payload);
  if (!match) return { ok: false, reason: "invalid" };
  const locale = match[1] as ChallengeLocale;
  const expires = Number(match[2]);
  const nonce = match[3]!;

  const context = `${payload}|${bind(input.organizationId, input.userId)}`;
  const expected = await hmac(input.secret, `sig|${context}`);
  if (!constantTimeEqual(expected, signature)) {
    return { ok: false, reason: "invalid" };
  }
  if (input.now.getTime() > expires) return { ok: false, reason: "expired" };
  return {
    ok: true,
    words: await deriveWords(input.secret, context, locale),
    locale,
    nonce,
  };
}

/* -------------------------------------------------------------------------- */
/* Checking the transcript                                                    */
/* -------------------------------------------------------------------------- */

export function normalizeSpeech(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (a.length < b.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * True when every challenge word was heard. Speech-to-text can slip by one
 * letter on a long word, so words of five letters or more may differ by one;
 * short words must match exactly.
 */
export function transcriptHasChallenge(
  transcript: string,
  words: readonly string[],
): boolean {
  const spoken = normalizeSpeech(transcript);
  return words.every((word) => {
    const target = normalizeSpeech(word)[0] ?? "";
    if (!target) return false;
    return spoken.some((token) =>
      target.length >= 5 ? editDistanceAtMostOne(token, target) : token === target,
    );
  });
}

export function wordCount(transcript: string): number {
  return normalizeSpeech(transcript).length;
}
