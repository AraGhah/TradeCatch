/**
 * Voice-plan building blocks for the receptionist engine: the verbs a call
 * hears (say / gather) and the small fixed plans (hang up, SIP hand-off,
 * personal-caller message). Pure: no store, clock or provider access.
 */

import { personalCallMessage } from "@/product/telephony/caller-policy";
import { firstLanguage, languageSelectTimeoutSeconds } from "./language-select";
import {
  afterHoursFor,
  greetingStatement,
  hintsFor,
  languageMenuPrompts,
  openingQuestion,
  phrase,
} from "./prompts";
import type {
  CallSession,
  CallStep,
  ReceptionistConfig,
  ReceptionistLanguage,
  VoicePlan,
  VoiceVerb,
} from "./types";
import { gatherTuning } from "./voice";

export function voiceOf(config: ReceptionistConfig, lang: ReceptionistLanguage) {
  return config.voices[lang];
}

export function listen(
  config: ReceptionistConfig,
  session: CallSession,
  prompts: { text: string; lang?: ReceptionistLanguage }[],
  opts: { dtmfDigits?: number } = {},
): VoiceVerb {
  const inLanguageMenu = session.step === "language";
  // After "For English, press 1" was repeated, a lone key is still listened for.
  const englishHint = Boolean(session.flags?.englishHinted);
  const allowDtmf =
    Boolean(opts.dtmfDigits) ||
    englishHint ||
    session.step === "callback_number" ||
    session.step === "callback" ||
    session.step === "offer_slot" ||
    inLanguageMenu;
  return {
    verb: "gather",
    next: "gather",
    language: session.language,
    prompts: prompts
      .filter((p) => p.text.trim())
      .map((p) => ({
        text: p.text,
        voice: voiceOf(config, p.lang ?? session.language),
        language: p.lang ?? session.language,
        speed: config.speakingSpeed,
      })),
    input: allowDtmf ? ["speech", "dtmf"] : ["speech"],
    // The language menu waits only briefly: no key means "stay in French".
    timeoutSeconds: inLanguageMenu
      ? languageSelectTimeoutSeconds()
      : gatherTuning().timeoutSeconds,
    numDigits:
      opts.dtmfDigits ??
      (session.step === "callback_number"
        ? 10
        : inLanguageMenu || session.step === "offer_slot"
          ? 1
          : undefined),
    hints: hintsFor(config),
  };
}

export function say(
  config: ReceptionistConfig,
  lang: ReceptionistLanguage,
  text: string,
): VoiceVerb {
  return {
    verb: "say",
    text,
    language: lang,
    voice: voiceOf(config, lang),
    speed: config.speakingSpeed,
  };
}

/**
 * What starts a call: the greeting, then (bilingual line) the language menu in
 * French first, or (one language) the after-hours notice and the opening question.
 */
export function openingFor(
  config: ReceptionistConfig,
  afterHours: boolean,
): {
  language: ReceptionistLanguage;
  step: CallStep;
  prompts: { text: string; lang?: ReceptionistLanguage }[];
} {
  const language = firstLanguage(config.languages, config.defaultLanguage);
  if (config.languages.length > 1) {
    return {
      language,
      step: "language",
      prompts: [
        { text: greetingStatement(config, language), lang: language },
        ...languageMenuPrompts(),
      ],
    };
  }
  return {
    language,
    step: "reason",
    prompts: [
      { text: greetingStatement(config, language) },
      ...(afterHours ? [{ text: afterHoursFor(config, language) }] : []),
      { text: openingQuestion(config, language) },
    ],
  };
}

/** The words that go with the notice owed to an after-hours caller, once. */
export function afterHoursNotice(
  config: ReceptionistConfig,
  session: CallSession,
): string {
  return session.afterHours ? afterHoursFor(config, session.language) : "";
}

/** Add "For English, press 1." (in the English voice) after the question being asked. */
export function appendEnglishHint(config: ReceptionistConfig, plan: VoicePlan): void {
  const gather = plan.verbs.findLast((v) => v.verb === "gather");
  if (gather?.verb !== "gather") return;
  gather.prompts.push({
    text: phrase("pressForEnglish", "en"),
    voice: voiceOf(config, "en"),
    language: "en",
    speed: config.speakingSpeed,
  });
}

export function hangupPlan(sessionId: string | null): VoicePlan {
  return { sessionId, verbs: [{ verb: "hangup" }] };
}

export function sipHandoffPlan(
  config: ReceptionistConfig,
  session: CallSession,
): VoicePlan {
  return {
    sessionId: session.id,
    verbs: [
      {
        verb: "sip_handoff",
        next: "dial",
        target: "livekit",
        calledE164: config.phoneNumberE164,
        timeoutSeconds: 20,
      },
    ],
  };
}

/** The words for a personal / withheld caller, then the end of the call. */
export function policyMessagePlan(
  config: ReceptionistConfig,
  sessionId: string | null,
  kind: "personal" | "unknown",
): VoicePlan {
  return {
    sessionId,
    verbs: [
      ...personalCallMessage(config, kind).map((m) =>
        say(config, m.lang, m.text),
      ),
      { verb: "hangup" },
    ],
  };
}
