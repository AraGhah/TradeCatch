/**
 * Twilio ConversationRelay helpers.
 *
 * Production WebSocket hosting on Cloudflare typically needs Durable Objects.
 * This module:
 * - Renders <Connect><ConversationRelay> TwiML when the voice engine is set.
 * - Processes ConversationRelay JSON messages against the receptionist brain
 *   (usable from a WebSocket handler or the simulated live-test path).
 *
 * @see https://www.twilio.com/docs/voice/twiml/connect/conversationrelay
 */

import { createRuleBrain } from "@/product/receptionist/brain-rules";
import { createReceptionistEngine } from "@/product/receptionist/engine";
import { greetingFor } from "@/product/receptionist/prompts";
import { createMemoryReceptionistStore } from "@/product/receptionist/store";
import type {
  CallSession,
  ReceptionistConfig,
  ReceptionistLanguage,
} from "@/product/receptionist/types";
import { escapeXml, SPEECH_LANGUAGE } from "@/product/receptionist/voice";
import type { RelayTurn } from "@/product/telephony/relay-plan";

export type RelayInboundMessage =
  | { type: "setup"; callSid: string; from: string; to: string; customParameters?: Record<string, string> }
  | { type: "prompt"; voicePrompt: string; lang?: string; last?: boolean }
  | { type: "interrupt"; utteranceUntilInterrupt?: string }
  | { type: "error"; description?: string }
  | { type: "dtmf"; digit: string };

export type RelayOutboundMessage =
  | { type: "text"; token: string; last?: boolean; interruptible?: boolean }
  | { type: "end"; handoffData?: string };

/** ElevenLabs voice string per language; null lets Twilio pick its default. */
export type RelayVoices = Record<ReceptionistLanguage, string | null>;

/**
 * `off`: never render ConversationRelay. `opt_in`: only businesses whose
 * voice engine is `conversation_relay`. `all`: also every business on the
 * default `gather` engine (LiveKit businesses keep LiveKit).
 */
export type RelayMode = "off" | "opt_in" | "all";

export function relayModeFromEnv(
  env: Record<string, string | undefined> = process.env,
): RelayMode {
  const value = env.CONVERSATION_RELAY_MODE?.trim().toLowerCase();
  return value === "opt_in" || value === "all" ? value : "off";
}

export function usesConversationRelay(
  engine: ReceptionistConfig["voiceEngine"] | undefined,
  mode: RelayMode,
): boolean {
  if (mode === "off") return false;
  if (engine === "conversation_relay") return true;
  return mode === "all" && (engine ?? "gather") === "gather";
}

// A 20-character ElevenLabs voice id, optionally followed by Twilio's
// `-model` and `-settings` parts (see Twilio "Voice string format").
const VOICE_STRING = /^[A-Za-z0-9]{20}(-[A-Za-z0-9_.]+){0,2}$/;
const DEFAULT_ELEVENLABS_MODEL = "v4";

/**
 * A bare voice id gets the v4 model Twilio recommends; a full voice string is
 * kept as written. Anything else is dropped so a typo can never reach TwiML
 * (Twilio ends the session with 64101 on an invalid voice).
 */
export function normalizeRelayVoice(value: string | undefined): string | null {
  const voice = value?.trim();
  if (!voice || !VOICE_STRING.test(voice)) return null;
  return voice.includes("-") ? voice : `${voice}-${DEFAULT_ELEVENLABS_MODEL}`;
}

export function relayVoicesFromEnv(
  env: Record<string, string | undefined> = process.env,
): RelayVoices {
  return {
    fr: normalizeRelayVoice(env.ELEVENLABS_RELAY_VOICE_FR),
    en: normalizeRelayVoice(env.ELEVENLABS_RELAY_VOICE_EN),
  };
}

export function renderConversationRelayTwiml(input: {
  websocketUrl: string;
  language: ReceptionistLanguage;
  welcomeGreeting?: string;
  actionUrl: string;
  sessionId: string;
  /** Spoken by the relay socket right after setup, each in its own voice. */
  intro?: RelayTurn;
  voices?: RelayVoices;
  ttsProvider?: string;
  transcriptionProvider?: string;
}): string {
  const lang = SPEECH_LANGUAGE[input.language];
  const ttsProvider = input.ttsProvider ?? (input.voices ? "ElevenLabs" : undefined);
  const attrs = [
    `url="${escapeXml(input.websocketUrl)}"`,
    `language="${lang}"`,
  ];
  if (input.welcomeGreeting) {
    attrs.push(`welcomeGreeting="${escapeXml(input.welcomeGreeting)}"`);
  }
  if (ttsProvider) attrs.push(`ttsProvider="${escapeXml(ttsProvider)}"`);
  if (input.transcriptionProvider) {
    attrs.push(
      `transcriptionProvider="${escapeXml(input.transcriptionProvider)}"`,
    );
  }
  // The language menu and "press 1" prompts need keypad input.
  attrs.push(`dtmfDetection="true"`);
  // One <Language> per receptionist language, so a text token tagged
  // `lang="en-US"` is read by the English voice and not the French one.
  const languages = input.voices
    ? (Object.keys(SPEECH_LANGUAGE) as ReceptionistLanguage[])
        .map((code) => {
          const voice = input.voices![code];
          const parts = [
            `code="${SPEECH_LANGUAGE[code]}"`,
            `ttsProvider="${escapeXml(ttsProvider ?? "ElevenLabs")}"`,
          ];
          if (voice) parts.push(`voice="${escapeXml(voice)}"`);
          return `<Language ${parts.join(" ")}/>`;
        })
        .join("")
    : "";
  // Session id (and the opening prompts) come back in the socket's setup message.
  let params = `<Parameter name="sessionId" value="${escapeXml(input.sessionId)}"/>`;
  if (input.intro && (input.intro.tokens.length > 0 || input.intro.end)) {
    params += `<Parameter name="intro" value="${escapeXml(JSON.stringify(input.intro))}"/>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect action="${escapeXml(input.actionUrl)}" method="POST"><ConversationRelay ${attrs.join(" ")}>${languages}${params}</ConversationRelay></Connect></Response>`;
}

export type RelaySessionState = {
  config: ReceptionistConfig;
  session: CallSession;
  language: ReceptionistLanguage;
};

/**
 * In-memory ConversationRelay turn runner for staging tests / DO stubs.
 * Never places real calls; uses the same rule brain as gather mode.
 */
export function createRelayConversation(config: ReceptionistConfig) {
  const store = createMemoryReceptionistStore();
  const engine = createReceptionistEngine({
    store,
    configs: () => [{ ...config, enabled: true, callHandlingMode: "always" }],
    brain: createRuleBrain(),
    notifier: {
      async deliverSummary() {
        return [];
      },
      async alertEmergency() {
        return [];
      },
    },
    llm: null,
  });

  let callSid: string | null = null;
  let sessionId: string | null = null;

  return {
    async onSetup(input: {
      callSid: string;
      fromE164: string;
      toE164: string;
      language?: ReceptionistLanguage;
    }): Promise<RelayOutboundMessage[]> {
      callSid = input.callSid;
      const plan = await engine.startCall({
        callSid: input.callSid,
        fromE164: input.fromE164,
        toE164: input.toE164,
      });
      sessionId = plan.sessionId;
      const session = sessionId ? await store.getSession(sessionId) : null;
      if (input.language && session && session.language !== input.language) {
        session.language = input.language;
        await store.saveSession(session);
      }
      // Welcome greeting is already spoken by ConversationRelay; only send
      // follow-up if the gather plan had extra prompts beyond greeting.
      return [];
    },

    async onPrompt(speech: string): Promise<RelayOutboundMessage[]> {
      if (!sessionId) {
        return [
          {
            type: "text",
            token: greetingFor(config, config.defaultLanguage),
            last: true,
          },
        ];
      }
      const plan = await engine.handleGather({ sessionId, speech });
      const tokens: RelayOutboundMessage[] = [];
      for (const verb of plan.verbs) {
        if (verb.verb === "say") {
          tokens.push({ type: "text", token: verb.text, last: false });
        } else if (verb.verb === "gather") {
          for (const p of verb.prompts) {
            tokens.push({ type: "text", token: p.text, last: false });
          }
        } else if (verb.verb === "dial") {
          // End relay so the action callback can <Dial>.
          tokens.push({
            type: "end",
            handoffData: JSON.stringify({
              action: "dial",
              phoneE164: verb.phoneE164,
              sessionId,
            }),
          });
          return tokens;
        } else if (verb.verb === "hangup") {
          tokens.push({ type: "end" });
          return tokens;
        }
      }
      if (tokens.length > 0) {
        const last = tokens[tokens.length - 1]!;
        if (last.type === "text") {
          tokens[tokens.length - 1] = { ...last, last: true };
        }
      }
      return tokens;
    },

    async getSession(): Promise<CallSession | null> {
      return sessionId ? store.getSession(sessionId) : null;
    },

    getCallSid() {
      return callSid;
    },
  };
}

export function parseRelayMessage(raw: string): RelayInboundMessage | null {
  try {
    const msg = JSON.parse(raw) as RelayInboundMessage;
    if (!msg || typeof msg !== "object" || !("type" in msg)) return null;
    return msg;
  } catch {
    return null;
  }
}
