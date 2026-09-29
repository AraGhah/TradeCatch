/**
 * Rule brain — deterministic slot-filling receptionist.
 *
 * Works with zero AI credentials and is the automatic fallback whenever the
 * LLM brain times out, errors, or returns something that fails validation.
 */

import {
  detectYesNo,
  extractName,
  extractPhoneE164,
  matchFaq,
  matchRoutingTarget,
  mentionsAppointment,
  speakablePhone,
  wantsHuman,
} from "./nlu";
import { phrase } from "./prompts";
import { isEligibleRecoveryCaller } from "@/product/missed-call/call-handling";
import type {
  AgentDecision,
  BrainInput,
  CallIntent,
  CallOutcome,
  CallSession,
  CallSlots,
  CallStep,
  ReceptionistBrain,
  ReceptionistConfig,
  ReceptionistLanguage,
} from "./types";

function needsAddress(intent: CallIntent | undefined): boolean {
  return intent === "service_request" || intent === "appointment";
}

function callerNumberUsable(session: CallSession): boolean {
  return isEligibleRecoveryCaller({ callerE164: session.fromE164 }).ok;
}

/** First unfilled step for the current intent (shared with the LLM brain). */
export function nextMissingStep(
  config: ReceptionistConfig,
  session: Pick<CallSession, "intent" | "fromE164">,
  slots: CallSlots,
): CallStep {
  if (!slots.issue && !slots.message) return "reason";
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
  return "anything_else";
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
    case "name":
      return phrase("askName", language);
    case "address":
      return phrase("askAddress", language, { name: slots.callerName });
    case "callback":
      return phrase("askCallback", language, {
        phone: speakablePhone(session.fromE164),
      });
    case "callback_number":
      return phrase("askCallbackNumber", language);
    case "preferred_time":
      return phrase("askPreferredTime", language);
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

function ask(
  input: BrainInput,
  slots: CallSlots,
  intent: CallIntent | undefined,
  prefix?: string,
): AgentDecision {
  const sessionView = {
    ...input.session,
    intent: intent ?? input.session.intent,
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
  return {
    reply: prefix ? `${prefix} ${question}` : question,
    action: { type: "ask" },
    nextStep: next,
    slots,
    intent,
    brain: "rules",
  };
}

function finish(
  input: BrainInput,
  slots: CallSlots,
  intent: CallIntent | undefined,
): AgentDecision {
  const outcome = wrapUpOutcome(
    { intent: intent ?? input.session.intent, outcome: input.session.outcome },
    slots,
  );
  const reply =
    outcome === "faq_answered"
      ? phrase("goodbye", input.session.language, {
          business: input.config.businessName,
        })
      : wrapUpReply(input.session.language, input.session, slots);
  return {
    reply,
    action: { type: "end_call" },
    nextStep: "done",
    slots,
    intent,
    outcome,
    brain: "rules",
  };
}

function handleReason(input: BrainInput): AgentDecision {
  const { config, session, utterance } = input;
  const lang = session.language;
  const slots: CallSlots = { ...session.slots };

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
    return ask(input, slots, "message", phrase("humanAfterHours", lang));
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
    slots.message = utterance;
    return ask(input, slots, "message", phrase("humanAfterHours", lang));
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

  const intent: CallIntent = mentionsAppointment(utterance)
    ? "appointment"
    : "service_request";
  slots.issue = slots.issue ? `${slots.issue} — ${utterance}` : utterance;
  return ask(input, slots, intent);
}

function handleAnythingElse(input: BrainInput): AgentDecision {
  const { config, session, utterance } = input;
  const lang = session.language;
  const slots: CallSlots = { ...session.slots };
  const yn = detectYesNo(utterance);
  const wordCount = utterance.trim().split(/\s+/).filter(Boolean).length;

  if (yn === "no" && wordCount <= 5)
    return finish(input, slots, session.intent);
  if (yn === "yes" && wordCount <= 3) {
    return {
      reply: phrase("listening", lang),
      action: { type: "ask" },
      nextStep: "anything_else",
      slots,
      brain: "rules",
    };
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

export function createRuleBrain(): ReceptionistBrain {
  return {
    async decide(input) {
      const { session, utterance, digits } = input;
      const lang = session.language;
      const slots: CallSlots = { ...session.slots };

      switch (session.step) {
        case "reason":
          return handleReason(input);

        case "name": {
          const name = extractName(utterance);
          if (!name) {
            return {
              reply: phrase("reprompt", lang),
              action: { type: "ask" },
              nextStep: "name",
              brain: "rules",
            };
          }
          slots.callerName = name;
          return ask(input, slots, session.intent);
        }

        case "address":
          slots.serviceAddress = utterance.trim().slice(0, 300);
          return ask(input, slots, session.intent);

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
          return finish(input, slots, session.intent);

        case "anything_else":
          return handleAnythingElse(input);

        default:
          return finish(input, slots, session.intent);
      }
    },
  };
}
