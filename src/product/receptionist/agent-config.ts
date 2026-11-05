/**
 * What an external realtime voice agent (the LiveKit agent in /agents/receptionist)
 * needs to answer one business's calls: its rendered instructions, the exact
 * words of the French-first opening, and the only numbers it may transfer to.
 *
 * The agent never receives a number from the model or from the caller. It picks
 * between the two lines below, which come from the owner-validated profile
 * (Canadian geographic numbers only, see profile.ts), so a prompt-injected
 * caller cannot make the line dial an arbitrary or premium number.
 *
 * The spoken copy (greeting, language menu, silence check-in) is built here from
 * the same prompts the Twilio engine uses, so both voice paths say the same
 * thing and the agent holds no business wording of its own.
 */

import { isAfterHours } from "@/product/missed-call/call-handling";
import {
  STANDARD_AGENT_VOICE,
  type AgentVoice,
} from "./custom-voice/model";
import {
  firstLanguage,
  languageSelectTimeoutSeconds,
} from "./language-select";
import {
  afterHoursFor,
  greetingStatement,
  languageMenuPrompts,
  openingQuestion,
  phrase,
} from "./prompts";
import { liveTransfersAllowedNow } from "./transfer-policy";
import type {
  ReceptionistConfig,
  ReceptionistLanguage,
  SpeakingSpeed,
} from "./types";

type PerLanguage = Record<ReceptionistLanguage, string>;

export type AgentLanguageSelect = {
  /** The language every call starts in (the business default when enabled). */
  startLanguage: ReceptionistLanguage;
  languages: ReceptionistLanguage[];
  /** Seconds the menu waits for a key before staying in the start language. */
  timeoutSeconds: number;
  /** Keypad → language. Only these two keys mean anything. */
  keys: Record<string, ReceptionistLanguage>;
  /** The welcome, then the menu lines, each in the language it must be spoken in. */
  opening: {
    statement: { text: string; lang: ReceptionistLanguage };
    menu: { text: string; lang: ReceptionistLanguage }[];
  };
  /** After the menu closes: an acknowledgement (only if a key was pressed) and the first question. */
  afterChoice: Record<
    ReceptionistLanguage,
    { chosen: string; afterHoursNotice: string; question: string }
  >;
};

export type AgentSilence = {
  /** Seconds of quiet (agent finished speaking) before the first check-in. */
  checkInSeconds: number;
  /** "Are you still there?" is asked this many times before a polite goodbye. */
  maxCheckIns: number;
  checkIn: PerLanguage;
  goodbye: PerLanguage;
};

export type AgentConfig = {
  configId: string;
  businessName: string;
  receptionistName: string | null;
  /** Instructions for the model: the business's prompt plus this call's real capabilities. */
  instructions: string;
  /** Full greetings, kept for agents that predate `languageSelect`. */
  greetings: { fr: string; en: string };
  languageSelect: AgentLanguageSelect;
  silence: AgentSilence;
  speakingSpeed: SpeakingSpeed;
  timezone: string;
  /** True when the owner turned on phone booking; the server still decides each request. */
  bookingEnabled: boolean;
  /** True when the business has an SMS number, so the agent may text the caller on request. */
  callerTexts: boolean;
  afterHours: boolean;
  /** Owner setting: when normal transfers may ring. */
  transferHours: "always" | "business_hours";
  /** Where "talk to a person" goes. Null when no live human is configured. */
  transferE164: string | null;
  /**
   * Second line to try when `transferE164` is busy, unanswered or declines.
   * Same hours rule as `transferE164`. Null when none is configured.
   */
  backupTransferE164: string | null;
  /** Where emergencies go (works after hours). Null when none is configured. */
  emergencyTransferE164: string | null;
  /** Named departments the agent may offer. */
  departments: { name: string; phoneE164: string }[];
  /**
   * The voice to speak with. "standard" (the default, and whenever anything is
   * in doubt) keeps the existing voice; "custom" is a cloned voice the owner
   * consented to, only present for a Receptionist Plus business. The agent
   * falls back to the standard voice if the cloned one cannot be used.
   */
  voice: AgentVoice;
};

/** Roughly what each owner setting means in words per minute, for the model. */
const PACE: Record<SpeakingSpeed, string> = {
  slow: "a little slower than usual (about 135 words a minute)",
  normal: "a comfortable pace (about 150 words a minute)",
  fast: "a brisk but clear pace (about 165 words a minute)",
};

const MAX_FACTS_CHARS = 5_000;
const MAX_FAQS = 20;
const MAX_FAQ_CHARS = 400;

/** Collapse whitespace, drop heading marks and cap a value, so an owner field cannot open its own prompt section. */
function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().replace(/^#+\s*/, "").slice(0, max);
}

/**
 * The owner's approved facts and FAQ answers. The model may only answer policy
 * questions (insurance, licences, warranties, payment, recording...) from these
 * or the business information; without them it says the team will confirm.
 */
export function approvedFactsSection(
  facts: string | undefined,
  faqs: { question?: string; answerFr: string; answerEn: string }[] = [],
): string[] {
  const factLines = (facts ?? "")
    .split("\n")
    .map((line) => oneLine(line, MAX_FACTS_CHARS))
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_FACTS_CHARS);
  const answers = faqs
    .slice(0, MAX_FAQS)
    .map((f) => {
      const question = f.question?.trim() ? oneLine(f.question, MAX_FAQ_CHARS) : "";
      const fr = oneLine(f.answerFr ?? "", MAX_FAQ_CHARS);
      const en = oneLine(f.answerEn ?? "", MAX_FAQ_CHARS);
      if (!fr && !en) return "";
      return `* ${question ? `${question} — ` : ""}FR: ${fr || en} / EN: ${en || fr}`;
    })
    .filter(Boolean);
  if (!factLines && answers.length === 0) return [];
  const section = [
    "# APPROVED FACTS AND ANSWERS (verified by the business; you may share these)",
    "",
  ];
  if (factLines) section.push(factLines);
  if (answers.length > 0) {
    if (factLines) section.push("");
    section.push("Approved answers to common questions:", ...answers);
  }
  section.push("");
  return section;
}

/** Added after the business prompt so it never promises tools the agent lacks. */
export function voiceAgentContext(input: {
  afterHours: boolean;
  canTransfer: boolean;
  canTransferEmergency: boolean;
  departments: string[];
  bookingEnabled?: boolean;
  /** The business has an SMS number: the agent may text the caller on request. */
  callerTexts?: boolean;
  pricingInfo?: string;
  speakingSpeed?: SpeakingSpeed;
  /** The voice is a clone of the owner's: be honest that the caller is talking to a virtual receptionist. */
  customVoice?: boolean;
  /** Owner-approved facts and business rules (insurance, licences, payment, policies...). */
  businessFacts?: string;
  /** Owner-approved answers to common questions. */
  faqs?: { question?: string; answerFr: string; answerEn: string }[];
}): string {
  const lines = [
    ...approvedFactsSection(input.businessFacts, input.faqs),
    "# THIS CALL — WHAT YOU CAN ACTUALLY DO (overrides anything above that says otherwise)",
    "",
    `The office is currently ${input.afterHours ? "CLOSED (after hours)" : "OPEN"}.`,
    `Speak at ${PACE[input.speakingSpeed ?? "normal"]}; slower for phone numbers, addresses, postal codes and times.`,
    "",
    "Your tools: record_details, set_language, end_call" +
      (input.canTransfer || input.canTransferEmergency ? ", transfer_call" : "") +
      (input.bookingEnabled
        ? ", check_availability, book_appointment, find_appointment, move_appointment, cancel_appointment"
        : "") +
      (input.callerTexts ? ", text_caller" : "") +
      (input.callerTexts
        ? ". You have nothing else: no email or other notification system."
        : ". You have nothing else: no messaging, email or notification system."),
    "* record_details: call it quietly, without mentioning it, as soon as you learn the caller's name, callback number, address or city, the service, the project, the preferred time or an email, and again whenever they correct something. What you record is delivered to the team when the call ends.",
    "* set_language: call it when the caller asks for the other language, or clearly talks to you in full sentences of it (an accent, a borrowed word or a name is not enough). Switch at once, without comment, and carry on with the question you were on.",
    "* end_call: call it after you have said goodbye, to hang up: when the request is handled, after a wrong number, or when insults continue after one calm warning. Never hang up while something is still in progress.",
    input.callerTexts
      ? "* text_caller: only when the caller asks for something by text. It texts the number they are calling from with the business's details or one of their appointments, in words the system writes. Say it was sent only when it returns SENT. You cannot email the caller."
      : "* You cannot text or email the caller. Never offer a confirmation text or email.",
    "* Never say you have sent, submitted or scheduled anything yourself. Say you have noted the details and the team will follow up; do not give a callback time.",
  ];
  if (input.customVoice) {
    lines.push(
      "* Your voice was created from a recording of the business owner, with their permission. You are still the business's virtual receptionist: never say or imply that you are the owner or a human. If asked, say you are the virtual receptionist (an AI assistant) and offer to connect the caller with a person.",
    );
  }
  if (input.bookingEnabled) {
    lines.push(
      "* To book: call check_availability, read out ONLY the times it returns, then call book_appointment with the time the caller chose. Say the appointment is booked ONLY when book_appointment returns status confirmed.",
      "* If book_appointment says the time was taken, offer the alternatives it returns. If booking fails or is unavailable, say so honestly and offer to pass the request to the team, who will confirm a time.",
      "* Never invent or guess an opening. If there are none, offer a callback.",
      "* Existing appointments (when is it, move it, cancel it, where is the technician): call find_appointment with the name it is under. It only finds appointments booked under the number the caller is calling from; never reveal anything it did not return. To move one: check_availability with existing_appointment, then move_appointment. To cancel: repeat which one, get a clear yes, then cancel_appointment. Say moved or canceled ONLY when the tool says MOVED or CANCELED.",
      "* There is no live technician tracking: never give an arrival estimate. A late technician: apologize, record a message for the team that the caller is waiting, and offer a transfer if available.",
    );
  } else {
    lines.push(
      "* You have no calendar or booking system. Never say a time is available, booked, confirmed or scheduled. For appointments and quotes, take the caller's preferred time, repeat the details back, and say the team will call back to confirm.",
    );
  }
  lines.push(
    input.pricingInfo
      ? `* Approved pricing wording (say this and nothing more; an exact price needs an estimate): "${input.pricingInfo}"`
      : "* No pricing is approved. Never state, estimate or hint at a price or discount: say it depends on the project and offer an estimate.",
  );
  if (input.canTransfer || input.canTransferEmergency) {
    lines.push(
      '* To connect the caller with a person, you MUST call the transfer_call tool. Saying "I\'ll transfer you" without calling it does nothing and leaves the caller waiting in silence.',
      "* After calling transfer_call, say nothing more. If it returns a failure, tell the caller briefly and offer to take their details for a callback.",
    );
    if (input.afterHours && !input.canTransfer && input.canTransferEmergency) {
      lines.push(
        '* The office is closed: only transfer for an emergency (reason "emergency"). Otherwise take a message.',
      );
    } else if (input.afterHours && input.canTransfer) {
      lines.push(
        "* The office is closed, but live transfers are still allowed on this line. Call transfer_call when the caller asks for a person.",
      );
    }
    if (input.departments.length > 0) {
      lines.push(
        `* Departments you can offer: ${input.departments.join(", ")}.`,
      );
    }
  } else {
    lines.push(
      "* No live transfer is configured. Never offer to transfer; take the caller's details instead.",
    );
  }
  return lines.join("\n");
}

function languageSelectFor(
  config: ReceptionistConfig,
  afterHours: boolean,
): AgentLanguageSelect {
  const start = config.languages.includes(config.defaultLanguage)
    ? config.defaultLanguage
    : firstLanguage(config.languages);
  const bilingual = config.languages.length > 1;
  const forLanguage = (lang: ReceptionistLanguage) => ({
    chosen: phrase(lang === "en" ? "languageChosenEn" : "languageChosenFr", lang),
    afterHoursNotice: afterHours ? afterHoursFor(config, lang) : "",
    question: openingQuestion(config, lang),
  });
  return {
    startLanguage: start,
    languages: [...config.languages],
    timeoutSeconds: languageSelectTimeoutSeconds(),
    keys: { "1": "en", "2": "fr" },
    opening: {
      statement: { text: greetingStatement(config, start), lang: start },
      menu: bilingual ? languageMenuPrompts(start).map((p) => ({ text: p.text, lang: p.lang })) : [],
    },
    afterChoice: { fr: forLanguage("fr"), en: forLanguage("en") },
  };
}

export function buildAgentConfig(
  config: ReceptionistConfig,
  now: Date = new Date(),
  voice: AgentVoice = STANDARD_AGENT_VOICE,
): AgentConfig {
  const afterHours = isAfterHours(config, now);
  const emergency =
    config.emergencyTransferE164 ?? config.fallbackTransferE164 ?? null;
  const general = config.fallbackTransferE164 ?? null;
  const backup =
    general && config.backupTransferE164 && config.backupTransferE164 !== general
      ? config.backupTransferE164
      : null;
  const departments = config.routing.map((r) => ({
    name: r.name,
    phoneE164: r.phoneE164,
  }));
  const bookingEnabled = config.phoneBooking === true;
  const callerTexts = Boolean(config.smsFromE164);
  const speakingSpeed = config.speakingSpeed ?? "normal";

  const base =
    config.systemPrompt?.trim() ||
    `You are the receptionist for ${config.businessName}, a home-services contractor. Be warm, brief and professional. Never invent prices, services or availability.`;

  const transferHours =
    config.transferHours === "always" ? "always" : "business_hours";
  const canTransferNow = liveTransfersAllowedNow(config, afterHours);

  return {
    configId: config.id,
    businessName: config.businessName,
    receptionistName: config.receptionistName ?? null,
    instructions: `${base}\n\n${voiceAgentContext({
      afterHours,
      canTransfer: canTransferNow,
      canTransferEmergency: emergency !== null,
      departments: departments.map((d) => d.name),
      bookingEnabled,
      callerTexts,
      pricingInfo: config.pricingInfo,
      speakingSpeed,
      customVoice: voice.mode === "custom",
      businessFacts: config.businessFacts,
      faqs: config.faqs,
    })}`,
    greetings: {
      fr: config.greetingFr,
      en: config.greetingEn,
    },
    languageSelect: languageSelectFor(config, afterHours),
    silence: {
      checkInSeconds: 8,
      maxCheckIns: 1,
      checkIn: {
        fr: phrase("stillThere", "fr"),
        en: phrase("stillThere", "en"),
      },
      goodbye: {
        fr: phrase("silenceGoodbye", "fr"),
        en: phrase("silenceGoodbye", "en"),
      },
    },
    speakingSpeed,
    timezone: config.timezone,
    bookingEnabled,
    callerTexts,
    afterHours,
    transferHours,
    transferE164: general,
    backupTransferE164: backup,
    emergencyTransferE164: emergency,
    departments,
    voice,
  };
}
