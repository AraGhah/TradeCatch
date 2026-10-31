/**
 * How a reply is spoken on a Twilio <Say> (pure, no I/O).
 *
 * Plain text through a neural voice is intelligible but flat: the same speed for
 * a greeting and for a phone number, and no beat after "Parfait." So the TwiML
 * renderer passes every reply through here to get a little SSML:
 *
 * - the owner's `speakingSpeed` sets the base pace (relative to the voice's own
 *   default, which is already close to 150 words per minute);
 * - sentences carrying digits (phone number, street number, postal code, clock
 *   time) are read about 10 % slower than the rest;
 * - a short pause follows each group of digits and a very short one follows a
 *   one-or-two-word acknowledgement ("Parfait.", "Got it.");
 * - spoken postal codes are spaced out so they are read letter by letter.
 *
 * Only `<prosody rate>` and `<break>` are emitted — tags every Polly and Google
 * voice accepts — and all text is XML-escaped. A tag the voice rejects would
 * leave the caller in silence, so the whole layer can be switched off with
 * RECEPTIONIST_SSML=0 and is skipped for voices that are not Polly/Google.
 *
 * The percentages are a starting point to tune on real calls, not a measurement.
 */

import type { SpeakingSpeed } from "./types";

/** Percent of the voice's default rate for each owner setting. */
export const BASE_RATE_PERCENT: Record<SpeakingSpeed, number> = {
  slow: 88,
  normal: 96,
  fast: 106,
};

/** Extra slowdown for sentences that carry digits. */
const CAREFUL_DELTA = -10;
const MIN_RATE = 70;
const MAX_RATE = 115;

/** Pause after a group of digits, in milliseconds. */
const DIGIT_GROUP_BREAK_MS = 280;
/** Pause after a one-or-two-word acknowledgement. */
const ACK_BREAK_MS = 140;

export function escapeSsmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function ssmlEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.RECEPTIONIST_SSML?.trim() !== "0";
}

/** Voices that accept SSML inside <Say>. Basic voices (alice, man, woman) do not. */
export function voiceSupportsSsml(voice: string): boolean {
  return /^(?:Polly|Google)\./.test(voice);
}

function clampRate(percent: number): number {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(percent)));
}

export function ratePercent(
  speed: SpeakingSpeed | undefined,
  careful: boolean,
): number {
  const base = BASE_RATE_PERCENT[speed ?? "normal"];
  return clampRate(careful ? base + CAREFUL_DELTA : base);
}

/** "H2X 1Y4" → "H 2 X, 1 Y 4" so it is spelled out instead of mispronounced. */
export function spacePostalCodes(text: string): string {
  return text.replace(
    /\b([A-Za-z])(\d)([A-Za-z])[ -]?(\d)([A-Za-z])(\d)\b/g,
    (_m, a: string, b: string, c: string, d: string, e: string, f: string) =>
      `${a.toUpperCase()} ${b} ${c.toUpperCase()}, ${d} ${e.toUpperCase()} ${f}`,
  );
}

// Several digits in a row, "5 1 4, 5 5 5", a clock time, or an amount.
const CAREFUL_SENTENCE =
  /\d{3,}|\d(?:[\s,.-]+\d){3,}|\b\d{1,2}\s?h(?:\s?\d{2})?\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s?(?:am|pm|a\.m\.|p\.m\.)/i;

export function isCarefulSentence(sentence: string): boolean {
  return CAREFUL_SENTENCE.test(sentence);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function wordCount(sentence: string): number {
  return sentence.split(/\s+/).filter(Boolean).length;
}

/** Escape a sentence and give every ", " inside a run of digits a short pause. */
function sentenceToSsml(sentence: string): string {
  const escaped = escapeSsmlText(sentence);
  return escaped.replace(
    /(\d),(\s)(?=\d)/g,
    `$1,<break time="${DIGIT_GROUP_BREAK_MS}ms"/>$2`,
  );
}

export type SpeechStyleOptions = {
  speed?: SpeakingSpeed;
  /** Defaults to the RECEPTIONIST_SSML switch. */
  ssml?: boolean;
};

/**
 * The inside of a <Say> element for `text`: escaped plain text when SSML is off
 * or unsupported, otherwise text with pacing tags.
 */
export function toSpeechMarkup(
  text: string,
  voice: string,
  opts: SpeechStyleOptions = {},
): string {
  const prepared = spacePostalCodes(text.trim().replace(/\s+/g, " "));
  const useSsml = (opts.ssml ?? ssmlEnabled()) && voiceSupportsSsml(voice);
  if (!useSsml) return escapeSsmlText(prepared);

  const sentences = splitSentences(prepared);
  const baseRate = ratePercent(opts.speed, false);
  const parts: string[] = [];
  sentences.forEach((sentence, i) => {
    const careful = isCarefulSentence(sentence);
    const rate = careful ? ratePercent(opts.speed, true) : baseRate;
    const body = sentenceToSsml(sentence);
    parts.push(rate === 100 ? body : `<prosody rate="${rate}%">${body}</prosody>`);
    const isLast = i === sentences.length - 1;
    if (!isLast && wordCount(sentence) <= 2) {
      parts.push(`<break time="${ACK_BREAK_MS}ms"/>`);
    }
  });
  return parts.join(" ");
}
