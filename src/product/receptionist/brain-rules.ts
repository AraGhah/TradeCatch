/**
 * Rule brain — deterministic, dynamic receptionist.
 *
 * Works with zero AI credentials and is the automatic fallback whenever the
 * LLM brain times out, errors, or returns something that fails validation.
 *
 * It follows the receptionist workflow as a guide, not a script:
 *   greeting → service check → project scope → caller details → recap → wrap-up,
 * skipping whatever the caller already said ("Hi, I'm John, I need my kitchen
 * painted next Thursday, I'm in Laval" fills name, service, project, date and
 * place in one go) and answering price questions or "are you a robot?" at any
 * point before returning to the question that was pending.
 */

import {
  detectTrades,
  extractCallDetails,
  serviceOffered,
  tradeScopeQuestion,
  type CallDetails,
} from "./call-details";
import {
  asksIfAi,
  asksPrice,
  detectYesNo,
  extractName,
  extractPhoneE164,
  isSmallTalk,
  looksLikeServiceRequest,
  matchesOffTopic,
  matchFaq,
  matchRoutingTarget,
  mentionsAppointment,
  normalizeSpeech,
  speakablePhone,
  wantsHuman,
} from "./nlu";
import { acknowledgement, phrase } from "./prompts";
import { isEligibleRecoveryCaller } from "@/product/missed-call/call-handling";
import type {
  AgentDecision,
  BrainInput,
  CallFlags,
  CallIntent,
  CallOutcome,
  CallSession,
  CallSlots,
  CallStep,
  ReceptionistBrain,
  ReceptionistConfig,
  ReceptionistLanguage,
} from "./types";

/** A reason this long already carries the detail the scope question would ask for. */
const SCOPE_DETAIL_WORDS = 5;
const MAX_RECAP_FIELD_CHARS = 90;

function needsAddress(intent: CallIntent | undefined): boolean {
  return intent === "service_request" || intent === "appointment";
}

function callerNumberUsable(session: CallSession): boolean {
  return isEligibleRecoveryCaller({ callerE164: session.fromE164 }).ok;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function tradeOf(slots: CallSlots) {
  return slots.service ? detectTrades(slots.service).strong[0] : undefined;
}

/** Ask the job-scope question once, and only when the first reason was short. */
function wantsScopeQuestion(
  session: Pick<CallSession, "intent" | "flags">,
  slots: CallSlots,
): boolean {
  if (session.flags?.scopeAsked || slots.project) return false;
  if (!needsAddress(session.intent)) return false;
  const key = tradeOf(slots);
  if (!key || !tradeScopeQuestion(key, "en")) return false;
  return wordCount(slots.issue ?? "") < SCOPE_DETAIL_WORDS;
}

export type NextStepOptions = {
  /** Read the request back before closing. The LLM brain recaps by itself. */
  recap?: boolean;
  /** Ask the one job-scope question. The LLM brain asks its own follow-ups. */
  scope?: boolean;
};

/** First unfilled step for the current intent (shared with the LLM brain). */
export function nextMissingStep(
  config: ReceptionistConfig,
  session: Pick<CallSession, "intent" | "fromE164" | "flags">,
  slots: CallSlots,
  opts: NextStepOptions = {},
): CallStep {
  if (!slots.issue && !slots.message) return "reason";
  if (opts.scope !== false && wantsScopeQuestion(session, slots)) return "scope";
  if (!slots.callerName) return "name";
  if (needsAddress(session.intent) && !slots.serviceAddress) return "address";
  if (!slots.callbackE164) {
    return isEligibleRecoveryCaller({ callerE164: session.fromE164 }).ok
      ? "callback"
      : "callback_number";
  }
  if (
    config.collectPreferredTime &&
    needsAddress(session.intent) &&
    !slots.preferredTime
  ) {
    return "preferred_time";
  }
  // With phone booking on, reading the openings back is the confirmation.
  const bookingFollows = config.phoneBooking === true && session.intent === "appointment";
  if (
    opts.recap !== false &&
    !bookingFollows &&
    needsAddress(session.intent) &&
    !session.flags?.recapped
  ) {
    return "confirm";
  }
  return "anything_else";
}

function clip(text: string, max = MAX_RECAP_FIELD_CHARS): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40))}…`;
}

/** What the caller asked for, in a sentence — built from fields, not echoed. */
export function recapSummary(
  slots: CallSlots,
  language: ReceptionistLanguage,
): string {
  const fr = language === "fr";
  const parts: string[] = [];
  if (slots.service) {
    parts.push(
      fr
        ? `vous cherchez de l'aide pour ${slots.service}${slots.project ? `, plus précisément ${slots.project}` : ""}`
        : `you need ${slots.service}${slots.project ? ` for ${/^\d|^(?:one|two|three|four|five|six|seven|eight)\b/i.test(slots.project) ? "" : "the "}${slots.project}` : ""}`,
    );
  } else if (slots.project) {
    parts.push(
      fr
        ? `vous avez une demande pour ${slots.project}`
        : `you have a request for the ${slots.project}`,
    );
  } else if (slots.issue) {
    parts.push(
      fr
        ? `vous avez mentionné : ${clip(slots.issue)}`
        : `you mentioned: ${clip(slots.issue)}`,
    );
  } else if (slots.message) {
    parts.push(
      fr
        ? `vous voulez laisser ce message : ${clip(slots.message)}`
        : `you'd like to leave this message: ${clip(slots.message)}`,
    );
  }
  if (slots.preferredTime) parts.push(clip(slots.preferredTime, 60));
  const place = slots.serviceAddress ?? slots.location;
  if (place) parts.push(fr ? `à ${clip(place, 80)}` : `at ${clip(place, 80)}`);
  if (slots.callbackE164) {
    parts.push(
      fr
        ? `et on peut vous joindre au ${speakablePhone(slots.callbackE164)}`
        : `and we can reach you at ${speakablePhone(slots.callbackE164)}`,
    );
  }
  return parts.join(", ").replace(/, et /, fr ? ", et " : ", and ");
}

export function questionForStep(
  step: CallStep,
  language: ReceptionistLanguage,
  session: Pick<CallSession, "fromE164">,
  slots: CallSlots,
): string {
  switch (step) {
    case "reason":
      return phrase("askReason", language);
    case "scope": {
      const key = tradeOf(slots);
      return (
        (key && tradeScopeQuestion(key, language)) ||
        phrase("askReason", language)
      );
    }
    case "name":
      return phrase("askName", language);
    case "address":
      return slots.location
        ? phrase("askAddressIn", language, { location: slots.location })
        : phrase("askAddress", language, { name: slots.callerName });
    case "callback":
      return phrase("askCallback", language, {
        phone: speakablePhone(session.fromE164),
      });
    case "callback_number":
      return phrase("askCallbackNumber", language);
    case "preferred_time":
      return phrase("askPreferredTime", language);
    case "confirm":
      return phrase("recap", language, {
        summary: recapSummary(slots, language),
      });
    case "correction":
      return phrase("askCorrection", language);
    default:
      return phrase("anythingElse", language);
  }
}

export function wrapUpOutcome(
  session: Pick<CallSession, "intent" | "outcome">,
  slots: CallSlots,
): CallOutcome {
  if (session.outcome === "emergency_transferred") return session.outcome;
  if (session.intent === "appointment" && slots.preferredTime) {
    return "appointment_requested";
  }
  if (session.intent === "faq" && !slots.issue && !slots.message) {
    return "faq_answered";
  }
  return "message_taken";
}

export function wrapUpReply(
  language: ReceptionistLanguage,
  session: Pick<CallSession, "afterHours">,
  slots: CallSlots,
): string {
  return phrase("wrapUp", language, {
    name: slots.callerName,
    when: phrase(session.afterHours ? "whenOpening" : "whenSoon", language),
  });
}

/* ------------------------------------------------------------------------- */
/* Helpers shared by the steps                                                */
/* ------------------------------------------------------------------------- */

/** Copy what the caller said into empty slots; never overwrite something already confirmed. */
export function mergeCallDetails(slots: CallSlots, details: CallDetails): CallSlots {
  const next = { ...slots };
  if (details.callerName && !next.callerName) next.callerName = details.callerName;
  if (details.service && !next.service) next.service = details.service;
  if (details.project && !next.project) next.project = details.project;
  if (details.preferredTime && !next.preferredTime) {
    next.preferredTime = details.preferredTime;
  }
  if (details.location && !next.location) next.location = details.location;
  if (details.serviceAddress && !next.serviceAddress) {
    next.serviceAddress = withPlace(details.serviceAddress, details.location ?? next.location);
  }
  if (details.email && !next.email) next.email = details.email;
  return next;
}

/** "123 Main Street" + "Laval" → "123 Main Street, Laval" (unless the place is already in it). */
function withPlace(address: string, place: string | undefined): string {
  return place && !normalizeSpeech(address).includes(normalizeSpeech(place))
    ? `${address}, ${place}`
    : address;
}

const PLACE_CONNECTOR = "(?:à|a|in|at|dans)";

/** Swap the city at the end of a street address; keeps everything before it. */
function moveToPlace(address: string, oldPlace: string | undefined, newPlace: string): string {
  const escaped = oldPlace?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trailing = escaped
    ? new RegExp(`(?:,\\s*|\\s+${PLACE_CONNECTOR}\\s+)${escaped}\\s*$`, "iu")
    : new RegExp(
        `\\s+${PLACE_CONNECTOR}\\s+\\p{Lu}[\\p{L}'-]*(?:\\s+\\p{Lu}[\\p{L}'-]*)*\\s*$`,
        "u",
      );
  const street = address.replace(trailing, "").trim();
  return `${street}, ${newPlace}`;
}

function detailsOf(input: BrainInput, text = input.utterance): CallDetails {
  return extractCallDetails(text, input.session.language, {
    serviceAreas: input.config.serviceAreas,
  });
}

function hasAnyDetail(details: CallDetails): boolean {
  return Object.keys(details).some((k) => k !== "tradeKey");
}

function ask(
  input: BrainInput,
  slots: CallSlots,
  intent: CallIntent | undefined,
  prefix?: string,
  flags?: Partial<CallFlags>,
): AgentDecision {
  const sessionView = {
    ...input.session,
    intent: intent ?? input.session.intent,
    flags: { ...input.session.flags, ...flags },
  };
  const next = nextMissingStep(input.config, sessionView, slots);
  if (
    next === "anything_else" &&
    !prefix &&
    input.session.step !== "anything_else"
  ) {
    // Everything collected: confirm and close instead of an open-ended loop.
    return finish(input, slots, intent);
  }
  const question = questionForStep(
    next,
    input.session.language,
    input.session,
    slots,
  );
  const stepFlags: Partial<CallFlags> = { ...flags };
  if (next === "scope") stepFlags.scopeAsked = true;
  if (next === "confirm") stepFlags.recapped = true;
  return {
    reply: prefix ? `${prefix} ${question}` : question,
    action: { type: "ask" },
    nextStep: next,
    slots,
    intent,
    brain: "rules",
    flags: stepFlags,
  };
}

function finish(
  input: BrainInput,
  slots: CallSlots,
  intent: CallIntent | undefined,
  prefix?: string,
): AgentDecision {
  const outcome = wrapUpOutcome(
    { intent: intent ?? input.session.intent, outcome: input.session.outcome },
    slots,
  );
  const closing =
    outcome === "faq_answered"
      ? phrase("goodbye", input.session.language, {
          business: input.config.businessName,
        })
      : wrapUpReply(input.session.language, input.session, slots);
  const reply = prefix ? `${prefix} ${closing}` : closing;
  return {
    reply,
    action: { type: "end_call" },
    nextStep: "done",
    slots,
    intent,
    outcome,
    brain: "rules",
    flags: { recapped: true },
  };
}

/** The answer to a price question: only the owner's approved wording, never a number of our own. */
function priceReply(input: BrainInput): { reply: string; flags: Partial<CallFlags> } {
  const { config, session } = input;
  const lang = session.language;
  if (session.flags?.pricingAsked) {
    return { reply: phrase("priceAgain", lang), flags: { pricingAsked: true } };
  }
  const approved = config.pricingInfo?.trim();
  return {
    reply: approved
      ? phrase("priceConfigured", lang, { price: approved })
      : phrase("priceNoInfo", lang),
    flags: { pricingAsked: true },
  };
}

function identityReply(input: BrainInput): string {
  return phrase("aiIdentity", input.session.language, {
    business: input.config.businessName,
  });
}

/** Re-ask what was pending after a side question, in the same step. */
function resume(
  input: BrainInput,
  prefix: string,
  flags: Partial<CallFlags>,
): AgentDecision {
  const { session } = input;
  const step: CallStep = session.step === "done" ? "anything_else" : session.step;
  return {
    reply: `${prefix} ${questionForStep(step, session.language, session, session.slots)}`,
    action: { type: "ask" },
    nextStep: step,
    brain: "rules",
    flags,
  };
}

const SIDE_QUESTION_STEPS: CallStep[] = [
  "scope",
  "name",
  "address",
  "callback",
  "preferred_time",
  "confirm",
  "correction",
];

/** The utterance is about the business: a job, a price, an appointment, the team, an FAQ. */
function isOnTopic(input: BrainInput): boolean {
  const { config, utterance } = input;
  return (
    detectTrades(utterance).any.length > 0 ||
    looksLikeServiceRequest(utterance) ||
    mentionsAppointment(utterance) ||
    asksPrice(utterance) ||
    asksIfAi(utterance) ||
    wantsHuman(utterance) ||
    Boolean(matchFaq(utterance, config.faqs)) ||
    Boolean(matchRoutingTarget(utterance, config.routing))
  );
}

/**
 * "How are you?" gets a few words back; weather, trivia and jokes get one polite
 * redirect. The third time, the words are simply taken as a message, so the call
 * can never be stuck here and the caller is never hung up on.
 */
function steerBack(input: BrainInput): AgentDecision | null {
  const { session, utterance } = input;
  const lang = session.language;
  if (isOnTopic(input)) return null;
  if (isSmallTalk(utterance)) return resume(input, phrase("smallTalk", lang), {});
  if (!matchesOffTopic(utterance)) return null;
  const count = session.flags?.offTopic ?? 0;
  if (count >= 2) return null;
  return resume(input, phrase("offTopic", lang), { offTopic: count + 1 });
}

/**
 * After hours, a request for a person cannot be met — but whatever job the
 * caller already described is kept, so they are not asked to say it again.
 */
function afterHoursHandoff(
  input: BrainInput,
  slots: CallSlots,
  keepBareRequest: boolean,
): AgentDecision {
  const { session, utterance } = input;
  const lang = session.language;
  const details = detailsOf(input);
  const next = mergeCallDetails(slots, details);
  const describesJob =
    Boolean(details.service || details.project) ||
    looksLikeServiceRequest(utterance) ||
    mentionsAppointment(utterance);
  const detail = utterance.trim().replace(/\s+/g, " ").slice(0, 300);
  let intent: CallIntent = "message";
  if (describesJob) {
    intent = mentionsAppointment(utterance) ? "appointment" : "service_request";
    next.issue = next.issue ? `${next.issue} — ${detail}` : detail;
  } else if (keepBareRequest) {
    next.message = next.message ? `${next.message} — ${detail}` : detail;
  }
  return ask(input, next, intent, phrase("humanAfterHours", lang));
}

/* ------------------------------------------------------------------------- */
/* Steps                                                                      */
/* ------------------------------------------------------------------------- */

function handleReason(input: BrainInput): AgentDecision {
  const { config, session, utterance } = input;
  const lang = session.language;
  let slots: CallSlots = { ...session.slots };

  if (asksIfAi(utterance)) {
    return resume(input, identityReply(input), { identityAnswered: true });
  }

  if (wantsHuman(utterance)) {
    if (!session.afterHours && config.fallbackTransferE164) {
      return {
        reply: phrase("transferring", lang, {
          target: lang === "fr" ? "un membre de l'équipe" : "a team member",
        }),
        action: { type: "transfer", targetId: "fallback" },
        nextStep: "done",
        intent: "transfer",
        brain: "rules",
      };
    }
    return afterHoursHandoff(input, slots, false);
  }

  const target = matchRoutingTarget(utterance, config.routing);
  if (target) {
    if (!session.afterHours) {
      return {
        reply: phrase("transferring", lang, { target: target.name }),
        action: { type: "transfer", targetId: target.id },
        nextStep: "done",
        intent: "transfer",
        brain: "rules",
      };
    }
    return afterHoursHandoff(input, slots, true);
  }

  const faq = matchFaq(utterance, config.faqs);
  if (faq) {
    const answer = lang === "fr" ? faq.answerFr : faq.answerEn;
    return {
      reply: `${answer} ${phrase("anythingElse", lang)}`,
      action: { type: "ask" },
      nextStep: "anything_else",
      intent: session.intent ?? "faq",
      slots,
      brain: "rules",
    };
  }

  const details = detailsOf(input);
  slots = mergeCallDetails(slots, details);
  const priceQuestion = asksPrice(utterance);
  const describesJob =
    Boolean(details.service || details.project) ||
    looksLikeServiceRequest(utterance) ||
    mentionsAppointment(utterance);

  // A service this business does not offer: say so, don't take a request nobody can serve.
  if (describesJob && (config.services?.length ?? 0) > 0) {
    const { offered, requested } = serviceOffered(utterance, config.services!);
    if (!offered && requested) {
      const listed = (config.services ?? []).slice(0, 6).join(", ");
      const label = details.service ?? utterance.trim().slice(0, 40);
      const reply = listed
        ? phrase("serviceNotOfferedList", lang, { service: label, services: listed })
        : phrase("serviceNotOffered", lang, { service: label });
      return {
        reply: `${reply} ${phrase("anythingElse", lang)}`,
        action: { type: "ask" },
        nextStep: "anything_else",
        intent: "faq",
        slots: {},
        brain: "rules",
        flags: { serviceNotOffered: true },
      };
    }
  }

  const intent: CallIntent = mentionsAppointment(utterance)
    ? "appointment"
    : looksLikeServiceRequest(utterance) || details.service
      ? "service_request"
      : "message";

  if (priceQuestion) {
    const price = priceReply(input);
    // Only a question about price, no job described yet: ask about the project.
    if (!describesJob) {
      return {
        reply: `${price.reply} ${phrase("askProject", lang)}`,
        action: { type: "ask" },
        nextStep: "reason",
        slots,
        brain: "rules",
        flags: price.flags,
      };
    }
    slots.issue = slots.issue ? `${slots.issue} — ${utterance}` : utterance;
    return ask(input, slots, intent, price.reply, price.flags);
  }

  const detail = utterance.trim().replace(/\s+/g, " ").slice(0, 300);
  const heard = acknowledgement(lang, session.callerTurnCount);
  if (intent === "message") {
    slots.message = detail;
    return ask(input, slots, intent, heard);
  }
  slots.issue = slots.issue ? `${slots.issue} — ${detail}` : detail;
  return ask(input, slots, intent, heard);
}

function handleAnythingElse(input: BrainInput): AgentDecision {
  const { config, session, utterance } = input;
  const lang = session.language;
  const slots: CallSlots = { ...session.slots };
  const yn = detectYesNo(utterance);
  const count = wordCount(utterance);

  if (yn === "no" && count <= 5) return finish(input, slots, session.intent);
  if (yn === "yes" && count <= 3) {
    return {
      reply: phrase("listening", lang),
      action: { type: "ask" },
      nextStep: "anything_else",
      slots,
      brain: "rules",
    };
  }

  if (asksIfAi(utterance)) {
    return resume(input, identityReply(input), { identityAnswered: true });
  }
  if (asksPrice(utterance) && !matchFaq(utterance, config.faqs)) {
    const price = priceReply(input);
    return resume(input, price.reply, price.flags);
  }

  const faq = matchFaq(utterance, config.faqs);
  if (faq) {
    const answer = lang === "fr" ? faq.answerFr : faq.answerEn;
    return {
      reply: `${answer} ${phrase("anythingElse", lang)}`,
      action: { type: "ask" },
      nextStep: "anything_else",
      slots,
      brain: "rules",
    };
  }

  // A new request after an FAQ: switch into intake mode for it.
  if (!slots.issue && !slots.message) {
    return handleReason({ ...input, session: { ...session, step: "reason" } });
  }

  slots.message = slots.message ? `${slots.message} — ${utterance}` : utterance;
  const next = nextMissingStep(config, session, slots);
  if (next !== "anything_else")
    return ask(input, slots, session.intent, phrase("noted", lang));
  return {
    reply: `${phrase("noted", lang)} ${phrase("anythingElse", lang)}`,
    action: { type: "ask" },
    nextStep: "anything_else",
    slots,
    brain: "rules",
  };
}

/** The recap was read back. "Yes" closes the call; anything else is a correction. */
function handleConfirm(input: BrainInput): AgentDecision {
  const { session, utterance, digits } = input;
  const lang = session.language;
  let slots: CallSlots = { ...session.slots };
  const yn = detectYesNo(utterance);
  const details = detailsOf(input);
  const phone = extractPhoneE164(utterance, digits);
  const corrected = hasAnyDetail(details) || Boolean(phone);

  if (yn === "yes" && !corrected) return finish(input, slots, session.intent);

  if (corrected) {
    const before = slots;
    slots = applyCorrection(slots, details, phone);
    return finish(input, slots, session.intent, correctionNotice(before, slots, lang));
  }
  if (yn === "no") {
    return {
      reply: phrase("askCorrection", lang),
      action: { type: "ask" },
      nextStep: "correction",
      slots,
      brain: "rules",
    };
  }
  // Neither a clear yes nor anything recognisable: keep their words for the team.
  slots.message = slots.message ? `${slots.message} — ${utterance}` : utterance;
  return finish(input, slots, session.intent);
}

/** A correction replaces what was captured, unlike the first pass which only fills gaps. */
function applyCorrection(
  slots: CallSlots,
  details: CallDetails,
  phone: string | null,
): CallSlots {
  const next = { ...slots };
  if (details.callerName) next.callerName = details.callerName;
  if (details.service) next.service = details.service;
  if (details.project) next.project = details.project;
  if (details.preferredTime) next.preferredTime = details.preferredTime;
  if (details.serviceAddress) {
    // A new street address replaces the old one outright.
    next.serviceAddress = withPlace(details.serviceAddress, details.location ?? next.location);
    if (details.location) next.location = details.location;
  } else if (details.location) {
    // The street stays, the place changes: "45 rue Principale à Laval" → "45 rue Principale, Montréal".
    if (next.serviceAddress) {
      next.serviceAddress = moveToPlace(next.serviceAddress, next.location, details.location);
    }
    next.location = details.location;
  }
  if (details.email) next.email = details.email;
  if (phone) next.callbackE164 = phone;
  return next;
}

function handleCorrection(input: BrainInput): AgentDecision {
  const { session, utterance, digits } = input;
  const lang = session.language;
  let slots: CallSlots = { ...session.slots };
  // "What should I correct?" — "yes, that's fine": nothing to change.
  if (detectYesNo(utterance) === "yes" && wordCount(utterance) <= 3) {
    return finish(input, slots, session.intent);
  }
  const details = detailsOf(input);
  const phone = extractPhoneE164(utterance, digits);
  const name = !details.callerName && wordCount(utterance) <= 4 ? extractName(utterance) : null;
  // A bare street address is the usual answer to "what should I correct?".
  const bareAddress =
    !details.serviceAddress && !hasAnyDetail(details) && !phone && !name && /^\d{1,5}\s+\p{L}/u.test(utterance.trim())
      ? utterance.trim().slice(0, 120)
      : undefined;
  if (hasAnyDetail(details) || phone || name || bareAddress) {
    const before = slots;
    slots = applyCorrection(
      slots,
      {
        ...details,
        callerName: details.callerName ?? name ?? undefined,
        serviceAddress: details.serviceAddress ?? bareAddress,
      },
      phone,
    );
    return finish(input, slots, session.intent, correctionNotice(before, slots, lang));
  }
  slots.message = slots.message
    ? `${slots.message} — correction: ${utterance}`
    : `correction: ${utterance}`;
  return finish(input, slots, session.intent);
}

/** "Got it, I've updated that: 45 rue Principale." — said so the caller can hear the fix landed. */
function correctionNotice(
  before: CallSlots,
  after: CallSlots,
  language: ReceptionistLanguage,
): string {
  const changed: string[] = [];
  const show = (value: string | undefined) => (value ? clip(value, 60) : "");
  if (after.callerName !== before.callerName) changed.push(show(after.callerName));
  if (after.serviceAddress !== before.serviceAddress) changed.push(show(after.serviceAddress));
  if (after.callbackE164 !== before.callbackE164 && after.callbackE164) {
    changed.push(speakablePhone(after.callbackE164));
  }
  if (after.preferredTime !== before.preferredTime) changed.push(show(after.preferredTime));
  const what = changed.filter(Boolean).slice(0, 2).join(", ");
  return what ? phrase("correctedWith", language, { what }) : phrase("corrected", language);
}

export function createRuleBrain(): ReceptionistBrain {
  return {
    async decide(input) {
      const { session, utterance, digits } = input;
      const lang = session.language;
      let slots: CallSlots = { ...session.slots };

      // Chit-chat and trivia: one polite redirect, then the pending question.
      if (
        session.step === "reason" ||
        session.step === "anything_else" ||
        SIDE_QUESTION_STEPS.includes(session.step)
      ) {
        const steered = steerBack(input);
        if (steered) return steered;
      }

      // Side questions at any step: answer, then return to the pending question.
      if (SIDE_QUESTION_STEPS.includes(session.step)) {
        if (asksIfAi(utterance)) {
          return resume(input, identityReply(input), { identityAnswered: true });
        }
        if (asksPrice(utterance)) {
          const price = priceReply(input);
          return resume(input, price.reply, price.flags);
        }
      }

      switch (session.step) {
        case "reason":
          return handleReason(input);

        case "scope": {
          const details = detailsOf(input);
          slots = mergeCallDetails(slots, details);
          if (!details.project) {
            slots.issue = slots.issue ? `${slots.issue} — ${utterance}` : utterance;
          }
          return ask(input, slots, session.intent);
        }

        case "name": {
          slots = mergeCallDetails(slots, detailsOf(input));
          const name = extractName(utterance);
          if (!name) {
            const retries = session.flags?.nameRetries ?? 0;
            if (retries >= 1) {
              // Asked twice: don't hold the call hostage to a name. The team sees it was not given.
              slots.callerName = phrase("noNameGiven", lang);
              return ask(input, slots, session.intent, acknowledgement(lang, session.callerTurnCount));
            }
            return {
              reply: `${phrase("unclear", lang)} ${questionForStep("name", lang, session, slots)}`,
              action: { type: "ask" },
              nextStep: "name",
              slots,
              brain: "rules",
              flags: { nameRetries: retries + 1 },
            };
          }
          slots.callerName = name;
          return ask(input, slots, session.intent, acknowledgement(lang, session.callerTurnCount));
        }

        case "address": {
          const details = detailsOf(input);
          slots = mergeCallDetails(slots, details);
          const said = utterance.trim().slice(0, 300);
          const place = slots.location;
          slots.serviceAddress =
            place && !normalizeSpeech(said).includes(normalizeSpeech(place))
              ? `${said}, ${place}`
              : said;
          return ask(input, slots, session.intent);
        }

        case "callback": {
          const spoken = extractPhoneE164(utterance, digits);
          if (spoken) {
            slots.callbackE164 = spoken;
            return ask(input, slots, session.intent);
          }
          const yn = detectYesNo(utterance);
          if (yn === "yes" && callerNumberUsable(session)) {
            slots.callbackE164 = session.fromE164;
            return ask(input, slots, session.intent);
          }
          if (yn === "no" || !callerNumberUsable(session)) {
            return {
              reply: phrase("askCallbackNumber", lang),
              action: { type: "ask" },
              nextStep: "callback_number",
              slots,
              brain: "rules",
            };
          }
          return {
            reply: questionForStep("callback", lang, session, slots),
            action: { type: "ask" },
            nextStep: "callback",
            brain: "rules",
          };
        }

        case "callback_number": {
          const phone = extractPhoneE164(utterance, digits);
          if (phone) {
            slots.callbackE164 = phone;
            return ask(input, slots, session.intent);
          }
          // Keep what was said so a human can still read it back.
          slots.message = slots.message
            ? `${slots.message} — callback: ${utterance}`
            : `callback: ${utterance}`;
          if (callerNumberUsable(session))
            slots.callbackE164 = session.fromE164;
          else slots.callbackE164 = undefined;
          if (!slots.callbackE164) return finish(input, slots, session.intent);
          return ask(input, slots, session.intent);
        }

        case "preferred_time":
          slots.preferredTime = utterance.trim().slice(0, 200);
          return ask(input, slots, session.intent);

        case "confirm":
          return handleConfirm(input);

        case "correction":
          return handleCorrection(input);

        case "anything_else":
          return handleAnythingElse(input);

        default:
          return finish(input, slots, session.intent);
      }
    },
  };
}
