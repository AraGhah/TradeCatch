/**
 * LLM brain — natural conversation with hard guardrails.
 *
 * The model proposes { reply, action, slots, intent }; TradeCatch decides.
 * - Output is Zod-validated; any failure falls back to the rule brain.
 * - Transfers only to configured routing ids (or "fallback"), never after hours.
 * - Emergencies never reach this brain: the engine intercepts them first.
 * - Replies are length-capped for the phone.
 */

import { z } from "zod";
import {
  createRuleBrain,
  nextMissingStep,
  questionForStep,
  wrapUpOutcome,
} from "./brain-rules";
import type { LlmClient } from "./llm";
import type {
  AgentDecision,
  BrainInput,
  CallSlots,
  ReceptionistBrain,
} from "./types";

const MAX_REPLY_CHARS = 420;

const decisionSchema = z.object({
  reply: z.string().min(1).max(1200),
  action: z.enum(["ask", "transfer", "end_call"]),
  transferTargetId: z.string().optional().nullable(),
  intent: z
    .enum([
      "service_request",
      "appointment",
      "faq",
      "transfer",
      "message",
      "other",
    ])
    .optional()
    .nullable(),
  slots: z
    .object({
      callerName: z.string().max(80).optional().nullable(),
      serviceAddress: z.string().max(300).optional().nullable(),
      issue: z.string().max(600).optional().nullable(),
      callbackE164: z.string().max(20).optional().nullable(),
      preferredTime: z.string().max(200).optional().nullable(),
      message: z.string().max(600).optional().nullable(),
    })
    .partial()
    .optional()
    .nullable(),
});

/** JSON Schema handed to the model (kept in sync with decisionSchema). */
export const DECISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "action"],
  properties: {
    reply: {
      type: "string",
      description:
        "What the receptionist says next. 1–2 short spoken sentences, in the caller's language.",
    },
    action: {
      type: "string",
      enum: ["ask", "transfer", "end_call"],
      description:
        "ask = keep the conversation going; transfer = bridge to a routing target; end_call = say goodbye and hang up.",
    },
    transferTargetId: {
      type: "string",
      description:
        "Required when action=transfer. One of the routing ids, or 'fallback' for a general team member.",
    },
    intent: {
      type: "string",
      enum: [
        "service_request",
        "appointment",
        "faq",
        "transfer",
        "message",
        "other",
      ],
    },
    slots: {
      type: "object",
      description:
        "Only facts the caller actually stated. Omit unknown fields.",
      properties: {
        callerName: { type: "string" },
        serviceAddress: { type: "string" },
        issue: {
          type: "string",
          description: "The caller's problem in their own words.",
        },
        callbackE164: {
          type: "string",
          description: "E.164, e.g. +15145551234",
        },
        preferredTime: { type: "string" },
        message: { type: "string" },
      },
    },
  },
} as const;

function clean(value: string | null | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

export function buildSystemPrompt(input: BrainInput): string {
  const { config, session } = input;
  const lang =
    session.language === "fr" ? "Canadian French (Québec)" : "English";
  const routing =
    config.routing.length > 0
      ? config.routing
          .map(
            (r) =>
              `- id "${r.id}": ${r.name}${r.description ? ` — ${r.description}` : ""}`,
          )
          .join("\n")
      : "- (no departments configured)";
  const faqs =
    config.faqs.length > 0
      ? config.faqs
          .map(
            (f) =>
              `- ${f.question ?? f.keywords.join(", ")}: ${session.language === "fr" ? f.answerFr : f.answerEn}`,
          )
          .join("\n")
      : "- (none)";

  return [
    `You are the phone receptionist for ${config.businessName}, a home-services contractor. Speak ${lang}.`,
    config.personality
      ? `Personality: ${config.personality}`
      : "Be warm, brief and professional.",
    config.businessFacts
      ? `Business facts you may share:\n${config.businessFacts}`
      : "",
    `Office status right now: ${session.afterHours ? "CLOSED (after hours) — do not transfer; take the request for a callback when the office opens." : "OPEN — transfers are allowed."}`,
    `Departments you can transfer to:\n${routing}${config.fallbackTransferE164 ? '\n- id "fallback": a general team member' : ""}`,
    `Approved FAQ answers (use only these for factual questions):\n${faqs}`,
    [
      "Your job: understand the request, then collect in order: the caller's name, the service address (for service/appointment requests), confirm a callback number, and (for service/appointment) a preferred time window.",
      "Ask ONE question at a time. Keep every reply under 2 short sentences — this is a phone call.",
      "Never diagnose a problem, give repair or safety instructions, quote prices, or promise an arrival time or a booked slot. Say the team will confirm.",
      "Never invent facts that are not in the business facts or FAQ; offer a callback instead.",
      "If the caller asks for a person or a department and the office is open, use action=transfer.",
      "When everything is collected, thank the caller by name, say the team will call back, and use action=end_call.",
      "Put only facts the caller actually said in slots.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildUserPrompt(input: BrainInput, missing: string): string {
  const { session, utterance } = input;
  const transcript = session.turns
    .filter((t) => t.speaker !== "system")
    .slice(-16)
    .map(
      (t) => `${t.speaker === "agent" ? "Receptionist" : "Caller"}: ${t.text}`,
    )
    .join("\n");
  return [
    `Caller ID: ${session.fromE164}`,
    `Collected so far: ${JSON.stringify(session.slots)}`,
    `Next missing item: ${missing}`,
    `Transcript:\n${transcript || "(none)"}`,
    `Caller just said: "${utterance}"`,
  ].join("\n\n");
}

export function createLlmBrain(
  llm: LlmClient,
  fallback: ReceptionistBrain = createRuleBrain(),
): ReceptionistBrain {
  return {
    async decide(input): Promise<AgentDecision> {
      const { config, session } = input;
      try {
        const missing = nextMissingStep(config, session, session.slots);
        const raw = await llm.generateJson({
          system: buildSystemPrompt(input),
          user: buildUserPrompt(input, missing),
          schema: DECISION_JSON_SCHEMA as unknown as Record<string, unknown>,
        });
        const parsed = decisionSchema.parse(raw);

        const slots: CallSlots = { ...session.slots };
        const s = parsed.slots ?? {};
        const merge = (k: keyof CallSlots, v: string | null | undefined) => {
          const c = clean(v);
          if (c) slots[k] = c;
        };
        merge("callerName", s.callerName);
        merge("serviceAddress", s.serviceAddress);
        merge("issue", s.issue);
        merge("preferredTime", s.preferredTime);
        merge("message", s.message);
        const cb = clean(s.callbackE164);
        if (cb && /^\+[1-9]\d{9,14}$/.test(cb)) slots.callbackE164 = cb;

        const intent = parsed.intent ?? session.intent;
        let reply = parsed.reply.trim();
        if (reply.length > MAX_REPLY_CHARS) {
          const cut = reply.slice(0, MAX_REPLY_CHARS);
          reply =
            cut.slice(
              0,
              Math.max(cut.lastIndexOf("."), cut.lastIndexOf("?")) + 1,
            ) || cut;
        }

        if (parsed.action === "transfer") {
          const targetId = parsed.transferTargetId ?? "";
          const known =
            config.routing.some((r) => r.id === targetId) ||
            (targetId === "fallback" && Boolean(config.fallbackTransferE164));
          if (known && !session.afterHours) {
            return {
              reply,
              action: { type: "transfer", targetId },
              nextStep: "done",
              slots,
              intent: "transfer",
              brain: "llm",
            };
          }
          // Guardrail: invalid / after-hours transfer → keep collecting.
          const next = nextMissingStep(config, { ...session, intent }, slots);
          return {
            reply: questionForStep(next, session.language, session, slots),
            action: { type: "ask" },
            nextStep: next,
            slots,
            intent: intent ?? "message",
            brain: "guardrail",
          };
        }

        if (parsed.action === "end_call") {
          return {
            reply,
            action: { type: "end_call" },
            nextStep: "done",
            slots,
            intent,
            outcome: wrapUpOutcome({ intent, outcome: session.outcome }, slots),
            brain: "llm",
          };
        }

        return {
          reply,
          action: { type: "ask" },
          nextStep: nextMissingStep(config, { ...session, intent }, slots),
          slots,
          intent,
          brain: "llm",
        };
      } catch (err) {
        console.warn("[receptionist] LLM brain failed — rule fallback", {
          provider: llm.provider,
          error: err instanceof Error ? err.message : String(err),
        });
        return fallback.decide(input);
      }
    },
  };
}
