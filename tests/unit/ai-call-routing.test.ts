/**
 * Smart AI call routing: Missed Calls Only / AI Answers All Calls, personal
 * contacts, voicemail screening, the LiveKit SIP hand-off and loop safety.
 *
 * Twilio and LiveKit are simulated: the engine is driven with the same inputs
 * the webhooks pass it, and TwiML is rendered with an injected SIP target. No
 * call is placed and no real routing is touched.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Live transfer is withheld at launch (src/lib/launch-flags.ts). This file covers
// the preserved routing code with the operator switch on; each test file runs in
// its own process.
process.env.LAUNCH_ENABLE_CALL_TRANSFER = "1";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { createRuleBrain } from "../../src/product/receptionist/brain-rules";
import { createReceptionistEngine } from "../../src/product/receptionist/engine";
import {
  applyVoicePlanLimits,
  voiceCapabilitiesForPlan,
} from "../../src/product/receptionist/plan-limits";
import {
  buildProfileConfig,
  profileSettingsSchema,
  validateProfile,
  type ReceptionistProfile,
} from "../../src/product/receptionist/profile";
import { createMemoryReceptionistStore } from "../../src/product/receptionist/store";
import type {
  CallSession,
  ReceptionistConfig,
  VoicePlan,
} from "../../src/product/receptionist/types";
import { renderTwiml } from "../../src/product/receptionist/voice";
import {
  callRoutingForProfile,
  evaluateAiCallHandling,
} from "../../src/product/telephony/ai-call-handling";
import {
  applyAiCallHandlingUpdate,
  aiCallHandlingUpdateSchema,
  observeTestCall,
} from "../../src/product/telephony/ai-call-handling-service";
import { callerE164, callerPolicyFor } from "../../src/product/telephony/caller-policy";
import {
  livekitSipConfig,
  livekitSipUri,
  type LivekitSipTarget,
} from "../../src/product/telephony/livekit-handoff";
import {
  checkNumberRouting,
  classifyNumberRouting,
} from "../../src/product/telephony/number-routing-check";
import {
  defaultPhoneSettings,
  normalizeContactE164,
  parsePhoneSettings,
} from "../../src/product/telephony/phone-settings";
import type { PhoneSettings } from "../../src/product/telephony/types";

const TRADECATCH = "+14385597100";
const CONTRACTOR = "+15145550142";
const CALLER = "+15145559876";
const FRIEND = "+15145551111";
const NOW = new Date("2026-03-04T15:00:00Z"); // Wednesday 10:00 Toronto

const client = demoClientAccount({
  id: "client_routing",
  contractorDisplayName: "Nord Plomberie",
});

function profile(
  phone: Partial<PhoneSettings>,
  over: Record<string, unknown> = {},
): ReceptionistProfile {
  return {
    organizationId: "org_routing",
    phoneNumberE164: TRADECATCH,
    activated: true,
    settings: profileSettingsSchema.parse({
      receptionistName: "Sophia",
      knowledge: { companyName: "Nord Plomberie", services: ["plomberie"] },
      phoneSettings: {
        ...defaultPhoneSettings(),
        tradecatchNumberE164: TRADECATCH,
        ...phone,
      },
      ...over,
    }),
    updatedAt: NOW.toISOString(),
  };
}

const MISSED: Partial<PhoneSettings> = {
  aiCallMode: "missed_calls_only",
  routingMethod: "tradecatch_number",
  contractorPhoneE164: CONTRACTOR,
  inboundStrategy: "human_first",
  humanRingTimeoutSeconds: 18,
};
const ALL: Partial<PhoneSettings> = {
  aiCallMode: "ai_answers_all",
  routingMethod: "tradecatch_number",
};

function growthConfig(phone: Partial<PhoneSettings>, over: Record<string, unknown> = {}) {
  return buildProfileConfig(profile(phone, over), {
    client,
    capabilities: voiceCapabilitiesForPlan("growth"),
  });
}

function harness(
  config: ReceptionistConfig,
  opts: { livekit?: boolean } = {},
) {
  const store = createMemoryReceptionistStore();
  const summaries: string[] = [];
  const recoveries: string[] = [];
  const finalized: string[] = [];
  const engine = createReceptionistEngine({
    store,
    configs: () => [config],
    brain: createRuleBrain(),
    notifier: {
      async deliverSummary(_c, session) {
        summaries.push(session.id);
        return [];
      },
      async alertEmergency() {
        return [];
      },
    },
    clock: { now: () => NOW },
    async onIncompleteCall(input) {
      recoveries.push(input.callSid);
    },
    async onFinalized(session) {
      finalized.push(session.id);
    },
    livekitHandoffReady: () => opts.livekit === true,
  });
  return { engine, store, summaries, recoveries, finalized };
}

const verbs = (plan: VoicePlan) => plan.verbs.map((v) => v.verb);
const spoken = (plan: VoicePlan) =>
  plan.verbs
    .flatMap((v) =>
      v.verb === "say" ? [v.text] : v.verb === "gather" ? v.prompts.map((p) => p.text) : [],
    )
    .join(" ");
const twiml = (plan: VoicePlan, sip?: LivekitSipTarget | null) =>
  renderTwiml(plan, (step, id) => `https://tc.example/api/twilio/voice/receptionist/${step}?session=${id}`, {
    ssml: false,
    livekitSip: sip ?? null,
  });

async function ring(h: ReturnType<typeof harness>, callSid = "CA_routing_1", from = CALLER) {
  return h.engine.startCall({ callSid, fromE164: from, toE164: TRADECATCH });
}

async function session(h: ReturnType<typeof harness>, id: string | null): Promise<CallSession> {
  const s = await h.store.getSession(id!);
  assert.ok(s, "session exists");
  return s;
}

describe("Missed Calls Only: the contractor's phone rings first", () => {
  it("rings the contractor with press-1 screening before any AI", async () => {
    const h = harness(growthConfig(MISSED));
    const plan = await ring(h);
    assert.deepEqual(verbs(plan), ["dial"]);
    const dial = plan.verbs[0]!;
    assert.ok(dial.verb === "dial" && dial.phoneE164 === CONTRACTOR && dial.screen === true);
    assert.equal(dial.verb === "dial" && dial.timeoutSeconds, 18);
    const xml = twiml(plan);
    assert.match(xml, /<Number url="https:\/\/tc\.example\/api\/twilio\/voice\/receptionist\/screen\?session=rcs_[^"]+" method="POST">\+15145550142<\/Number>/);
    const s = await session(h, plan.sessionId);
    assert.equal(s.routing?.screened, true);
    assert.equal(s.routing?.mode, "missed_calls_only");
  });

  it("contractor answers and presses 1: the call is bridged, nobody is notified", async () => {
    const h = harness(growthConfig(MISSED));
    const plan = await ring(h);
    const prompt = await h.engine.handleScreen({ sessionId: plan.sessionId!, phase: "prompt", parentCallSid: "CA_routing_1" });
    assert.deepEqual(verbs(prompt), ["gather", "hangup"]);
    assert.match(twiml(prompt), /input="dtmf".*numDigits="1"/);
    assert.match(twiml(prompt), /receptionist\/screen_result\?session=/);
    assert.match(spoken(prompt), /Appuyez sur 1/);

    const accepted = await h.engine.handleScreen({ sessionId: plan.sessionId!, phase: "result", digits: "1", parentCallSid: "CA_routing_1" });
    assert.deepEqual(accepted.verbs, [], "empty TwiML bridges the call");
    const done = await h.engine.handleDialResult({ sessionId: plan.sessionId!, dialStatus: "completed", callSid: "CA_routing_1", callStatus: "in-progress" });
    assert.deepEqual(verbs(done), ["hangup"]);
    const s = await session(h, plan.sessionId);
    assert.equal(s.outcome, "transferred");
    assert.equal(s.routing?.ringResult, "accepted");
    assert.equal(s.routing?.quiet, true);

    await h.engine.handleCallStatus({ callSid: "CA_routing_1", callStatus: "completed" });
    assert.deepEqual(h.summaries, [], "the contractor took the call: no summary");
    assert.deepEqual(h.recoveries, [], "and no missed-call text");
    assert.deepEqual(h.finalized, [], "and no CRM lead");
  });

  it("voicemail picks up (completed, no press 1): the AI takes the caller", async () => {
    const h = harness(growthConfig(MISSED));
    const plan = await ring(h);
    const after = await h.engine.handleDialResult({ sessionId: plan.sessionId!, dialStatus: "completed", callSid: "CA_routing_1", callStatus: "in-progress" });
    assert.deepEqual(verbs(after), ["gather"]);
    assert.match(spoken(after), /Nord Plomberie/);
    const s = await session(h, plan.sessionId);
    assert.equal(s.routing?.ringResult, "voicemail_or_unscreened");
    assert.equal(s.transfers[0]?.status, "no_answer");
    assert.equal(s.status, "in_progress");
  });

  for (const [label, status, result] of [
    ["no answer", "no-answer", "no_answer"],
    ["contractor declines", "busy", "busy"],
    ["line busy", "busy", "busy"],
    ["phone unreachable", "failed", "failed"],
    ["dial canceled", "canceled", "failed"],
  ] as const) {
    it(`${label}: the AI answers`, async () => {
      const h = harness(growthConfig(MISSED));
      const plan = await ring(h);
      const after = await h.engine.handleDialResult({ sessionId: plan.sessionId!, dialStatus: status, callSid: "CA_routing_1", callStatus: "in-progress" });
      assert.deepEqual(verbs(after), ["gather"]);
      const s = await session(h, plan.sessionId);
      assert.equal(s.routing?.ringResult, result);
      assert.equal(s.status, "in_progress");
    });
  }

  it("caller hangs up while the phone rings: a missed call, recovered by text, no AI", async () => {
    const h = harness(growthConfig(MISSED));
    const plan = await ring(h);
    const after = await h.engine.handleDialResult({ sessionId: plan.sessionId!, dialStatus: "no-answer", callSid: "CA_routing_1", callStatus: "completed" });
    assert.deepEqual(verbs(after), ["hangup"]);
    const s = await session(h, plan.sessionId);
    assert.equal(s.outcome, "caller_hung_up");
    await h.engine.handleCallStatus({ callSid: "CA_routing_1", callStatus: "completed" });
    assert.deepEqual(h.recoveries, ["CA_routing_1"], "missed-call text goes out");
    assert.equal(h.summaries.length, 1, "the owner hears about the missed call");
  });

  it("caller hangs up after reaching the receptionist: one summary, once", async () => {
    const h = harness(growthConfig(MISSED));
    const plan = await ring(h);
    await h.engine.handleDialResult({ sessionId: plan.sessionId!, dialStatus: "no-answer", callSid: "CA_routing_1", callStatus: "in-progress" });
    await h.engine.handleCallStatus({ callSid: "CA_routing_1", callStatus: "completed" });
    await h.engine.handleCallStatus({ callSid: "CA_routing_1", callStatus: "completed" });
    assert.equal(h.summaries.length, 1);
    assert.equal(h.finalized.length, 1);
  });

  it("a late dial result after the call was finalized changes nothing", async () => {
    const h = harness(growthConfig(MISSED));
    const plan = await ring(h);
    await h.engine.handleCallStatus({ callSid: "CA_routing_1", callStatus: "completed" });
    const late = await h.engine.handleDialResult({ sessionId: plan.sessionId!, dialStatus: "no-answer", callSid: "CA_routing_1" });
    assert.deepEqual(verbs(late), ["hangup"]);
    const s = await session(h, plan.sessionId);
    assert.equal(s.finalizedAt !== undefined, true);
    assert.equal(s.turns.filter((t) => t.speaker === "agent").length, 0, "the AI never started");
    assert.equal(h.summaries.length, 1);
  });

  it("screening callbacks for a finished ring are refused", async () => {
    const h = harness(growthConfig(MISSED));
    const plan = await ring(h);
    await h.engine.handleDialResult({ sessionId: plan.sessionId!, dialStatus: "no-answer", callSid: "CA_routing_1", callStatus: "in-progress" });
    const late = await h.engine.handleScreen({ sessionId: plan.sessionId!, phase: "result", digits: "1" });
    assert.deepEqual(verbs(late), ["hangup"]);
    assert.equal((await session(h, plan.sessionId)).routing?.acceptedAt, undefined);
  });

  it("a key other than 1 hangs up the contractor's leg", async () => {
    const h = harness(growthConfig(MISSED));
    const plan = await ring(h);
    const other = await h.engine.handleScreen({ sessionId: plan.sessionId!, phase: "result", digits: "2" });
    assert.deepEqual(verbs(other), ["hangup"]);
    const silent = await h.engine.handleScreen({ sessionId: plan.sessionId!, phase: "result" });
    assert.deepEqual(verbs(silent), ["hangup"]);
  });

  it("a screening callback from another call is refused (ParentCallSid mismatch)", async () => {
    const h = harness(growthConfig(MISSED));
    const plan = await ring(h);
    const wrong = await h.engine.handleScreen({ sessionId: plan.sessionId!, phase: "result", digits: "1", parentCallSid: "CA_other" });
    assert.deepEqual(verbs(wrong), ["hangup"]);
    assert.equal((await session(h, plan.sessionId)).routing?.acceptedAt, undefined);
  });

  it("a Twilio retry of the incoming webhook repeats the ring, with one session", async () => {
    const h = harness(growthConfig(MISSED));
    const a = await ring(h);
    const b = await ring(h);
    assert.equal(a.sessionId, b.sessionId);
    assert.ok(b.verbs[0]?.verb === "dial" && b.verbs[0].screen === true);
    assert.equal((await h.store.listSessions({})).length, 1);
  });

  it("without a contractor phone the AI answers, and the status says setup is required", async () => {
    const config = growthConfig({ ...MISSED, contractorPhoneE164: undefined });
    assert.equal(config.inboundStrategy, "ai_first");
    const h = harness(config);
    assert.deepEqual(verbs(await ring(h)), ["gather"]);
    const state = evaluateAiCallHandling({
      plan: "growth",
      activated: true,
      tradecatchNumberE164: TRADECATCH,
      phone: parsePhoneSettings({ ...MISSED, contractorPhoneE164: undefined }),
      livekitHandoffReady: false,
    });
    assert.equal(state.status, "setup_required");
    assert.equal(state.effectiveMode, "ai_answers_all");
    assert.ok(state.issues.includes("missing_contractor_phone"));
  });
});

describe("AI Answers All Calls", () => {
  it("answers immediately with the built-in receptionist", async () => {
    const h = harness(growthConfig(ALL));
    const plan = await ring(h);
    assert.deepEqual(verbs(plan), ["gather"]);
    assert.equal((await session(h, plan.sessionId)).routing?.mode, "ai_answers_all");
  });

  it("hands the call to the LiveKit agent over SIP when configured", async () => {
    const h = harness(growthConfig({ ...ALL, voiceEngine: "livekit" }), { livekit: true });
    const plan = await ring(h);
    assert.deepEqual(verbs(plan), ["sip_handoff"]);
    assert.doesNotMatch(JSON.stringify(plan), /password|secret/i, "no credential sits in a plan");
    const xml = twiml(plan, { host: "abc.sip.livekit.cloud", transport: "tls", username: "tc", password: "pw-1" });
    assert.match(xml, /<Dial action="[^"]+\/dial\?session=rcs_[^"]+" method="POST" timeout="20"><Sip username="tc" password="pw-1">sip:\+14385597100@abc\.sip\.livekit\.cloud;transport=tls<\/Sip><\/Dial>/);

    const connected = await h.engine.handleDialResult({ sessionId: plan.sessionId!, dialStatus: "completed", callSid: "CA_routing_1", callStatus: "completed" });
    assert.deepEqual(verbs(connected), ["hangup"]);
    const s = await session(h, plan.sessionId);
    assert.equal(s.routing?.handoff?.status, "connected");
    assert.equal(s.routing?.quiet, true);
    await h.engine.handleCallStatus({ callSid: "CA_routing_1", callStatus: "completed" });
    assert.deepEqual(h.summaries, [], "the LiveKit agent reports its own call: no duplicate");
    assert.deepEqual(h.recoveries, []);
  });

  it("falls back to the built-in receptionist when LiveKit does not answer", async () => {
    const h = harness(growthConfig({ ...ALL, voiceEngine: "livekit" }), { livekit: true });
    const plan = await ring(h);
    const after = await h.engine.handleDialResult({ sessionId: plan.sessionId!, dialStatus: "failed", callSid: "CA_routing_1", callStatus: "in-progress" });
    assert.deepEqual(verbs(after), ["gather"]);
    const s = await session(h, plan.sessionId);
    assert.equal(s.routing?.handoff?.status, "failed");
    assert.equal(s.routing?.quiet, undefined, "the built-in call is reported normally");
  });

  it("a retried incoming webhook repeats the hand-off, never a second agent call", async () => {
    const h = harness(growthConfig({ ...ALL, voiceEngine: "livekit" }), { livekit: true });
    const a = await ring(h);
    const b = await ring(h);
    assert.equal(a.sessionId, b.sessionId);
    assert.deepEqual(verbs(b), ["sip_handoff"]);
    assert.equal((await h.store.listSessions({})).length, 1);
  });

  it("without the LiveKit SIP settings the built-in receptionist answers", async () => {
    const h = harness(growthConfig({ ...ALL, voiceEngine: "livekit" }), { livekit: false });
    assert.deepEqual(verbs(await ring(h)), ["gather"]);
    // And a hand-off rendered with no target fails over instead of dropping the caller.
    const plan: VoicePlan = { sessionId: "rcs_x", verbs: [{ verb: "sip_handoff", next: "dial", target: "livekit", calledE164: TRADECATCH, timeoutSeconds: 20 }] };
    assert.match(twiml(plan, null), /<Redirect method="POST">[^<]+\/dial\?session=rcs_x<\/Redirect>/);
  });

  it("Missed Calls Only with LiveKit: no answer hands the caller to the agent", async () => {
    const h = harness(growthConfig({ ...MISSED, voiceEngine: "livekit" }), { livekit: true });
    const plan = await ring(h);
    assert.deepEqual(verbs(plan), ["dial"]);
    const after = await h.engine.handleDialResult({ sessionId: plan.sessionId!, dialStatus: "no-answer", callSid: "CA_routing_1", callStatus: "in-progress" });
    assert.deepEqual(verbs(after), ["sip_handoff"]);
  });
});

describe("changing modes", () => {
  it("switching modes changes the live routing and resets verification", () => {
    const base = parsePhoneSettings({
      ...defaultPhoneSettings(),
      ...ALL,
      tradecatchNumberE164: TRADECATCH,
      modeUpdatedAt: "2026-03-01T00:00:00.000Z",
      routingVerification: { mode: "ai_answers_all", method: "tradecatch_number", path: "ai_answered_webhook", verifiedAt: "2026-03-02T00:00:00.000Z" },
    });
    assert.equal(
      evaluateAiCallHandling({ plan: "growth", activated: true, tradecatchNumberE164: TRADECATCH, phone: base, livekitHandoffReady: false }).status,
      "verified",
    );
    const applied = applyAiCallHandlingUpdate({
      previous: base,
      update: aiCallHandlingUpdateSchema.parse({ aiCallMode: "missed_calls_only", routingMethod: "tradecatch_number", contractorPhoneE164: "514 555-0142" }),
      tradecatchNumberE164: TRADECATCH,
      now: NOW,
    });
    assert.ok(applied.ok);
    assert.equal(applied.phone.contractorPhoneE164, CONTRACTOR, "typed number normalized");
    assert.equal(applied.phone.inboundStrategy, "human_first");
    assert.equal(applied.routingChanged, true);
    const state = evaluateAiCallHandling({ plan: "growth", activated: true, tradecatchNumberE164: TRADECATCH, phone: applied.phone, livekitHandoffReady: false });
    assert.equal(state.status, "awaiting_test_call", "the old test call no longer proves anything");
    assert.equal(state.requestedMode, "missed_calls_only");

    const back = applyAiCallHandlingUpdate({
      previous: applied.phone,
      update: aiCallHandlingUpdateSchema.parse({ aiCallMode: "ai_answers_all", routingMethod: "tradecatch_number" }),
      tradecatchNumberE164: TRADECATCH,
      now: new Date(NOW.getTime() + 60_000),
    });
    assert.ok(back.ok);
    assert.equal(back.phone.inboundStrategy, "ai_first", "the contractor can switch back");
    const config = growthConfig(back.phone);
    assert.equal(config.inboundStrategy, "ai_first");
    assert.equal(config.ringFirstE164, undefined);
  });

  it("existing customers keep their behaviour until they save a mode", () => {
    const legacy = buildProfileConfig(profile({ inboundStrategy: "ai_first" }), { client });
    assert.equal(legacy.inboundStrategy, "ai_first");
    assert.equal(legacy.ringFirstE164, undefined);
    assert.equal(legacy.callScreening, false);
    const legacyHuman = buildProfileConfig(
      profile({ inboundStrategy: "human_first", humanTransferE164: "+14385597004" }),
      { client },
    );
    assert.equal(legacyHuman.inboundStrategy, "human_first");
    assert.equal(legacyHuman.callScreening, false, "no new screening for an old setup");
    assert.equal(legacyHuman.fallbackTransferE164, "+14385597004");
    const state = evaluateAiCallHandling({
      plan: "receptionist",
      activated: true,
      tradecatchNumberE164: TRADECATCH,
      phone: parsePhoneSettings({ inboundStrategy: "human_first" }),
      livekitHandoffReady: false,
    });
    assert.equal(state.modeSource, "legacy");
    assert.equal(state.requestedMode, "missed_calls_only");
    // A stored profile that predates the feature parses with no new fields set.
    const parsed = parsePhoneSettings({ inboundStrategy: "ai_first", aiEnabled: true });
    assert.equal(parsed.aiCallMode, undefined);
    assert.equal(parsed.personalContacts, undefined);
  });

  it("a new, not yet activated customer is offered Missed Calls Only", () => {
    const state = evaluateAiCallHandling({ plan: "growth", activated: false, tradecatchNumberE164: TRADECATCH, phone: defaultPhoneSettings(), livekitHandoffReady: false });
    assert.equal(state.requestedMode, "missed_calls_only");
    assert.equal(state.modeSource, "recommended");
    assert.equal(state.effectiveMode, "off");
    assert.equal(state.status, "not_configured");
  });
});

describe("plans", () => {
  it("Starter never gets voice", () => {
    const config = buildProfileConfig(profile(ALL), { client, capabilities: voiceCapabilitiesForPlan("starter") });
    assert.equal(config.enabled, false);
    const state = evaluateAiCallHandling({ plan: "starter", activated: true, tradecatchNumberE164: TRADECATCH, phone: parsePhoneSettings(ALL), livekitHandoffReady: true });
    assert.equal(state.status, "unsupported_plan");
    assert.equal(state.effectiveMode, "off");
  });

  it("Receptionist (growth) rings the owner's phone first even without live transfers", () => {
    const config = growthConfig(MISSED, { fallbackTransferE164: "+14385597004" });
    assert.equal(config.inboundStrategy, "human_first");
    assert.equal(config.ringFirstE164, CONTRACTOR);
    assert.equal(config.fallbackTransferE164, undefined, "AI transfers stay Plus-only");
    // A legacy human-first setup that relied on the transfer line still drops to AI first.
    const limited = applyVoicePlanLimits(
      { ...config, ringFirstE164: undefined },
      voiceCapabilitiesForPlan("growth"),
    );
    assert.equal(limited.inboundStrategy, "ai_first");
  });

  it("Receptionist Plus keeps transfers alongside ring-first", () => {
    const config = buildProfileConfig(profile(MISSED, { fallbackTransferE164: "+14385597004" }), {
      client,
      capabilities: voiceCapabilitiesForPlan("receptionist"),
    });
    assert.equal(config.ringFirstE164, CONTRACTOR);
    assert.equal(config.fallbackTransferE164, "+14385597004");
  });
});

describe("carrier forwarding and loops", () => {
  const FORWARDED: Partial<PhoneSettings> = {
    aiCallMode: "missed_calls_only",
    routingMethod: "carrier_forwarding",
    businessPhoneE164: CONTRACTOR,
    inboundStrategy: "human_first",
    humanTransferE164: CONTRACTOR,
  };

  it("never rings the forwarding phone first", async () => {
    const config = buildProfileConfig(profile(FORWARDED), { client, capabilities: voiceCapabilitiesForPlan("receptionist") });
    assert.equal(config.inboundStrategy, "ai_first");
    // Even a config that still says human_first does not ring with forwarding.
    const h = harness({ ...config, inboundStrategy: "human_first", fallbackTransferE164: "+14385597004" });
    const plan = await h.engine.startCall({ callSid: "CA_fwd", fromE164: CALLER, toE164: TRADECATCH, forwardedFromE164: CONTRACTOR });
    assert.deepEqual(verbs(plan), ["gather"]);
    assert.equal((await session(h, plan.sessionId)).routing?.forwardedFrom, CONTRACTOR);
  });

  it("drops transfer, emergency and department targets that are the forwarding phone", () => {
    const config = buildProfileConfig(
      profile(FORWARDED, {
        emergencyTransferE164: CONTRACTOR,
        fallbackTransferE164: CONTRACTOR,
        routing: [{ name: "Service", phoneE164: CONTRACTOR, keywords: [] }],
      }),
      { client, capabilities: voiceCapabilitiesForPlan("receptionist") },
    );
    assert.notEqual(config.fallbackTransferE164, CONTRACTOR);
    assert.notEqual(config.emergencyTransferE164, CONTRACTOR);
    assert.equal(config.routing.length, 0);
    const state = evaluateAiCallHandling({
      plan: "receptionist",
      activated: true,
      tradecatchNumberE164: TRADECATCH,
      phone: parsePhoneSettings(FORWARDED),
      livekitHandoffReady: false,
      transferTargets: [CONTRACTOR],
    });
    assert.ok(state.warnings.includes("transfer_target_is_forwarding_phone"));
  });

  it("the effective mode stays unknown until a forwarded test call is seen", () => {
    const phone = parsePhoneSettings({ ...FORWARDED, modeUpdatedAt: "2026-03-04T14:00:00.000Z", routingTestStartedAt: "2026-03-04T14:50:00.000Z" });
    const before = evaluateAiCallHandling({ plan: "growth", activated: true, tradecatchNumberE164: TRADECATCH, phone, livekitHandoffReady: false });
    assert.equal(before.effectiveMode, "unknown");
    assert.equal(before.status, "awaiting_test_call");
    assert.ok(before.warnings.includes("carrier_forwarding_unverifiable"));
    const result = observeTestCall({
      phone,
      mode: "missed_calls_only",
      sessions: [fakeSession({ startedAt: "2026-03-04T14:55:00.000Z", routing: { forwardedFrom: CONTRACTOR } })],
      now: NOW,
    });
    assert.equal(result.status, "verified");
    const after = evaluateAiCallHandling({
      plan: "growth",
      activated: true,
      tradecatchNumberE164: TRADECATCH,
      phone: { ...phone, routingVerification: result.status === "verified" ? result.verification : undefined },
      livekitHandoffReady: false,
    });
    assert.equal(after.status, "verified");
    assert.equal(after.effectiveMode, "missed_calls_only");
  });

  it("refuses ring-first and personal targets that would loop", () => {
    const loop = (update: Record<string, unknown>) =>
      applyAiCallHandlingUpdate({
        previous: defaultPhoneSettings(),
        update: aiCallHandlingUpdateSchema.parse(update),
        tradecatchNumberE164: TRADECATCH,
        now: NOW,
      });
    const a = loop({ aiCallMode: "missed_calls_only", routingMethod: "tradecatch_number", contractorPhoneE164: TRADECATCH });
    assert.ok(!a.ok && a.issues.some((i) => i.code === "loop_tradecatch_number"));
    const b = loop({ aiCallMode: "missed_calls_only", routingMethod: "carrier_forwarding", businessPhoneE164: CONTRACTOR, personalCallPolicy: "transfer", personalCallTransferE164: CONTRACTOR });
    assert.ok(!b.ok && b.issues.some((i) => i.code === "loop_forwarding_phone"));
    const c = loop({ aiCallMode: "ai_answers_all", routingMethod: "carrier_forwarding" });
    assert.ok(!c.ok && c.issues.some((i) => i.code === "required_for_forwarding"));
    const d = validateProfile(profile({ ...MISSED, contractorPhoneE164: TRADECATCH }), { client });
    assert.ok(!d.ok && d.issues.some((i) => i.field === "phoneSettings.contractorPhoneE164"));
  });
});

describe("personal contacts", () => {
  const withContacts = (policy: Partial<PhoneSettings>) =>
    growthConfig({
      ...MISSED,
      personalContacts: [{ e164: FRIEND, label: "Maman" }],
      ...policy,
    });

  it("normalizes typed numbers to E.164 and drops duplicates", () => {
    assert.equal(normalizeContactE164("(514) 555-1111"), FRIEND);
    assert.equal(normalizeContactE164("1 514 555 1111"), FRIEND);
    assert.equal(normalizeContactE164("+44 20 7946 0958"), "+442079460958");
    assert.equal(normalizeContactE164("555-1111"), null);
    const parsed = parsePhoneSettings({
      personalContacts: [{ e164: "514-555-1111" }, { e164: "+15145551111", label: "x" }],
    });
    assert.deepEqual(parsed.personalContacts?.map((c) => c.e164), [FRIEND]);
  });

  it("message policy: a short message, no AI, no ring, nothing sent to the owner", async () => {
    const h = harness(withContacts({ personalCallPolicy: "message", personalCallMessage: { fr: "Salut, je te rappelle." } }));
    const plan = await ring(h, "CA_friend", "514-555-1111");
    assert.deepEqual(verbs(plan), ["say", "say", "hangup"]);
    assert.match(spoken(plan), /Salut, je te rappelle\./);
    const s = await session(h, plan.sessionId);
    assert.equal(s.routing?.callerPolicy, "personal_message");
    assert.equal(s.turns.length, 0, "the receptionist never spoke");
    await h.engine.handleCallStatus({ callSid: "CA_friend", callStatus: "completed" });
    assert.deepEqual(h.summaries, []);
    assert.deepEqual(h.recoveries, []);
    assert.deepEqual(h.finalized, []);
  });

  it("transfer policy rings the approved line, and never falls into the AI", async () => {
    const h = harness(withContacts({ personalCallPolicy: "transfer", personalCallTransferE164: "+14385597004" }));
    const plan = await ring(h, "CA_friend", FRIEND);
    assert.ok(plan.verbs[0]?.verb === "dial" && plan.verbs[0].phoneE164 === "+14385597004");
    assert.equal(plan.verbs[0]?.verb === "dial" && plan.verbs[0].screen, undefined);
    const missed = await h.engine.handleDialResult({ sessionId: plan.sessionId!, dialStatus: "no-answer", callSid: "CA_friend", callStatus: "in-progress" });
    assert.deepEqual(verbs(missed), ["say", "say", "hangup"], "the default message, not the receptionist");
    await h.engine.handleCallStatus({ callSid: "CA_friend", callStatus: "completed" });
    assert.deepEqual(h.summaries, []);
  });

  it("end policy hangs up at once", async () => {
    const h = harness(withContacts({ personalCallPolicy: "end" }));
    assert.deepEqual(verbs(await ring(h, "CA_friend", FRIEND)), ["hangup"]);
  });

  it("other callers are unaffected", async () => {
    const h = harness(withContacts({ personalCallPolicy: "end" }));
    assert.deepEqual(verbs(await ring(h)), ["dial"]);
  });

  it("withheld numbers follow their own policy", async () => {
    for (const hidden of ["anonymous", "+266696687", "", "Restricted"]) {
      assert.equal(callerE164(hidden), null, hidden);
    }
    const asked = harness(growthConfig({ ...ALL, unknownCallerPolicy: "message" }));
    const plan = await ring(asked, "CA_anon", "anonymous");
    assert.deepEqual(verbs(plan), ["say", "say", "hangup"]);
    assert.match(spoken(plan), /numéro masqué/);
    const normal = harness(growthConfig(ALL));
    assert.deepEqual(verbs(await ring(normal, "CA_anon", "anonymous")), ["gather"], "default: answer");
  });

  it("a spoofed match can only reduce what the call does", () => {
    const base = { phoneNumberE164: TRADECATCH, personalContacts: [FRIEND], personalCallPolicy: "transfer" as const, unknownCallerPolicy: "ai" as const };
    assert.deepEqual(callerPolicyFor({ ...base, personalCallTransferE164: TRADECATCH }, FRIEND), { kind: "personal_message" }, "never back to the dialed number");
    assert.deepEqual(callerPolicyFor({ ...base, personalCallTransferE164: FRIEND }, FRIEND), { kind: "personal_message" }, "never back to the caller");
    assert.deepEqual(callerPolicyFor({ ...base, personalCallTransferE164: undefined }, FRIEND), { kind: "personal_message" });
  });

  it("the contact list never reaches the voice agent's config", () => {
    const config = withContacts({ personalCallPolicy: "message" });
    assert.deepEqual(config.personalContacts, [FRIEND]);
    // The agent config is built field by field; the list has no path into it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { buildAgentConfig } = require("../../src/product/receptionist/agent-config") as typeof import("../../src/product/receptionist/agent-config");
    const agent = JSON.stringify(buildAgentConfig(config, NOW, { mode: "standard" } as never));
    assert.doesNotMatch(agent, /5145551111|Maman/);
  });
});

describe("routing verification and the read-only number check", () => {
  it("only a matching path verifies a mode", () => {
    const phone = parsePhoneSettings({ ...MISSED, routingTestStartedAt: "2026-03-04T14:50:00.000Z" });
    const aiOnly = observeTestCall({ phone, mode: "missed_calls_only", sessions: [fakeSession({ startedAt: "2026-03-04T14:51:00.000Z" })], now: NOW });
    assert.deepEqual(aiOnly, { status: "other_path", path: "ai_answered_webhook" });
    const rang = observeTestCall({
      phone,
      mode: "missed_calls_only",
      sessions: [fakeSession({ startedAt: "2026-03-04T14:51:00.000Z", transfers: [{ at: "", targetId: "primary", targetName: "", phoneE164: CONTRACTOR, reason: "human_first", status: "no_answer" }] })],
      now: NOW,
    });
    assert.equal(rang.status, "verified");
    const before = observeTestCall({ phone, mode: "missed_calls_only", sessions: [fakeSession({ startedAt: "2026-03-04T14:00:00.000Z" })], now: NOW });
    assert.equal(before.status, "waiting", "calls before the test started do not count");
    const late = observeTestCall({ phone, mode: "missed_calls_only", sessions: [], now: new Date("2026-03-04T16:00:00Z") });
    assert.equal(late.status, "expired");
    const personal = observeTestCall({ phone, mode: "missed_calls_only", sessions: [fakeSession({ startedAt: "2026-03-04T14:51:00.000Z", routing: { callerPolicy: "personal_end" } })], now: NOW });
    assert.equal(personal.status, "waiting", "personal-contact calls are not test calls");
    const lk = observeTestCall({ phone: parsePhoneSettings({ ...ALL, routingTestStartedAt: "2026-03-04T14:50:00.000Z" }), mode: "ai_answers_all", sessions: [fakeSession({ startedAt: "2026-03-04T14:51:00.000Z", callSid: "lk_call-1" })], now: NOW });
    assert.ok(lk.status === "verified" && lk.verification.path === "ai_answered_livekit_direct");
  });

  it("a SIP-trunk number cannot run Missed Calls Only", () => {
    const state = evaluateAiCallHandling({
      plan: "growth",
      activated: true,
      tradecatchNumberE164: TRADECATCH,
      phone: parsePhoneSettings(MISSED),
      numberRouting: "sip_trunk",
      livekitHandoffReady: true,
    });
    assert.equal(state.status, "setup_required");
    assert.equal(state.effectiveMode, "ai_answers_all");
    assert.ok(state.issues.includes("number_routed_to_sip_trunk"));
  });

  it("classifies the number's routing from one read-only lookup", async () => {
    assert.equal(classifyNumberRouting({ trunk_sid: "TK123" }, null), "sip_trunk");
    assert.equal(classifyNumberRouting({ voice_url: "https://app.tradecatch.ca/api/webhooks/twilio/voice" }, "https://app.tradecatch.ca"), "webhook");
    assert.equal(classifyNumberRouting({ voice_url: "https://evil.example/api/webhooks/twilio/voice" }, "https://app.tradecatch.ca"), "elsewhere");
    assert.equal(classifyNumberRouting({ voice_url: "https://handler.twilio.com/twiml/EH1" }, null), "elsewhere");
    assert.equal(classifyNumberRouting(null, null), "unknown");

    assert.equal(await checkNumberRouting(TRADECATCH, { env: {} as NodeJS.ProcessEnv }), "unknown", "no credentials, no request");
    const requests: { url: string; method?: string }[] = [];
    const env = { TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`, TWILIO_AUTH_TOKEN: "tok" } as unknown as NodeJS.ProcessEnv;
    const result = await checkNumberRouting(TRADECATCH, {
      env,
      fetch: async (url, init) => {
        requests.push({ url, method: init?.method });
        return new Response(JSON.stringify({ incoming_phone_numbers: [{ trunk_sid: "TK1" }] }), { status: 200 });
      },
    });
    assert.equal(result, "sip_trunk");
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.method, "GET", "the check never writes");
    assert.match(requests[0]!.url, /IncomingPhoneNumbers\.json\?PhoneNumber=%2B14385597100/);
    const failed = await checkNumberRouting(TRADECATCH, { env, fetch: async () => new Response("no", { status: 500 }) });
    assert.equal(failed, "unknown");
  });

  it("validates the LiveKit SIP settings and never builds a URI from caller input", () => {
    assert.deepEqual(livekitSipConfig({}), { ok: false, problem: "missing_host" });
    assert.deepEqual(livekitSipConfig({ RECEPTIONIST_LIVEKIT_SIP_HOST: "sip://x" }), { ok: false, problem: "invalid_host" });
    assert.deepEqual(livekitSipConfig({ RECEPTIONIST_LIVEKIT_SIP_HOST: "a.sip.livekit.cloud", RECEPTIONIST_LIVEKIT_SIP_USERNAME: "u" }), { ok: false, problem: "incomplete_credentials" });
    assert.deepEqual(livekitSipConfig({ RECEPTIONIST_LIVEKIT_SIP_HOST: "a.sip.livekit.cloud", RECEPTIONIST_LIVEKIT_SIP_TRANSPORT: "ws" }), { ok: false, problem: "invalid_transport" });
    const ok = livekitSipConfig({ RECEPTIONIST_LIVEKIT_SIP_HOST: "a.sip.livekit.cloud" });
    assert.ok(ok.ok);
    if (ok.ok) {
      assert.equal(livekitSipUri(TRADECATCH, ok.target), "sip:+14385597100@a.sip.livekit.cloud");
      assert.equal(livekitSipUri("+1438@evil.example", ok.target), null);
      assert.equal(livekitSipUri("sip:x", ok.target), null);
    }
  });

  it("ring-first comes only from an explicit mode", () => {
    assert.equal(callRoutingForProfile(parsePhoneSettings({}), TRADECATCH).ringFirstE164, undefined);
    assert.equal(callRoutingForProfile(parsePhoneSettings(MISSED), TRADECATCH).ringFirstE164, CONTRACTOR);
    assert.equal(callRoutingForProfile(parsePhoneSettings({ ...MISSED, contractorPhoneE164: TRADECATCH }), TRADECATCH).ringFirstE164, undefined);
  });
});

function fakeSession(over: Partial<CallSession>): CallSession {
  return {
    id: `rcs_${Math.random().toString(36).slice(2)}`,
    callSid: "CA_fake",
    configId: "rc_org_org_routing",
    clientAccountId: client.id,
    fromE164: CALLER,
    toE164: TRADECATCH,
    language: "fr",
    status: "completed",
    step: "done",
    afterHours: false,
    slots: {},
    turns: [],
    silenceCount: 0,
    callerTurnCount: 0,
    transfers: [],
    notifications: [],
    startedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    version: 1,
    ...over,
  };
}

describe("call history", () => {
  it("shows a LiveKit-handled call once (the agent's report), not its routing record", async () => {
    const { ownerVisibleCalls } = await import("../../src/product/receptionist/call-history");
    const record = fakeSession({ routing: { handoff: { target: "livekit", status: "connected", at: NOW.toISOString() }, quiet: true } });
    const report = fakeSession({ callSid: "lk_call-1" });
    const failedHandoff = fakeSession({ routing: { handoff: { target: "livekit", status: "failed", at: NOW.toISOString() } } });
    assert.deepEqual(
      ownerVisibleCalls([record, report, failedHandoff]).map((s) => s.id),
      [report.id, failedHandoff.id],
    );
  });
});
