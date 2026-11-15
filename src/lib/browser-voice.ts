/**
 * Browser speech-synthesis voice choice for the receptionist demo fallback (used only
 * when the ElevenLabs demo voice is off). The receptionist is a woman, so a man's
 * system voice must never be picked just because it matches the language.
 *
 * Browsers expose no gender field, only a voice name, so this matches the names of the
 * common Microsoft / Apple / Google voices. Pure (no DOM types needed): unit-testable.
 */

export type BrowserVoice = { name: string; lang: string };

const FEMALE_VOICE_NAMES =
  /\b(female|woman|femme|denise|sylvie|amelie|amélie|aria|jenny|michelle|emma|ava|libby|sonia|samantha|victoria|karen|moira|tessa|fiona|paulina|monica|chantal|julie|hortense|marie|nathalie|jessa|natasha|clara|eva|zira)\b/i;

const MALE_VOICE_NAMES =
  /\b(male|man|homme|antoine|henri|claude|jean|thierry|paul|guy|davis|jason|tony|andrew|brian|christopher|eric|roger|steffan|ryan|thomas|daniel|alex|fred|mark|david|george|james|liam|guillaume|remy|rémy)\b/i;

// `\bmale\b` does not match "female": there is no word boundary inside the word.
export function isFemaleVoiceName(name: string): boolean {
  return FEMALE_VOICE_NAMES.test(name);
}

export function isMaleVoiceName(name: string): boolean {
  return MALE_VOICE_NAMES.test(name) && !FEMALE_VOICE_NAMES.test(name);
}

function norm(value: string): string {
  return value.toLowerCase().replace("_", "-");
}

/**
 * Best installed voice for the language: exact region, then same language. Within a
 * group a female-named voice beats an unrecognised one, and a male-named voice is only
 * used when nothing else of that language exists (a wrong accent is worse than a
 * wrong pitch, but a voice-less fallback is better than silence).
 */
export function pickReceptionistVoice<T extends BrowserVoice>(
  voices: T[],
  lang: string,
): T | null {
  const wanted = norm(lang);
  const primary = wanted.split("-")[0]!;
  const rank = (v: T) => {
    if (isMaleVoiceName(v.name)) return 0;
    return isFemaleVoiceName(v.name) ? 2 : 1;
  };
  const best = (group: T[]): T | null => {
    // Array.prototype.sort is stable: browser order breaks ties.
    const sorted = [...group].sort((a, b) => rank(b) - rank(a));
    return sorted[0] ?? null;
  };
  const exact = voices.filter((v) => norm(v.lang) === wanted);
  const sameLanguage = voices.filter(
    (v) => norm(v.lang).split("-")[0] === primary,
  );
  const exactPick = best(exact);
  const languagePick = best(sameLanguage);
  // A same-language voice of the right sex beats an exact-region voice of the wrong one.
  if (
    exactPick &&
    rank(exactPick) === 0 &&
    languagePick &&
    rank(languagePick) > 0
  ) {
    return languagePick;
  }
  return exactPick ?? languagePick;
}
