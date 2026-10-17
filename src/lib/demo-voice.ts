/**
 * ElevenLabs voices for the public receptionist demo.
 * English: y0s2ExEMuum3muUnA6Zd
 * French:  j9RedbMRSNQ74PyikQwD
 * The API key stays on the server. The browser only sends the reply text.
 */
export const DEMO_ELEVEN_VOICES = {
  en: "y0s2ExEMuum3muUnA6Zd",
  fr: "j9RedbMRSNQ74PyikQwD",
} as const;

export type DemoVoiceLocale = keyof typeof DEMO_ELEVEN_VOICES;

/** One spoken reply. Long enough for a greeting plus the next question. */
export const MAX_DEMO_SPEECH_CHARS = 800;

export function demoSpeechText(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_DEMO_SPEECH_CHARS) return null;
  return text;
}

export function demoVoiceId(locale: DemoVoiceLocale): string {
  return DEMO_ELEVEN_VOICES[locale];
}
