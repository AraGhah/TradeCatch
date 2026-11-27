/**
 * Translate a receptionist VoicePlan into what a ConversationRelay socket
 * sends: text tokens (spoken by ElevenLabs through Twilio), then either
 * "listen" (wait for the caller) or "end" with a handoff the <Connect action>
 * callback turns into TwiML (dial, voicemail, hang up).
 *
 * Types only, no runtime imports: the Durable Object that owns the socket
 * imports this file, and it must not pull the receptionist engine into the
 * Worker entry bundle.
 */

import type {
  ReceptionistLanguage,
  VoicePlan,
} from "@/product/receptionist/types";

/** BCP-47 tags Twilio expects; kept equal to SPEECH_LANGUAGE in voice.ts. */
const RELAY_LANGUAGE: Record<ReceptionistLanguage, string> = {
  fr: "fr-CA",
  en: "en-US",
};

export type RelayToken = { text: string; lang: string };

export type RelayHandoff =
  | {
      action: "dial";
      sessionId: string;
      phoneE164: string;
      timeoutSeconds: number;
      screen?: boolean;
    }
  | { action: "voicemail"; sessionId: string; maxLengthSeconds: number }
  | { action: "hangup" }
  /** The socket could not run a turn; continue the call on <Gather>. */
  | { action: "fallback"; sessionId: string };

export type RelayTurn = {
  tokens: RelayToken[];
  /** Seconds to wait for the caller after the tokens are spoken. */
  listenSeconds: number | null;
  /** Language to transcribe the caller in next (the menu can switch it). */
  language?: string;
  end: RelayHandoff | null;
};

export function planToRelay(plan: VoicePlan): RelayTurn {
  const tokens: RelayToken[] = [];
  const speak = (text: string, language: ReceptionistLanguage) => {
    const trimmed = text.trim();
    if (trimmed) tokens.push({ text: trimmed, lang: RELAY_LANGUAGE[language] });
  };

  for (const verb of plan.verbs) {
    switch (verb.verb) {
      case "say":
        speak(verb.text, verb.language);
        break;
      case "gather":
        for (const prompt of verb.prompts) speak(prompt.text, prompt.language);
        return {
          tokens,
          listenSeconds: verb.timeoutSeconds,
          language: RELAY_LANGUAGE[verb.language],
          end: null,
        };
      case "dial":
        return {
          tokens,
          listenSeconds: null,
          end: plan.sessionId
            ? {
                action: "dial",
                sessionId: plan.sessionId,
                phoneE164: verb.phoneE164,
                timeoutSeconds: verb.timeoutSeconds,
                ...(verb.screen ? { screen: true } : {}),
              }
            : { action: "hangup" },
        };
      case "record":
        return {
          tokens,
          listenSeconds: null,
          end: plan.sessionId
            ? {
                action: "voicemail",
                sessionId: plan.sessionId,
                maxLengthSeconds: verb.maxLengthSeconds,
              }
            : { action: "hangup" },
        };
      case "sip_handoff":
        // LiveKit businesses never reach the relay; carry on in <Gather>.
        return {
          tokens,
          listenSeconds: null,
          end: plan.sessionId
            ? { action: "fallback", sessionId: plan.sessionId }
            : { action: "hangup" },
        };
      case "hangup":
        return { tokens, listenSeconds: null, end: { action: "hangup" } };
      case "pause":
        break;
    }
  }
  // A plan that neither listens nor ends would leave the caller in silence.
  return { tokens, listenSeconds: null, end: { action: "hangup" } };
}

/**
 * Rough time Twilio needs to speak the tokens (about 14 characters a second
 * on the phone, plus a short pad). Used to delay "end" so the last sentence is
 * not cut off, and to start the silence timer after the agent stops talking.
 */
export function estimateSpeechMs(tokens: RelayToken[]): number {
  const chars = tokens.reduce((sum, token) => sum + token.text.length, 0);
  if (chars === 0) return 0;
  return Math.min(30_000, Math.round((chars / 14) * 1000) + 800);
}

/** Parse the `intro` custom parameter rendered into the TwiML. */
export function parseRelayTurn(raw: unknown): RelayTurn | null {
  if (typeof raw !== "string" || raw.length > 8_192) return null;
  try {
    const value = JSON.parse(raw) as Partial<RelayTurn>;
    if (!value || !Array.isArray(value.tokens)) return null;
    const tokens = value.tokens.filter(
      (t): t is RelayToken =>
        !!t && typeof t.text === "string" && typeof t.lang === "string",
    );
    const listenSeconds =
      typeof value.listenSeconds === "number" && value.listenSeconds > 0
        ? Math.min(value.listenSeconds, 60)
        : null;
    const end =
      value.end && typeof value.end === "object" && "action" in value.end
        ? (value.end as RelayHandoff)
        : null;
    const language =
      typeof value.language === "string" && /^[a-z]{2}-[A-Z]{2}$/.test(value.language)
        ? value.language
        : undefined;
    return { tokens, listenSeconds, ...(language ? { language } : {}), end };
  } catch {
    return null;
  }
}
