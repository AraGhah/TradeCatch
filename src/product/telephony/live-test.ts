/**
 * Dashboard call simulation (Test Center → Live phone testing).
 *
 * A simulation runs the real receptionist engine against the business's saved
 * configuration, on an in-memory store and a virtual clock. Nothing in this
 * module can reach a carrier or a voice provider: it imports no Twilio, Bland
 * or LiveKit client, uses no network, and the engine it builds has no SMS,
 * notification or CRM hooks. Every event it produces is labelled as a
 * simulation.
 *
 * Why it is built this way. The first version decided the route with the raw
 * saved settings and the wall clock, then told the engine to skip that route
 * and ran the engine on a clock frozen in March 2026. A business set to ring
 * the contractor first therefore logged `routing_decision:ring_human` followed
 * by `ai_started` with no ring in between, and every run ended as
 * `caller_hung_up`. Now:
 *
 * - the routing is `resolveInboundRouting`, the function the live webhook
 *   uses, evaluated at the time the simulation runs;
 * - each scenario answers or fails the ring through `handleDialResult`, so
 *   `ring_human` is always followed by what the ring did;
 * - the final status and the reason the call ended come from the stored
 *   session, not from the scenario's name.
 */

import { randomUUID } from "@/lib/id";
import { createRuleBrain } from "@/product/receptionist/brain-rules";
import { createReceptionistEngine } from "@/product/receptionist/engine";
import type { VoiceCapabilities } from "@/product/receptionist/plan-limits";
import {
  buildProfileConfig,
  type ReceptionistProfile,
} from "@/product/receptionist/profile";
import { shouldAnswerCall } from "@/product/receptionist/call-handling";
import { isAfterHours } from "@/product/missed-call/call-handling";
import { firstLanguage } from "@/product/receptionist/language-select";
import { receptionistNameOrDefault } from "@/product/receptionist/persona";
import { createMemoryReceptionistStore } from "@/product/receptionist/store";
import type { ClientAccount } from "@/product/missed-call/types";
import type {
  CallOutcome,
  CallSession,
  ReceptionistConfig,
  ReceptionistLanguage,
  VoicePlan,
} from "@/product/receptionist/types";
import { resolveInboundRouting } from "./call-routing";
import { ringFirstBlockedByPlan } from "./plan-routing";
import {
  describeCallEnd,
  type CallTermination,
  type SimulationFinalStatus,
} from "./call-timeline";
import type { CallEventKind } from "./types";

export const LIVE_TEST_SCENARIOS = [
  "answered_call",
  "missed_call",
  "caller_hangup",
  "receptionist_response",
  "routing_failure",
  "transfer_request",
  "appointment_request",
] as const;

export type LiveTestScenario = (typeof LIVE_TEST_SCENARIOS)[number];

/** Names the first version used; still accepted so an open dashboard keeps working. */
export const LEGACY_SCENARIOS: Record<string, LiveTestScenario> = {
  ai_answers: "receptionist_response",
  human_first_missed_then_ai: "missed_call",
};

/** Calls on the simulated line come from this number. It is never dialed. */
export const SIMULATED_CALLER_E164 = "+15145550177";

export type LiveTestErrorCode =
  | "receptionist_not_activated"
  | "receptionist_disabled"
  | "no_phone_number"
  | "invalid_configuration"
  | "call_not_answered_now"
  | "routing_rejected"
  | "language_not_enabled"
  | "scenario_not_applicable"
  | "ring_first_unavailable_on_plan"
  | "no_transfer_destination"
  | "voice_engine_not_simulatable"
  | "test_caller_is_personal_contact"
  | "simulation_failed";

/** A problem with the business's configuration, in words the owner can act on. */
export class LiveTestError extends Error {
  constructor(
    readonly code: LiveTestErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LiveTestError";
  }
}

export type SimulatedEvent = {
  seq: number;
  /** Simulated wall-clock time of the step. */
  at: string;
  /** Seconds since the simulated call started. */
  offsetSeconds: number;
  kind: CallEventKind;
  detail?: string;
  payload?: Record<string, unknown>;
  simulated: true;
};

export type { SimulationFinalStatus };

export type SimulationTermination = CallTermination;

export type SimulationRouting = {
  action: "ring_human" | "ai" | "reject";
  reason: string;
  afterHours: boolean;
  ringsFirst: boolean;
  /**
   * The saved settings ring the contractor first, but the plan has no live
   * transfer, so the receptionist answers (as it would on a real call).
   */
  limitedByPlan?: boolean;
  /** Last four digits of the phone that rings; never the whole number. */
  ringTargetLast4?: string;
  ringTimeoutSeconds?: number;
  screened?: boolean;
};

export type SimulationReceptionist = {
  name?: string;
  businessName: string;
  /** The language the line starts in (French first when French is enabled). */
  startLanguage: ReceptionistLanguage;
  /** The language this call was held in. */
  callLanguage: ReceptionistLanguage;
  languages: ReceptionistLanguage[];
  /** The first thing the caller hears. */
  greeting: string;
  voice: string;
  engine: string;
};

export type TranscriptLine = {
  speaker: "caller" | "receptionist";
  text: string;
};

/** Everything the dashboard shows for one simulation; also what is saved and reloaded. */
export type SimulationRun = {
  simulated: true;
  callSid: string;
  scenario: LiveTestScenario;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  finalStatus: SimulationFinalStatus;
  outcome?: CallOutcome;
  termination: SimulationTermination;
  routing: SimulationRouting;
  receptionist: SimulationReceptionist;
  /** Stable codes for things the simulation cannot reproduce exactly. */
  notes: string[];
  events: SimulatedEvent[];
  transcript: TranscriptLine[];
  headline?: string;
};

/** A run together with the stored call record it produced (not shown to the browser). */
export type SimulationOutput = {
  run: SimulationRun;
  session: CallSession;
};

/* -------------------------------------------------------------------------- */
/* Modelled timings (seconds). Simulations run instantly; these place the steps */
/* of the call on a believable timeline and set the duration that is reported.  */
/* -------------------------------------------------------------------------- */

const HUMAN_ANSWERS_AFTER = 8;
const HUMAN_CONVERSATION = 42;
const RING_FAILS_AFTER = 2;
const CALLER_HANGS_UP_WHILE_RINGING_AFTER = 6;
const CALLER_HANGS_UP_ON_GREETING_AFTER = 4;
const SECONDS_PER_TURN = 8;

const MARKER_KIND: CallEventKind = "test_simulated";

function planTexts(plan: VoicePlan): string[] {
  const out: string[] = [];
  for (const verb of plan.verbs) {
    if (verb.verb === "say") out.push(verb.text);
    else if (verb.verb === "gather") verb.prompts.forEach((p) => out.push(p.text));
  }
  return out;
}

function last4(e164: string | undefined): string | undefined {
  const digits = (e164 ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

function isRingPlan(plan: VoicePlan) {
  return plan.verbs.find((v) => v.verb === "dial") as
    | Extract<VoicePlan["verbs"][number], { verb: "dial" }>
    | undefined;
}

/**
 * The fields a rejected receptionist config names. The config parser throws a
 * plain Error ("[receptionist] Invalid config: field: reason; field: reason"),
 * not a validation error object, so the names come from its message.
 */
export function invalidConfigFields(error: unknown): string[] {
  const message = error instanceof Error ? error.message : "";
  const list = message.split("Invalid config:")[1] ?? "";
  const names = list
    .split(";")
    .map((part) => /^\s*([A-Za-z0-9_.()-]+):/.exec(part)?.[1])
    .filter((name): name is string => Boolean(name) && name !== "(root)");
  return Array.from(new Set(names));
}

const CALLER_SAYS = {
  question: {
    fr: "Est-ce que vous desservez Laval?",
    en: "Do you serve Laval?",
  },
  goodbye: { fr: "Non, merci. Au revoir.", en: "No, thank you. Goodbye." },
  person: {
    fr: "Je veux parler à quelqu'un",
    en: "I need to speak to a person please",
  },
} as const;

export async function runSimulatedPhoneScenario(input: {
  organizationId: string;
  profile: ReceptionistProfile;
  client: ClientAccount;
  scenario: LiveTestScenario;
  /** The language the simulated caller speaks (French is the line's default). */
  language?: ReceptionistLanguage;
  /** The owner's plan limits, so the simulation matches a live call. */
  capabilities?: VoiceCapabilities;
  /** When the call arrives. Defaults to now; the business hours that apply are the ones at this time. */
  now?: Date;
  /** Becomes the call id (`sim_live_<id>`); lets a repeated request be recognised. */
  runId?: string;
}): Promise<SimulationOutput> {
  const startMs = (input.now ?? new Date()).getTime();
  const startAt = new Date(startMs);
  const scenario = input.scenario;

  if (!input.profile.activated) {
    throw new LiveTestError(
      "receptionist_not_activated",
      "The receptionist is not activated for this business, so real calls would not reach it. Activate it in Receptionist settings, then run the test again.",
    );
  }

  let config: ReceptionistConfig;
  try {
    config = buildProfileConfig(input.profile, {
      client: input.client,
      capabilities: input.capabilities,
    });
  } catch (error) {
    const fields = invalidConfigFields(error);
    if (!input.profile.phoneNumberE164 && fields.includes("phoneNumberE164")) {
      throw new LiveTestError(
        "no_phone_number",
        "No TradeCatch phone number is assigned to this business yet. Add one in Phone settings, then run the test again.",
      );
    }
    throw new LiveTestError(
      "invalid_configuration",
      fields.length > 0
        ? `The saved receptionist settings are not valid (${fields.join(", ")}), so the call cannot be simulated. Fix them and save again.`
        : "The saved receptionist settings are not valid, so the call cannot be simulated. Review them and save again.",
      { fields },
    );
  }

  if (!config.enabled) {
    throw new LiveTestError(
      "receptionist_disabled",
      "The receptionist is switched off for this business (call handling is disabled or AI answering is off), so a real call would not reach it.",
    );
  }
  if (!shouldAnswerCall(config, startAt)) {
    throw new LiveTestError(
      "call_not_answered_now",
      `The receptionist is set to answer calls ${config.callHandlingMode === "business_hours" ? "during business hours only" : config.callHandlingMode === "after_hours" ? "after hours only" : "in a mode that does not apply right now"}, and a call arriving now would not be answered. Change the call handling mode, or run the test at a time it answers.`,
      { callHandlingMode: config.callHandlingMode },
    );
  }

  const callerLanguage: ReceptionistLanguage =
    input.language ?? firstLanguage(config.languages, config.defaultLanguage);
  if (!config.languages.includes(callerLanguage)) {
    throw new LiveTestError(
      "language_not_enabled",
      `This receptionist is not set up for ${callerLanguage === "fr" ? "French" : "English"}. Enabled: ${config.languages.join(", ")}.`,
      { languages: config.languages },
    );
  }

  const { policy, routing } = resolveInboundRouting({
    config,
    fromE164: SIMULATED_CALLER_E164,
    now: startAt,
  });
  if (policy.kind !== "ai") {
    throw new LiveTestError(
      "test_caller_is_personal_contact",
      "The simulated caller number is in this business's personal contacts list, so the call would not reach the receptionist.",
    );
  }
  if (routing.action === "reject") {
    throw new LiveTestError(
      "routing_rejected",
      "The saved routing rejects this call (AI answering is off and no phone is set to ring instead). Turn AI answering on or add a phone to ring.",
      { reason: routing.reason },
    );
  }
  const ringsFirst = routing.action === "ring_human";
  const limitedByPlan =
    !ringsFirst &&
    ringFirstBlockedByPlan({
      profile: input.profile,
      client: input.client,
      capabilities: input.capabilities,
      fromE164: SIMULATED_CALLER_E164,
      now: startAt,
    });
  if (ringsFirst === false && scenario === "missed_call" && limitedByPlan) {
    throw new LiveTestError(
      "ring_first_unavailable_on_plan",
      "The saved settings ring the contractor's phone first, but this plan does not include live call transfer, so a call goes straight to the receptionist and a missed call cannot be shown. Upgrade the plan, or run another scenario.",
    );
  }
  if (
    ringsFirst === false &&
    (scenario === "missed_call")
  ) {
    throw new LiveTestError(
      "scenario_not_applicable",
      "This scenario needs the contractor's phone to ring first, and the saved routing sends every call straight to the receptionist. Choose \"Contractor phone rings first\" in AI Call Handling to test a missed call.",
      { routing: routing.action },
    );
  }

  // The engine runs on a virtual clock that starts when the simulation does.
  let offsetSeconds = 0;
  const clock = { now: () => new Date(startMs + offsetSeconds * 1000) };
  const store = createMemoryReceptionistStore();
  const engine = createReceptionistEngine({
    store,
    configs: () => [config],
    brain: createRuleBrain(),
    // A simulation never notifies anyone.
    notifier: {
      async deliverSummary() {
        return [];
      },
      async alertEmergency() {
        return [];
      },
    },
    clock,
  });

  const callSid = `sim_live_${input.runId ?? randomUUID()}`;
  const events: SimulatedEvent[] = [];
  const transcript: TranscriptLine[] = [];
  const notes: string[] = [];
  const emit = (
    kind: CallEventKind,
    detail?: string,
    payload?: Record<string, unknown>,
  ) => {
    const seq = events.length;
    events.push({
      seq,
      at: new Date(startMs + offsetSeconds * 1000 + seq).toISOString(),
      offsetSeconds,
      kind,
      detail,
      payload,
      simulated: true,
    });
  };
  const advance = (seconds: number) => {
    offsetSeconds += seconds;
  };
  const heard = (plan: VoicePlan) => {
    for (const text of planTexts(plan)) {
      transcript.push({ speaker: "receptionist", text });
    }
  };
  const callerSays = (text: string) => {
    transcript.push({ speaker: "caller", text });
  };

  const engineName = config.voiceEngine ?? "gather";
  if (engineName !== "gather") notes.push(`voice_engine_${engineName}`);
  if (limitedByPlan) notes.push("ring_first_unavailable_on_plan");

  emit(MARKER_KIND, `scenario=${scenario}`, {
    scenario,
    language: callerLanguage,
    note: "Simulation: no phone was called and nothing was billed.",
  });
  emit("incoming", `from=${SIMULATED_CALLER_E164} to=${config.phoneNumberE164}`);

  const afterHours = isAfterHours(config, startAt);
  emit("routing_decision", `${routing.action}:${routing.reason}`, {
    action: routing.action,
    reason: routing.reason,
    afterHours,
    ...(routing.action === "ring_human"
      ? { then: routing.then, timeoutSeconds: routing.timeoutSeconds }
      : {}),
  });

  const plan = await engine.startCall({
    callSid,
    fromE164: SIMULATED_CALLER_E164,
    toE164: config.phoneNumberE164,
  });
  if (!plan.sessionId) {
    throw new LiveTestError(
      "simulation_failed",
      "The receptionist did not start a call for the saved settings.",
    );
  }
  const sessionId = plan.sessionId;
  if (plan.verbs.some((v) => v.verb === "sip_handoff")) {
    throw new LiveTestError(
      "voice_engine_not_simulatable",
      "This business's calls are handed to the voice agent, which the dashboard simulation cannot run. Use the live test (call the number) to check it.",
    );
  }

  const ring = isRingPlan(plan);
  const screened = ring?.screen === true;
  const startLanguage = firstLanguage(config.languages, config.defaultLanguage);
  const voice = config.voices[callerLanguage] ?? config.voices[startLanguage];

  /** The first words the caller hears: whoever answers first speaks them. */
  let greeting = "";
  let current: VoicePlan = plan;
  const adopt = (next: VoicePlan) => {
    current = next;
    heard(next);
  };

  /** The receptionist picks up (at once, or after the ring was missed). */
  const receptionistAnswers = (answering: VoicePlan, detail: string) => {
    emit("ai_started", detail, { engine: engineName });
    greeting ||= planTexts(answering)[0] ?? "";
    adopt(answering);
  };

  /** A bilingual line opens in French with a key for English: French callers press nothing. */
  const chooseLanguage = async () => {
    const state = await store.getSession(sessionId);
    if (state?.step !== "language") return;
    const english = callerLanguage === "en";
    advance(SECONDS_PER_TURN / 2);
    if (english) callerSays("[1]");
    adopt(
      await engine.handleGather({
        sessionId,
        speech: "",
        digits: english ? "1" : undefined,
      }),
    );
    emit("ai_turn", english ? "language_selected:en" : "language_kept:fr");
  };

  const callerTurn = async (speech: string) => {
    advance(SECONDS_PER_TURN);
    callerSays(speech);
    adopt(await engine.handleGather({ sessionId, speech }));
    emit(
      "ai_turn",
      `turn=${transcript.filter((l) => l.speaker === "caller").length}`,
    );
  };

  const hungUp = () => current.verbs.some((v) => v.verb === "hangup");

  /** A caller who needs a plumber: problem, name, address, callback number, time, confirmation. */
  const requestFlow = async () => {
    const fr = callerLanguage === "fr";
    for (const speech of [
      fr
        ? "J'ai besoin d'un plombier pour un chauffe-eau"
        : "I need a plumber for a water heater",
      "Jean Tremblay",
      "123 Rue Saint-Denis Montreal",
      fr ? "oui" : "yes",
      fr ? "demain matin" : "tomorrow morning",
      fr ? "oui" : "yes",
      fr ? "non" : "no",
    ]) {
      if (hungUp()) break;
      await callerTurn(speech);
    }
  };

  /** What the simulated caller says to the receptionist. Returns whether a transfer began. */
  const converse = async (
    kind: LiveTestScenario,
  ): Promise<{ dialed: boolean }> => {
    await chooseLanguage();
    switch (kind) {
      case "appointment_request":
        await requestFlow();
        return { dialed: false };
      case "transfer_request":
        await callerTurn(CALLER_SAYS.person[callerLanguage]);
        return { dialed: Boolean(isRingPlan(current)) };
      default:
        await callerTurn(CALLER_SAYS.question[callerLanguage]);
        if (!hungUp()) await callerTurn(CALLER_SAYS.goodbye[callerLanguage]);
        return { dialed: false };
    }
  };

  /** The receptionist offered to put the caller through: drive that leg to its result. */
  const transferLeg = async (answered: boolean) => {
    const leg = isRingPlan(current);
    emit("transfer_attempt", "caller_request", {
      targetLast4: last4(leg?.phoneE164),
    });
    if (answered) {
      advance(HUMAN_ANSWERS_AFTER + HUMAN_CONVERSATION);
      adopt(
        await engine.handleDialResult({
          sessionId,
          dialStatus: "completed",
          durationSeconds: HUMAN_CONVERSATION,
        }),
      );
      emit("transfer_result", "completed", { talkSeconds: HUMAN_CONVERSATION });
      return;
    }
    advance(leg?.timeoutSeconds ?? 25);
    adopt(await engine.handleDialResult({ sessionId, dialStatus: "no-answer" }));
    emit("transfer_result", "no_answer");
    emit("error", "transfer_failed", { dialStatus: "no-answer" });
    // The receptionist takes the request instead; the caller gives it.
    await requestFlow();
  };

  const noTransfer = () =>
    new LiveTestError(
      "no_transfer_destination",
      "No phone is available to transfer a call to (no transfer number saved, the plan has no live transfer, or it is outside the transfer hours), so this scenario cannot be shown. Add a transfer number in Transfer settings.",
    );

  if (ring) {
    emit("human_ring", screened ? "ring_first_screened" : "ring_first", {
      timeoutSeconds: ring.timeoutSeconds,
      targetLast4: last4(ring.phoneE164),
    });

    if (scenario === "answered_call") {
      advance(HUMAN_ANSWERS_AFTER);
      if (screened) {
        await engine.handleScreen({ sessionId, phase: "result", digits: "1" });
      }
      advance(HUMAN_CONVERSATION);
      adopt(
        await engine.handleDialResult({
          sessionId,
          dialStatus: "completed",
          durationSeconds: HUMAN_CONVERSATION,
        }),
      );
      emit("transfer_result", "human_answered", {
        answeredAfterSeconds: HUMAN_ANSWERS_AFTER,
        talkSeconds: HUMAN_CONVERSATION,
      });
    } else if (scenario === "caller_hangup") {
      advance(CALLER_HANGS_UP_WHILE_RINGING_AFTER);
      adopt(
        await engine.handleDialResult({
          sessionId,
          dialStatus: "no-answer",
          callStatus: "completed",
        }),
      );
      emit("missed", "caller_hung_up_while_ringing");
    } else if (scenario === "routing_failure") {
      advance(RING_FAILS_AFTER);
      const after = await engine.handleDialResult({
        sessionId,
        dialStatus: "failed",
      });
      emit("error", "ring_failed", { dialStatus: "failed" });
      receptionistAnswers(after, "after_ring_failed");
      await converse("receptionist_response");
    } else {
      // missed_call, receptionist_response, transfer_request, appointment_request:
      // nobody picks up, so the receptionist does.
      advance(ring.timeoutSeconds);
      const after = await engine.handleDialResult({
        sessionId,
        dialStatus: "no-answer",
      });
      emit("missed", "no_answer", { rangSeconds: ring.timeoutSeconds });
      receptionistAnswers(after, "after_missed_call");
      const result = await converse(
        scenario === "missed_call" ? "receptionist_response" : scenario,
      );
      if (scenario === "transfer_request") {
        if (!result.dialed) throw noTransfer();
        await transferLeg(true);
      }
    }
  } else {
    receptionistAnswers(plan, engineName);
    if (scenario === "caller_hangup") {
      advance(CALLER_HANGS_UP_ON_GREETING_AFTER);
      emit("status", "caller_hung_up", { by: "caller" });
    } else if (
      scenario === "routing_failure" ||
      scenario === "transfer_request"
    ) {
      const result = await converse("transfer_request");
      if (!result.dialed) throw noTransfer();
      await transferLeg(scenario === "transfer_request");
    } else {
      await converse(
        scenario === "answered_call" ? "receptionist_response" : scenario,
      );
    }
  }

  // The provider's status callback ends the call and fixes its duration.
  const duration = Math.max(1, Math.round(offsetSeconds));
  await engine.handleCallStatus({
    callSid,
    callStatus: "completed",
    durationSeconds: duration,
  });
  emit("status", "completed", {
    providerStatus: "completed",
    durationSeconds: duration,
  });
  const session = await store.getSession(sessionId);
  if (!session) {
    throw new LiveTestError(
      "simulation_failed",
      "The simulated call was not saved.",
    );
  }
  const { finalStatus, termination } = describeCallEnd(session);
  emit("finalized", session.outcome, {
    finalStatus,
    outcome: session.outcome,
    termination,
    durationSeconds: duration,
  });

  const run: SimulationRun = {
    simulated: true,
    callSid,
    scenario,
    startedAt: startAt.toISOString(),
    endedAt: new Date(startMs + duration * 1000).toISOString(),
    durationSeconds: duration,
    finalStatus,
    outcome: session.outcome,
    termination,
    routing: {
      action: routing.action,
      reason: routing.reason,
      afterHours,
      ringsFirst,
      ...(limitedByPlan ? { limitedByPlan: true } : {}),
      ...(ring
        ? {
            ringTargetLast4: last4(ring.phoneE164),
            ringTimeoutSeconds: ring.timeoutSeconds,
            screened,
          }
        : {}),
    },
    receptionist: {
      // The name she introduces herself with: the saved one, or the default persona.
      name: receptionistNameOrDefault(config.receptionistName),
      businessName: config.businessName,
      startLanguage,
      callLanguage: session.language,
      languages: config.languages,
      greeting,
      voice,
      engine: engineName,
    },
    notes,
    events,
    transcript,
    headline: session.summary?.headline,
  };
  return { run, session };
}
