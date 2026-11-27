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
import { receptionistNameOrDefault } from "./persona";
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
  /**
   * The French-first welcome and keypad menu of the earlier agent, and the
   * Twilio engine's. Agents that detect the language from speech ignore this and
   * `keys`/`timeoutSeconds`, and use `detection`. Kept so an agent deployed before
   * `detection` existed keeps working while the new one rolls out.
   */
  opening: {
    statement: { text: string; lang: ReceptionistLanguage };
    menu: { text: string; lang: ReceptionistLanguage }[];
  };
  /**
   * Automatic spoken-language detection: no keypad. `opening` is said once at
   * pickup, each line in its own voice; `ask` is said once if the caller's language
   * is still unclear after two utterances. A line with one language has no `ask`.
   */
  detection: {
    opening: { text: string; lang: ReceptionistLanguage }[];
    ask: { text: string; lang: ReceptionistLanguage }[];
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
  /** The business's own name for her, else "Lucie" (persona.ts). Never empty. */
  receptionistName: string;
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
  /**
   * How long a transfer rings before the agent gives up, from the owner's
   * transfer timeout. Null = the agent's own default. The agent clamps it.
   */
  transferRingSeconds: number | null;
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
  /** The language the owner reads the saved record in (the business's default). */
  recordLanguage?: ReceptionistLanguage;
  /** The owner's tone and personality (communication style + free text). */
  personality?: string;
  /** What the owner wants when a transfer is not answered. */
  failedTransferAction?: "take_message" | "urgent_lead" | "voicemail";
  /** False when the owner does not want callers asked for a day and time. */
  askPreferredTime?: boolean;
}): string {
  const askTime = input.askPreferredTime !== false;
  const lines = [
    ...personalitySection(input.personality),
    ...approvedFactsSection(input.businessFacts, input.faqs),
    "# THIS CALL — WHAT YOU CAN ACTUALLY DO (overrides anything above that says otherwise)",
    "",
    `The office is currently ${input.afterHours ? "CLOSED (after hours)" : "OPEN"}.`,
    `Speak at ${PACE[input.speakingSpeed ?? "normal"]}; slower for phone numbers, addresses, postal codes and times.`,
    "",
    "Your tools: record_details, set_language, end_call" +
      (input.canTransfer || input.canTransferEmergency
        ? ", transfer_to_human, transfer_emergency"
        : "") +
      (input.bookingEnabled
        ? ", check_availability, book_appointment, find_appointment, move_appointment, cancel_appointment"
        : "") +
      (input.callerTexts ? ", text_caller" : "") +
      (input.callerTexts
        ? ". You have nothing else: no email or other notification system."
        : ". You have nothing else: no messaging, email or notification system."),
    "* record_details: call it quietly, without mentioning it, to save the caller's name, callback number, address or city, the service, the project, the preferred time or an email. Each call makes the caller wait, so save in batches (the name and number together, then the address and service together), not after every answer; save again whenever they correct something, and save whatever is still unsaved before you say goodbye. What you record is delivered to the team when the call ends.",
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
      '* To connect the caller with a person, you MUST call the transfer_to_human tool (transfer_emergency for an emergency). Saying "I\'ll transfer you" without calling it does nothing and leaves the caller waiting in silence.',
      "* The transfer tools speak the transfer announcement themselves and only ring the business's own lines: never say or ask for a number to transfer to, and 911 is never a transfer destination.",
      "* After calling a transfer tool, say nothing more. If it returns a failure, the caller is still with you: never hang up. Tell them briefly and offer to take their details for a callback.",
      FAILED_TRANSFER_RULE[input.failedTransferAction ?? "take_message"],
    );
    if (input.afterHours && !input.canTransfer && input.canTransferEmergency) {
      lines.push(
        "* The office is closed: only transfer for an emergency (call transfer_emergency). Otherwise take a message.",
      );
    } else if (input.afterHours && input.canTransfer) {
      lines.push(
        "* The office is closed, but live transfers are still allowed on this line. Call transfer_to_human when the caller asks for a person.",
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
  lines.push(
    "",
    "# TAKING A REQUEST (overrides any shorter checklist above)",
    "",
    "Every request for work, a quote or a visit must leave the team with what they need to act. Before you wrap up, ask for each of these, one question at a time, and save them with record_details:",
    "1. The problem, described clearly: what is wrong or what is wanted, where in the home, since when, and anything urgent. Keep asking short follow-up questions until you could explain it to a technician in two sentences. Save it as reason, in your own words, one or two full sentences (never a single word, never the caller's filler).",
    "2. Their name and a callback number (confirm the number they are calling from instead of asking for it).",
    "3. The street address of the work: number, street and city. A city or neighbourhood alone is not enough; ask for the rest (the postal code only if they offer it).",
    !askTime
      ? "4. The appointment. The business does not want callers asked for a day or time: do not ask. If the caller offers one, save it as preferred_time" +
          (input.bookingEnabled ? " (or book it if they ask to book, following the steps above)" : "") +
          ", and say the team will call to arrange the visit."
      : input.bookingEnabled
        ? "4. The appointment. Always offer one, even if they did not ask: ask which day and time of day suit them, then follow the booking steps above."
        : "4. The appointment. Always ask, even if they did not mention one: which day and time of day suit them, saved as preferred_time. Say the team will call to confirm the time; never say it is booked.",
    "5. Read back the problem, the address and the time in one or two sentences and ask if that is right. Save any correction, then say goodbye.",
    "An emergency skips the name and the appointment: safety first, then the address and a callback number. A wrong number or a transfer needs none of this.",
    "",
    "# AFTER YOU ANSWER A QUESTION (overrides any shorter checklist above)",
    "",
    "Answering is never the end of the call. When the caller asks a question (hours, service area, prices, insurance, how it works), answer it from the verified information, then ask one short, relevant follow-up question in that same reply:",
    "* If you do not yet know what they need, ask what they need help with, or whether they would like a visit or an estimate.",
    "* If they already described a need, ask for the next item still missing from the list above.",
    "* If you could not answer, say the team will confirm, then ask the same follow-up.",
    "Never end a reply with only the answer, and never go quiet after it. Say goodbye only when the caller clearly says they need nothing else, or it was a wrong number or a transfer. If they decline the follow-up, answer anything else they ask, then wrap up.",
  );
  return lines.join("\n");
}

/** What to do after an unanswered or failed transfer, per the owner's setting. */
const FAILED_TRANSFER_RULE: Record<
  "take_message" | "urgent_lead" | "voicemail",
  string
> = {
  take_message:
    "* When a transfer is not answered: take a message (name, number, reason) for the team.",
  urgent_lead:
    "* When a transfer is not answered: take the caller's name, number and reason, save it with record_details marked as urgent (emergency only if it really is one), and say the team will see it as a priority.",
  voicemail:
    "* When a transfer is not answered: offer to take a detailed message for the team, in the caller's own words, and save it as message.",
};

const MAX_PERSONALITY_CHARS = 800;

/** The owner's tone, ahead of the facts. Never overrides the rules below it. */
function personalitySection(personality: string | undefined): string[] {
  const text = personality?.trim().slice(0, MAX_PERSONALITY_CHARS);
  if (!text) return [];
  return [
    "# HOW THIS BUSINESS WANTS YOU TO SOUND",
    "",
    `The owner describes the tone they want: "${text}". Follow it in how you speak; it never changes the rules or what you are allowed to do.`,
    "",
  ];
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
    detection: {
      opening: bilingual
        ? [
            {
              text: phrase("bilingualWelcome", "fr", {
                name: receptionistNameOrDefault(config.receptionistName),
                business: config.businessName,
              }),
              lang: "fr",
            },
            { text: phrase("bilingualQuestion", "en"), lang: "en" },
          ]
        : [
            { text: greetingStatement(config, start), lang: start },
            { text: openingQuestion(config, start), lang: start },
          ],
      ask: bilingual
        ? [
            { text: phrase("askLanguageFr", "fr"), lang: "fr" },
            { text: phrase("askLanguageEn", "en"), lang: "en" },
          ]
        : [],
    },
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
    receptionistName: receptionistNameOrDefault(config.receptionistName),
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
      recordLanguage: config.defaultLanguage,
      personality: config.personality,
      failedTransferAction: config.failedTransferAction,
      askPreferredTime: config.collectPreferredTime,
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
    transferRingSeconds: config.transferTimeoutSeconds ?? null,
  };
}
