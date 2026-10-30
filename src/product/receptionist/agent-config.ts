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
import type {
  ReceptionistConfig,
  ReceptionistLanguage,
  SpeakingSpeed,
} from "./types";

type PerLanguage = Record<ReceptionistLanguage, string>;

export type AgentLanguageSelect = {
  /** The language every call starts in (French whenever it is enabled). */
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
  afterHours: boolean;
  /** Where "talk to a person" goes. Null when no live human is configured. */
  transferE164: string | null;
  /** Where emergencies go (works after hours). Null when none is configured. */
  emergencyTransferE164: string | null;
  /** Named departments the agent may offer. */
  departments: { name: string; phoneE164: string }[];
};

/** Roughly what each owner setting means in words per minute, for the model. */
const PACE: Record<SpeakingSpeed, string> = {
  slow: "a little slower than usual (about 135 words a minute)",
  normal: "a comfortable pace (about 150 words a minute)",
  fast: "a brisk but clear pace (about 165 words a minute)",
};

/** Added after the business prompt so it never promises tools the agent lacks. */
export function voiceAgentContext(input: {
  afterHours: boolean;
  canTransfer: boolean;
  canTransferEmergency: boolean;
  departments: string[];
  bookingEnabled?: boolean;
  pricingInfo?: string;
  speakingSpeed?: SpeakingSpeed;
}): string {
  const lines = [
    "# THIS CALL — WHAT YOU CAN ACTUALLY DO (overrides anything above that says otherwise)",
    "",
    `The office is currently ${input.afterHours ? "CLOSED (after hours)" : "OPEN"}.`,
    `Speak at ${PACE[input.speakingSpeed ?? "normal"]}; slower for phone numbers, addresses, postal codes and times.`,
    "",
    "Your tools: record_details, set_language, end_call" +
      (input.canTransfer || input.canTransferEmergency ? ", transfer_call" : "") +
      (input.bookingEnabled ? ", check_availability, book_appointment" : "") +
      ". You have nothing else: no messaging, email or notification system.",
    "* record_details: call it quietly, without mentioning it, as soon as you learn the caller's name, callback number, address or city, the service, the project, the preferred time or an email, and again whenever they correct something. What you record is delivered to the team when the call ends.",
    "* set_language: call it only when the caller clearly asks to continue in the other language. Switch at once, without comment, and carry on with the question you were on.",
    "* end_call: call it after you have said goodbye, to hang up. Never hang up while something is still in progress.",
    "* You cannot text or email the caller. Never offer a confirmation text or email.",
    "* Never say you have sent, submitted or scheduled anything yourself. Say you have noted the details and the team will follow up; do not give a callback time.",
  ];
  if (input.bookingEnabled) {
    lines.push(
      "* To book: call check_availability, read out ONLY the times it returns, then call book_appointment with the time the caller chose. Say the appointment is booked ONLY when book_appointment returns status confirmed.",
      "* If book_appointment says the time was taken, offer the alternatives it returns. If booking fails or is unavailable, say so honestly and offer to pass the request to the team, who will confirm a time.",
      "* Never invent or guess an opening. If there are none, offer a callback.",
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
    if (input.afterHours) {
      lines.push(
        '* The office is closed: only transfer for an emergency (reason "emergency"). Otherwise take a message.',
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
  const start = firstLanguage(config.languages, config.defaultLanguage);
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
      menu: bilingual ? languageMenuPrompts().map((p) => ({ text: p.text, lang: p.lang })) : [],
    },
    afterChoice: { fr: forLanguage("fr"), en: forLanguage("en") },
  };
}

export function buildAgentConfig(
  config: ReceptionistConfig,
  now: Date = new Date(),
): AgentConfig {
  const afterHours = isAfterHours(config, now);
  const emergency =
    config.emergencyTransferE164 ?? config.fallbackTransferE164 ?? null;
  const general = config.fallbackTransferE164 ?? null;
  const departments = config.routing.map((r) => ({
    name: r.name,
    phoneE164: r.phoneE164,
  }));
  const bookingEnabled = config.phoneBooking === true;
  const speakingSpeed = config.speakingSpeed ?? "normal";

  const base =
    config.systemPrompt?.trim() ||
    `You are the receptionist for ${config.businessName}, a home-services contractor. Be warm, brief and professional. Never invent prices, services or availability.`;

  return {
    configId: config.id,
    businessName: config.businessName,
    receptionistName: config.receptionistName ?? null,
    instructions: `${base}\n\n${voiceAgentContext({
      afterHours,
      canTransfer: general !== null || departments.length > 0,
      canTransferEmergency: emergency !== null,
      departments: departments.map((d) => d.name),
      bookingEnabled,
      pricingInfo: config.pricingInfo,
      speakingSpeed,
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
    afterHours,
    transferE164: general,
    emergencyTransferE164: emergency,
    departments,
  };
}
