/**
 * Provider-neutral voice verbs → provider output.
 *
 * The engine only ever returns `VoicePlan`s (say / gather / dial / record /
 * pause / hangup). Two renderers ship:
 * - `renderTwiml` for Twilio Programmable Voice webhooks (production path).
 * - `runVoicePlanLoop` for imperative, in-process voice servers such as a
 *   self-hosted Fonoster VoiceServer (see README) — and for tests.
 */

import type {
  ReceptionistLanguage,
  VoiceCallbackStep,
  VoicePlan,
  VoiceVerb,
} from "./types";

export const SPEECH_LANGUAGE: Record<ReceptionistLanguage, string> = {
  fr: "fr-CA",
  en: "en-US",
};

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

function sayXml(text: string, voice: string, language: ReceptionistLanguage) {
  return `<Say voice="${escapeXml(voice)}" language="${SPEECH_LANGUAGE[language]}">${escapeXml(text)}</Say>`;
}

function verbToTwiml(
  verb: VoiceVerb,
  sessionId: string | null,
  callbackUrl: TwimlCallbackUrl,
): string {
  switch (verb.verb) {
    case "say":
      return sayXml(verb.text, verb.voice, verb.language);
    case "pause":
      return `<Pause length="${Math.max(1, Math.round(verb.seconds))}"/>`;
    case "hangup":
      return `<Hangup/>`;
    case "gather": {
      const attrs = [
        `input="${verb.input.join(" ")}"`,
        `action="${escapeXml(callbackUrl("gather", sessionId))}"`,
        `method="POST"`,
        `language="${SPEECH_LANGUAGE[verb.language]}"`,
        `timeout="${verb.timeoutSeconds}"`,
        `speechTimeout="auto"`,
        // Always call back, even on silence, so the engine owns reprompts.
        `actionOnEmptyResult="true"`,
      ];
      if (verb.numDigits) attrs.push(`numDigits="${verb.numDigits}"`);
      if (verb.hints?.length) {
        attrs.push(`hints="${escapeXml(verb.hints.slice(0, 50).join(","))}"`);
      }
      const prompts = verb.prompts
        .map((p) => sayXml(p.text, p.voice, p.language))
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
): string {
  const body = plan.verbs
    .map((v) => verbToTwiml(v, plan.sessionId, callbackUrl))
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
