/**
 * Eval suite for the SMS-qualifier distress handoff (`isDistressSignal`
 * from `missed-call/messaging.ts`). Must catch an angry customer in FR/EN
 * without false-positiving on an urgent-but-polite description of a real
 * emergency — those still need to go through the normal collection flow so
 * urgency triage (a separate rubric) can see the description.
 */
import { isDistressSignal } from "@/product/missed-call/messaging";
import type { EvalSuite } from "./types";

export const smsQualifierEvalSuite: EvalSuite<string, boolean> = {
  name: "sms-qualifier (distress handoff)",
  run: (body) => isDistressSignal(body),
  cases: [
    {
      id: "angry_en_1",
      description: "Angry English customer must trigger handoff",
      input: "This is ridiculous, I've been waiting for hours, your service is garbage!",
      expect: (output) => ({ pass: output === true }),
    },
    {
      id: "angry_en_2",
      description: "Threatening legal action must trigger handoff",
      input: "This is a scam, I'm going to sue you and leave a one star review",
      expect: (output) => ({ pass: output === true }),
    },
    {
      id: "angry_fr_1",
      description: "Angry French customer must trigger handoff",
      input: "C'est une arnaque, votre service est pourri, je vais vous poursuivre!",
      expect: (output) => ({ pass: output === true }),
    },
    {
      id: "angry_fr_2",
      description: "French 'scandaleux' must trigger handoff",
      input: "C'est scandaleux, j'attends depuis trois jours",
      expect: (output) => ({ pass: output === true }),
    },
    {
      id: "urgent_but_polite_en",
      description:
        "A worried-but-polite emergency description must NOT be treated as anger at the business",
      input: "My water heater just burst and water is everywhere, I'm really worried, please help",
      expect: (output) => ({ pass: output === false }),
    },
    {
      id: "urgent_but_polite_fr",
      description: "French urgent-but-polite description must not trigger handoff",
      input: "Mon chauffe-eau vient d'exploser, il y a de l'eau partout, j'ai besoin d'aide",
      expect: (output) => ({ pass: output === false }),
    },
    {
      id: "ordinary_name_reply",
      description: "An ordinary name reply must never trigger handoff",
      input: "Marie Tremblay",
      expect: (output) => ({ pass: output === false }),
    },
    {
      id: "off_topic_reply",
      description: "An off-topic reply must not be misread as anger",
      input: "Do you also sell gas stoves? Just asking about products.",
      expect: (output) => ({ pass: output === false }),
    },
    {
      id: "price_request",
      description: "A plain price question must not be misread as anger",
      input: "How much will this cost? Can you give me a quote right now?",
      expect: (output) => ({ pass: output === false }),
    },
  ],
};
