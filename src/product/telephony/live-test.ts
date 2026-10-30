/**
 * Live Phone Testing — simulation mode (no real Twilio calls) and helpers for
 * live-mode instructions. Real outbound dials are never started silently.
 */

import { randomUUID } from "@/lib/id";
import { createRuleBrain } from "@/product/receptionist/brain-rules";
import { createReceptionistEngine } from "@/product/receptionist/engine";
import type { VoiceCapabilities } from "@/product/receptionist/plan-limits";
import {
  buildProfileConfig,
  type ReceptionistProfile,
} from "@/product/receptionist/profile";
import { createMemoryReceptionistStore } from "@/product/receptionist/store";
import type { ClientAccount } from "@/product/missed-call/types";
import type { CallSession, VoicePlan } from "@/product/receptionist/types";
import type { CallEventStore } from "./call-events";
import { decideInboundRouting } from "./call-routing";
import { parsePhoneSettings } from "./phone-settings";

export type LiveTestScenario =
  | "ai_answers"
  | "human_first_missed_then_ai"
  | "transfer_request"
  | "appointment_request";

export type LiveTestResult = {
  simulated: true;
  callSid: string;
  sessionId: string | null;
  routing: ReturnType<typeof decideInboundRouting>;
  events: { kind: string; detail?: string }[];
  session: CallSession | null;
  summary?: CallSession["summary"];
  messages: string[];
};

function planTexts(plan: VoicePlan): string[] {
  const out: string[] = [];
  for (const v of plan.verbs) {
    if (v.verb === "say") out.push(v.text);
    else if (v.verb === "gather")
      v.prompts.forEach((p) => out.push(p.text));
    else if (v.verb === "dial")
      out.push(`[dial ${v.phoneE164} timeout=${v.timeoutSeconds}s]`);
  }
  return out;
}

export async function runSimulatedPhoneScenario(input: {
  organizationId: string;
  profile: ReceptionistProfile;
  client: ClientAccount;
  scenario: LiveTestScenario;
  language?: "fr" | "en";
  events?: CallEventStore;
  /** The owner's plan limits, so the simulation matches a live call. */
  capabilities?: VoiceCapabilities;
}): Promise<LiveTestResult> {
  const config = buildProfileConfig(input.profile, {
    client: input.client,
    capabilities: input.capabilities,
  });
  const phone = parsePhoneSettings(input.profile.settings.phoneSettings);
  const store = createMemoryReceptionistStore();
  const engine = createReceptionistEngine({
    store,
    configs: () => [{ ...config, enabled: true }],
    brain: createRuleBrain(),
    notifier: {
      async deliverSummary() {
        return [];
      },
      async alertEmergency() {
        return [];
      },
    },
    clock: { now: () => new Date("2026-03-04T15:00:00Z") },
  });

  const callSid = `sim_live_${randomUUID()}`;
  const events: LiveTestResult["events"] = [];
  const messages: string[] = [];
  const record = async (
    kind: string,
    detail?: string,
    sessionId?: string,
  ) => {
    events.push({ kind, detail });
    if (input.events) {
      await input.events.append({
        organizationId: input.organizationId,
        clientAccountId: input.client.id,
        callSid,
        sessionId,
        kind: kind as "test_simulated",
        detail,
        payload: { scenario: input.scenario },
      });
    }
  };

  await record("incoming", `from=+15145550177 to=${config.phoneNumberE164}`);

  const routing = decideInboundRouting({
    config,
    phone: {
      ...phone,
      // Force human-first for that scenario.
      inboundStrategy:
        input.scenario === "human_first_missed_then_ai"
          ? "human_first"
          : phone.inboundStrategy,
      humanTransferE164:
        phone.humanTransferE164 ||
        config.fallbackTransferE164 ||
        "+14385597004",
    },
  });
  await record("routing_decision", routing.action);

  let plan = await engine.startCall({
    callSid,
    fromE164: "+15145550177",
    toE164: config.phoneNumberE164,
    skipHumanRing:
      input.scenario === "ai_answers" ||
      input.scenario === "appointment_request" ||
      input.scenario === "transfer_request",
  });
  messages.push(...planTexts(plan));

  if (
    input.scenario === "human_first_missed_then_ai" &&
    plan.verbs.some((v) => v.verb === "dial")
  ) {
    await record("human_ring", "simulated no-answer", plan.sessionId ?? undefined);
    plan = await engine.handleDialResult({
      sessionId: plan.sessionId!,
      dialStatus: "no-answer",
    });
    messages.push(...planTexts(plan));
    await record("missed", "contractor_no_answer", plan.sessionId ?? undefined);
    await record("ai_started", undefined, plan.sessionId ?? undefined);
  } else {
    await record("ai_started", undefined, plan.sessionId ?? undefined);
  }

  if (input.scenario === "appointment_request" && plan.sessionId) {
    for (const speech of [
      input.language === "en"
        ? "I need a plumber for a water heater"
        : "J'ai besoin d'un plombier pour un chauffe-eau",
      "Jean Tremblay",
      "123 Rue Saint-Denis Montreal",
      "yes",
      "tomorrow morning",
      "no",
    ]) {
      plan = await engine.handleGather({
        sessionId: plan.sessionId!,
        speech,
      });
      messages.push(`Caller: ${speech}`, ...planTexts(plan));
      if (plan.verbs.some((v) => v.verb === "hangup")) break;
    }
  }

  if (input.scenario === "transfer_request" && plan.sessionId) {
    plan = await engine.handleGather({
      sessionId: plan.sessionId,
      speech:
        input.language === "en"
          ? "I need to speak to a person please"
          : "Je veux parler à quelqu'un",
    });
    messages.push(...planTexts(plan));
    if (plan.verbs.some((v) => v.verb === "dial") && plan.sessionId) {
      await record(
        "transfer_attempt",
        "caller_request",
        plan.sessionId ?? undefined,
      );
      plan = await engine.handleDialResult({
        sessionId: plan.sessionId!,
        dialStatus: "completed",
        durationSeconds: 40,
      });
      messages.push(...planTexts(plan));
      await record(
        "transfer_result",
        "completed",
        plan.sessionId ?? undefined,
      );
    }
  }

  if (input.scenario === "ai_answers" && plan.sessionId) {
    plan = await engine.handleGather({
      sessionId: plan.sessionId,
      speech:
        input.language === "en"
          ? "Do you serve Laval?"
          : "Est-ce que vous desservez Laval?",
    });
    messages.push(...planTexts(plan));
  }

  const session = plan.sessionId
    ? await store.getSession(plan.sessionId)
    : null;

  if (session && !session.finalizedAt) {
    const done = await engine.handleCallStatus({
      callSid,
      callStatus: "completed",
      durationSeconds: Math.max(20, (session.turns.length || 1) * 8),
    });
    await record("finalized", done.session?.outcome, session.id);
    return {
      simulated: true,
      callSid,
      sessionId: session.id,
      routing,
      events,
      session: done.session ?? session,
      summary: done.session?.summary ?? session.summary,
      messages,
    };
  }

  return {
    simulated: true,
    callSid,
    sessionId: session?.id ?? null,
    routing,
    events,
    session,
    summary: session?.summary,
    messages,
  };
}
