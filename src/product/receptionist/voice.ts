/**
 * Provider-neutral voice verbs → provider output.
 *
 * The engine only ever returns `VoicePlan`s (say / gather / dial / record /
 * pause / hangup). Two renderers ship:
 * - `renderTwiml` for Twilio Programmable Voice webhooks (production path).
 * - `runVoicePlanLoop` for imperative, in-process voice servers such as a
 *   self-hosted Fonoster VoiceServer (see README) — and for tests.
 */

import { toSpeechMarkup } from "./speech-style";
import type {
  ReceptionistLanguage,
  SpeakingSpeed,
  VoiceCallbackStep,
  VoicePlan,
  VoiceVerb,
} from "./types";

export const SPEECH_LANGUAGE: Record<ReceptionistLanguage, string> = {
  fr: "fr-CA",
  en: "en-US",
};

/**
 * Recognition settings for <Gather>, read from the environment so they can be
 * tuned per deployment without a code change. Defaults are conservative:
 * Twilio's own model choice, automatic end-of-speech, and no profanity filter
 * (it rewrites real names and street names, e.g. "Cul-de-Sac").
 */
export type GatherTuning = {
  /** e.g. "phone_call"; unset = Twilio's default model. */
  speechModel?: string;
  enhanced?: boolean;
  /** "auto" or whole seconds of silence that end an utterance. */
  speechTimeout: string;
  profanityFilter: boolean;
  /** Seconds of silence before a normal question is treated as unanswered. */
  timeoutSeconds: number;
};

const SPEECH_MODELS = new Set([
  "default",
  "numbers_and_commands",
  "phone_call",
  "experimental_conversations",
  "experimental_utterances",
  "deepgram_nova-2",
  "deepgram_nova-3",
]);

export function gatherTuning(env: Record<string, string | undefined> = process.env): GatherTuning {
  const model = env.RECEPTIONIST_GATHER_SPEECH_MODEL?.trim();
  const timeout = Number(env.RECEPTIONIST_GATHER_TIMEOUT_SECONDS);
  const speechTimeout = env.RECEPTIONIST_GATHER_SPEECH_TIMEOUT?.trim() ?? "auto";
  return {
    speechModel: model && SPEECH_MODELS.has(model) ? model : undefined,
    enhanced: env.RECEPTIONIST_GATHER_ENHANCED === "1" ? true : undefined,
    speechTimeout: /^(?:auto|[1-9]|10)$/.test(speechTimeout) ? speechTimeout : "auto",
    profanityFilter: env.RECEPTIONIST_GATHER_PROFANITY_FILTER === "1",
    timeoutSeconds:
      Number.isFinite(timeout) && timeout >= 3 && timeout <= 15
        ? Math.round(timeout)
        : 6,
  };
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export type TwimlCallbackUrl = (
  step: VoiceCallbackStep,
  sessionId: string | null,
) => string;

export type RenderOptions = {
  /** Pacing markup on <Say>. Defaults to the RECEPTIONIST_SSML switch. */
  ssml?: boolean;
  tuning?: GatherTuning;
};

function sayXml(
  text: string,
  voice: string,
  language: ReceptionistLanguage,
  speed: SpeakingSpeed | undefined,
  opts: RenderOptions,
) {
  const inner = toSpeechMarkup(text, voice, { speed, ssml: opts.ssml });
  return `<Say voice="${escapeXml(voice)}" language="${SPEECH_LANGUAGE[language]}">${inner}</Say>`;
}

function verbToTwiml(
  verb: VoiceVerb,
  sessionId: string | null,
  callbackUrl: TwimlCallbackUrl,
  opts: RenderOptions,
): string {
  switch (verb.verb) {
    case "say":
      return sayXml(verb.text, verb.voice, verb.language, verb.speed, opts);
    case "pause":
      return `<Pause length="${Math.max(1, Math.round(verb.seconds))}"/>`;
    case "hangup":
      return `<Hangup/>`;
    case "gather": {
      const tuning = opts.tuning ?? gatherTuning();
      const attrs = [
        `input="${verb.input.join(" ")}"`,
        `action="${escapeXml(callbackUrl("gather", sessionId))}"`,
        `method="POST"`,
        `language="${SPEECH_LANGUAGE[verb.language]}"`,
        `timeout="${verb.timeoutSeconds}"`,
        `speechTimeout="${tuning.speechTimeout}"`,
        `profanityFilter="${tuning.profanityFilter}"`,
        // Always call back, even on silence, so the engine owns reprompts.
        `actionOnEmptyResult="true"`,
      ];
      // Speech-only options mean nothing to a keypad-only prompt.
      if (verb.input.includes("speech")) {
        if (tuning.speechModel) attrs.push(`speechModel="${tuning.speechModel}"`);
        if (tuning.enhanced && tuning.speechModel === "phone_call") {
          attrs.push(`enhanced="true"`);
        }
      }
      if (verb.numDigits) attrs.push(`numDigits="${verb.numDigits}"`);
      if (verb.hints?.length) {
        attrs.push(`hints="${escapeXml(verb.hints.slice(0, 50).join(","))}"`);
      }
      const prompts = verb.prompts
        .map((p) => sayXml(p.text, p.voice, p.language, p.speed, opts))
        .join("");
      return `<Gather ${attrs.join(" ")}>${prompts}</Gather>`;
    }
    case "dial": {
      const attrs = [
        `action="${escapeXml(callbackUrl("dial", sessionId))}"`,
        `method="POST"`,
        `timeout="${verb.timeoutSeconds}"`,
      ];
      if (verb.callerIdE164) {
        attrs.push(`callerId="${escapeXml(verb.callerIdE164)}"`);
      }
      return `<Dial ${attrs.join(" ")}><Number>${escapeXml(verb.phoneE164)}</Number></Dial>`;
    }
    case "record":
      return `<Record action="${escapeXml(callbackUrl("voicemail", sessionId))}" method="POST" maxLength="${verb.maxLengthSeconds}" playBeep="true" finishOnKey="#" timeout="5"/>`;
  }
}

/** Render a plan to a TwiML document. */
export function renderTwiml(
  plan: VoicePlan,
  callbackUrl: TwimlCallbackUrl,
  opts: RenderOptions = {},
): string {
  const body = plan.verbs
    .map((v) => verbToTwiml(v, plan.sessionId, callbackUrl, opts))
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

/* ------------------------------------------------------------------------- */
/* Imperative runner (Fonoster-style voice servers, tests)                    */
/* ------------------------------------------------------------------------- */

/**
 * Minimal structural surface of an imperative voice channel. A Fonoster
 * `VoiceResponse` (answer/say/gather/dial/record/hangup) can be wrapped into
 * this shape without TradeCatch depending on the Fonoster SDK.
 */
export type ImperativeVoiceChannel = {
  say(text: string, opts: { voice: string; language: string }): Promise<void>;
  gather(opts: {
    language: string;
    timeoutSeconds: number;
    numDigits?: number;
    speech: boolean;
    dtmf: boolean;
    prompts: { text: string; voice: string; language: string }[];
  }): Promise<{ speech?: string; digits?: string; confidence?: number }>;
  dial(
    phoneE164: string,
    opts: { timeoutSeconds: number; callerIdE164?: string },
  ): Promise<{ status: string; durationSeconds?: number }>;
  record(opts: {
    maxLengthSeconds: number;
  }): Promise<{ recordingUrl?: string; durationSeconds?: number }>;
  pause?(seconds: number): Promise<void>;
  hangup(): Promise<void>;
};

export type VoicePlanCallbacks = {
  onGather(input: {
    sessionId: string | null;
    speech: string;
    digits?: string;
    confidence?: number;
  }): Promise<VoicePlan>;
  onDial(input: {
    sessionId: string | null;
    status: string;
    durationSeconds?: number;
  }): Promise<VoicePlan>;
  onVoicemail(input: {
    sessionId: string | null;
    recordingUrl?: string;
    durationSeconds?: number;
  }): Promise<VoicePlan>;
};

/**
 * Execute plans until a hangup (or a plan with no callback verb) is reached.
 * `maxPlans` bounds runaway loops.
 */
export async function runVoicePlanLoop(
  first: VoicePlan,
  channel: ImperativeVoiceChannel,
  callbacks: VoicePlanCallbacks,
  maxPlans = 60,
): Promise<{ plansExecuted: number }> {
  let plan: VoicePlan | null = first;
  let executed = 0;

  while (plan && executed < maxPlans) {
    executed += 1;
    let next: VoicePlan | null = null;
    for (const verb of plan.verbs) {
      if (verb.verb === "say") {
        await channel.say(verb.text, {
          voice: verb.voice,
          language: SPEECH_LANGUAGE[verb.language],
        });
      } else if (verb.verb === "pause") {
        await channel.pause?.(verb.seconds);
      } else if (verb.verb === "hangup") {
        await channel.hangup();
        return { plansExecuted: executed };
      } else if (verb.verb === "gather") {
        const result = await channel.gather({
          language: SPEECH_LANGUAGE[verb.language],
          timeoutSeconds: verb.timeoutSeconds,
          numDigits: verb.numDigits,
          speech: verb.input.includes("speech"),
          dtmf: verb.input.includes("dtmf"),
          prompts: verb.prompts.map((p) => ({
            text: p.text,
            voice: p.voice,
            language: SPEECH_LANGUAGE[p.language],
          })),
        });
        next = await callbacks.onGather({
          sessionId: plan.sessionId,
          speech: result.speech ?? "",
          digits: result.digits,
          confidence: result.confidence,
        });
        break;
      } else if (verb.verb === "dial") {
        let status = "failed";
        let durationSeconds: number | undefined;
        try {
          const r = await channel.dial(verb.phoneE164, {
            timeoutSeconds: verb.timeoutSeconds,
            callerIdE164: verb.callerIdE164,
          });
          status = r.status;
          durationSeconds = r.durationSeconds;
        } catch {
          status = "failed";
        }
        next = await callbacks.onDial({
          sessionId: plan.sessionId,
          status,
          durationSeconds,
        });
        break;
      } else if (verb.verb === "record") {
        const r = await channel.record({
          maxLengthSeconds: verb.maxLengthSeconds,
        });
        next = await callbacks.onVoicemail({
          sessionId: plan.sessionId,
          recordingUrl: r.recordingUrl,
          durationSeconds: r.durationSeconds,
        });
        break;
      }
    }
    plan = next;
  }
  return { plansExecuted: executed };
}
