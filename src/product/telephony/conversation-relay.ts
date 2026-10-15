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

export type RelayInboundMessage =
  | { type: "setup"; callSid: string; from: string; to: string; customParameters?: Record<string, string> }
  | { type: "prompt"; voicePrompt: string; lang?: string; last?: boolean }
  | { type: "interrupt"; utteranceUntilInterrupt?: string }
  | { type: "error"; description?: string }
  | { type: "dtmf"; digit: string };

export type RelayOutboundMessage =
  | { type: "text"; token: string; last?: boolean; interruptible?: boolean }
  | { type: "end"; handoffData?: string };

export function renderConversationRelayTwiml(input: {
  websocketUrl: string;
  language: ReceptionistLanguage;
  welcomeGreeting: string;
  actionUrl: string;
  sessionId: string;
  ttsProvider?: string;
  transcriptionProvider?: string;
}): string {
  const lang = SPEECH_LANGUAGE[input.language];
  const attrs = [
    `url="${escapeXml(input.websocketUrl)}"`,
    `language="${lang}"`,
    `welcomeGreeting="${escapeXml(input.welcomeGreeting)}"`,
  ];
  if (input.ttsProvider) attrs.push(`ttsProvider="${escapeXml(input.ttsProvider)}"`);
  if (input.transcriptionProvider) {
    attrs.push(
      `transcriptionProvider="${escapeXml(input.transcriptionProvider)}"`,
    );
  }
  // Pass session id as a custom parameter for the WS setup message.
  const params = `<Parameter name="sessionId" value="${escapeXml(input.sessionId)}"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect action="${escapeXml(input.actionUrl)}" method="POST"><ConversationRelay ${attrs.join(" ")}>${params}</ConversationRelay></Connect></Response>`;
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
