/**
 * Public website demo of the AI receptionist.
 *
 * Runs the REAL call engine (same conversation logic, emergency guardrail,
 * summary builder) against a fixed fictional business, with every side effect
 * removed: no SMS, no email, no phone is dialed, nothing is persisted, and no
 * LLM is called (rule brain only — public traffic must not incur AI cost).
 *
 * The server keeps no state and needs no secret. The browser sends back what
 * the caller already said and the server replays it through the deterministic
 * rule brain (fixed clock, no randomness in the conversation), so the demo
 * works across serverless isolates without a database or a signing key. The
 * client only ever controls what the caller says, never the call session.
 */

import { randomUUID } from "@/lib/id";
import { createRuleBrain } from "./brain-rules";
import { parseReceptionistConfig } from "./config";
import { createReceptionistEngine } from "./engine";
import { createMemoryReceptionistStore } from "./store";
import type {
  CallStep,
  CallSummary,
  ReceptionistConfig,
  ReceptionistLanguage,
  VoicePlan,
} from "./types";

export type DemoScenario = "open" | "after_hours";

export type DemoMessage = { role: "agent" | "system"; text: string };

export type DemoResponse = {
  messages: DemoMessage[];
  ended: boolean;
  step: CallStep;
  language: ReceptionistLanguage;
  afterHours: boolean;
  transfer?: { name: string; emergency: boolean };
  summary?: CallSummary;
};

export class DemoError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_state",
  ) {
    super(message);
    this.name = "DemoError";
  }
}

const DEMO_CALLER = "+15145550142";
const DEMO_TO = "+14385597001";
export const MAX_DEMO_UTTERANCE = 400;
/** The demo config allows 10 caller turns; anything longer is not a real transcript. */
export const MAX_DEMO_HISTORY = 12;

// Wed 10:00 and Tue 22:00 in America/Toronto (Mon–Fri 08:00–17:00 hours).
const CLOCK: Record<DemoScenario, Date> = {
  open: new Date("2026-03-04T15:00:00Z"),
  after_hours: new Date("2026-03-04T03:00:00Z"),
};

export function demoConfig(language: ReceptionistLanguage): ReceptionistConfig {
  const fr = language === "fr";
  return parseReceptionistConfig({
    id: `rc_demo_${language}`,
    clientAccountId: "client_demo_site",
    phoneNumberE164: DEMO_TO,
    businessName: fr ? "Plomberie Nord (démo)" : "Nord Plumbing (demo)",
    languages: [language],
    defaultLanguage: language,
    businessHours: { start: "08:00", end: "17:00", days: [1, 2, 3, 4, 5] },
    routing: [
      {
        id: "billing",
        name: fr ? "la facturation" : "billing",
        phoneE164: "+14385597002",
        keywords: fr
          ? ["facture", "facturation", "paiement"]
          : ["invoice", "billing", "payment"],
      },
    ],
    faqs: [
      {
        id: "hours",
        keywords: [
          "heures d'ouverture",
          "heures",
          "horaire",
          "opening hours",
          "hours",
          "open",
        ],
        answerFr: "Nous sommes ouverts du lundi au vendredi, de 8 h à 17 h.",
        answerEn: "We are open Monday to Friday, 8 a.m. to 5 p.m.",
      },
      {
        id: "area",
        keywords: [
          "zone de service",
          "secteur",
          "desservez",
          "service area",
          "do you serve",
          "areas",
        ],
        answerFr: "Nous desservons Montréal, Laval et la Rive-Nord.",
        answerEn: "We serve Montréal, Laval and the North Shore.",
      },
      {
        id: "estimate",
        keywords: [
          "estimation gratuite",
          "soumission gratuite",
          "free estimate",
          "free quote",
        ],
        answerFr:
          "Oui, les estimations sont gratuites. Un membre de l'équipe confirmera le moment.",
        answerEn:
          "Yes, estimates are free. A team member will confirm the time.",
      },
    ],
    emergencyTransferE164: "+14385597003",
    fallbackTransferE164: "+14385597004",
    afterHoursMode: "take_message_emergency_transfer",
    collectPreferredTime: true,
    maxTurns: 10,
    notifications: [],
    smsRecoveryOnIncomplete: false,
    transcriptRetentionDays: 1,
  });
}

/* ----------------------------------------------------------------- engine */

function noopNotifier() {
  return {
    async deliverSummary() {
      return [];
    },
    async alertEmergency() {
      return [];
    },
  };
}

function makeEngine(config: ReceptionistConfig, scenario: DemoScenario) {
  const store = createMemoryReceptionistStore();
  const engine = createReceptionistEngine({
    store,
    configs: () => [config],
    brain: createRuleBrain(),
    notifier: noopNotifier(),
    llm: null,
    clock: { now: () => CLOCK[scenario] },
  });
  return { store, engine };
}

function transferNote(
  name: string,
  language: ReceptionistLanguage,
  emergency: boolean,
): string {
  const fr = language === "fr";
  if (emergency) {
    return fr
      ? `Transfert d'urgence simulé vers ${name}. Sur un vrai appel, la ligne de garde sonnerait maintenant et le propriétaire recevrait un texto.`
      : `Simulated emergency transfer to ${name}. On a real call the on-call line would ring now and the owner would get a text.`;
  }
  return fr
    ? `Transfert simulé vers ${name}. Sur un vrai appel, le numéro configuré sonnerait.`
    : `Simulated transfer to ${name}. On a real call the configured number would ring.`;
}

function planMessages(plan: VoicePlan): DemoMessage[] {
  const out: DemoMessage[] = [];
  const push = (text: string) => {
    const t = text.trim();
    if (t && out.at(-1)?.text !== t) out.push({ role: "agent", text: t });
  };
  for (const verb of plan.verbs) {
    if (verb.verb === "say") push(verb.text);
    else if (verb.verb === "gather") verb.prompts.forEach((p) => push(p.text));
  }
  return out;
}

/** Advance the call through any simulated dial / voicemail until it needs the caller. */
async function settle(
  engine: ReturnType<typeof makeEngine>["engine"],
  store: ReturnType<typeof makeEngine>["store"],
  first: VoicePlan,
  language: ReceptionistLanguage,
  callSid: string,
): Promise<Omit<DemoResponse, "afterHours">> {
  let plan = first;
  const messages = planMessages(plan);
  let ended = plan.verbs.some((v) => v.verb === "hangup");
  let transfer: DemoResponse["transfer"];

  for (let guard = 0; guard < 3 && !ended; guard += 1) {
    const dial = plan.verbs.find((v) => v.verb === "dial");
    const record = plan.verbs.some((v) => v.verb === "record");
    if (!dial && !record) break;

    const session = (await store.getSessionByCallSid(callSid))!;
    if (dial && dial.verb === "dial") {
      const last = session.transfers.at(-1);
      const emergency = last?.reason === "emergency";
      const name =
        last?.targetName ?? (language === "fr" ? "l'équipe" : "the team");
      transfer = { name, emergency };
      messages.push({
        role: "system",
        text: transferNote(name, language, emergency),
      });
      plan = await engine.handleDialResult({
        sessionId: session.id,
        dialStatus: "completed",
        durationSeconds: 60,
      });
    } else {
      messages.push({
        role: "system",
        text:
          language === "fr" ? "Message vocal simulé." : "Simulated voicemail.",
      });
      plan = await engine.handleVoicemail({ sessionId: session.id });
    }
    messages.push(...planMessages(plan));
    ended = plan.verbs.some((v) => v.verb === "hangup");
  }

  const session = (await store.getSessionByCallSid(callSid))!;
  let summary: CallSummary | undefined;
  if (ended) {
    const done = await engine.handleCallStatus({
      callSid,
      callStatus: "completed",
      durationSeconds: Math.max(10, session.turns.length * 7),
    });
    summary = done.session?.summary;
  }
  return {
    messages,
    ended,
    step: session.step,
    language: session.language,
    transfer,
    summary,
  };
}

export type DemoRequest =
  | { action: "start"; language: ReceptionistLanguage; scenario: DemoScenario }
  | {
      action: "say";
      language: ReceptionistLanguage;
      scenario: DemoScenario;
      /** What the caller already said, oldest first, so the call can be replayed. */
      history: string[];
      speech: string;
    };

function clean(speech: string): string {
  return speech.trim().slice(0, MAX_DEMO_UTTERANCE);
}

export async function runDemoTurn(
  request: DemoRequest,
): Promise<DemoResponse> {
  const { language, scenario } = request;
  const config = demoConfig(language);
  const { store, engine } = makeEngine(config, scenario);
  const callSid = `demo_${randomUUID()}`;

  const plan = await engine.startCall({
    callSid,
    fromE164: DEMO_CALLER,
    toE164: DEMO_TO,
  });
  let result = await settle(engine, store, plan, language, callSid);

  if (request.action === "say") {
    if (request.history.length > MAX_DEMO_HISTORY) {
      throw new DemoError("Call too long", "invalid_state");
    }
    const turns = [...request.history.map(clean), clean(request.speech)];
    for (const speech of turns) {
      // A call that already ended cannot be continued: the history was not
      // produced by this demo.
      if (result.ended || !speech) {
        throw new DemoError("Call already ended", "invalid_state");
      }
      const session = (await store.getSessionByCallSid(callSid))!;
      const next = await engine.handleGather({ sessionId: session.id, speech });
      result = await settle(engine, store, next, language, callSid);
    }
  }

  const session = (await store.getSessionByCallSid(callSid))!;
  return { ...result, afterHours: session.afterHours };
}
