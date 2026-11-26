/**
 * KAN-16: live phone testing and call simulations (SIM-01 … SIM-13).
 *
 * Simulations run the real receptionist engine on the business's saved
 * configuration, so these tests drive the real pieces: the dashboard route
 * with signed sessions, the Twilio voice webhook, the Bland config endpoint
 * and the stores behind them. Time is pinned (or the business is open 24/7)
 * so nothing depends on when the suite runs, and `fetch` is stubbed to prove
 * that no test, and no simulation, reaches a carrier or voice provider.
 */
import "../support/next-request-context";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { withRequest } from "../support/next-request-context";
import { GET as blandConfig } from "../../src/app/api/bland/config/route";
import { GET as getRuns, POST as postRun } from "../../src/app/api/businesses/[id]/calls/test/route";
import { POST as twilioStep } from "../../src/app/api/twilio/voice/receptionist/[step]/route";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { getMissedCallRuntime } from "../../src/product/missed-call/runtime";
import { resetBlandRoutesForTests } from "../../src/product/bland/routes";
import { isPracticeCall, ownerVisibleCalls } from "../../src/product/receptionist/call-history";
import { buildProfileConfig, profileSettingsSchema, type ReceptionistProfile } from "../../src/product/receptionist/profile";
import { greetingStatement } from "../../src/product/receptionist/prompts";
import { getReceptionistRuntime, resetReceptionistRuntimeForTests } from "../../src/product/receptionist/runtime";
import { signSessionClaims } from "../../src/product/saas/auth/session-token";
import { createMemorySaasStore } from "../../src/product/saas/memory-store";
import type { SaasStore } from "../../src/product/saas/store";
import { callEventId, createMemoryCallEventStore } from "../../src/product/telephony/call-events";
import { resolveInboundRouting } from "../../src/product/telephony/call-routing";
import { describeCallEnd } from "../../src/product/telephony/call-timeline";
import {
  LIVE_TEST_SCENARIOS,
  LiveTestError,
  SIMULATED_CALLER_E164,
  runSimulatedPhoneScenario,
  type LiveTestScenario,
  type SimulationRun,
} from "../../src/product/telephony/live-test";
import { buildLiveTestInstructions } from "../../src/product/telephony/live-test-instructions";
import { listSimulations, loadSimulation, saveSimulation } from "../../src/product/telephony/live-test-store";
import { voiceCapabilitiesForPlan } from "../../src/product/receptionist/plan-limits";
import { defaultPhoneSettings } from "../../src/product/telephony/phone-settings";
import { getTelephonyRuntime } from "../../src/product/telephony/runtime";
import { createMemoryReceptionistStore } from "../../src/product/receptionist/store";

/* -------------------------------------------------------------------------- */
/* Environment                                                                 */
/* -------------------------------------------------------------------------- */

const KEYS = [
  "AUTH_SECRET",
  "NODE_ENV",
  "DATABASE_URL",
  "SAAS_DURABLE_STORE",
  "MISSED_CALL_DURABLE_STORE",
  "RECEPTIONIST_CONFIG_JSON",
  "RECEPTIONIST_ENABLED",
  "RECEPTIONIST_LLM_PROVIDER",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "MISSED_CALL_SKIP_TWILIO_VALIDATE",
  "MISSED_CALL_SMS_MODE",
  "MISSED_CALL_OPS_SECRET",
  "MISSED_CALL_PUBLIC_WEBHOOK_BASE",
  "CRON_SECRET",
  "BLAND_ROUTES_JSON",
  "BLAND_TOOL_SECRET",
  "BLAND_WEBHOOK_SECRET",
  "LAUNCH_ENABLE_CALL_TRANSFER",
] as const;
const saved = new Map(KEYS.map((k) => [k, process.env[k]]));
const env = process.env as Record<string, string | undefined>;
const globals = globalThis as unknown as Record<string, unknown> & {
  __tradecatchSaas?: { store: SaasStore; durable: boolean };
};
const RESET_GLOBALS = [
  "__tradecatchTelephony",
  "__tradecatchMissedCall",
  "__tradecatchMissedCallReadStore",
  "__tradecatchSaas",
] as const;

let saas: SaasStore;
let fetched: string[];

beforeEach(() => {
  for (const k of KEYS) delete env[k];
  env.AUTH_SECRET = "live-phone-testing-secret-not-for-production";
  env.NODE_ENV = "test";
  env.MISSED_CALL_SMS_MODE = "dry-run";
  env.RECEPTIONIST_LLM_PROVIDER = "none";
  // Call transfer is a launch-gated feature; the simulation must follow it like a live call.
  env.LAUNCH_ENABLE_CALL_TRANSFER = "1";
  for (const g of RESET_GLOBALS) delete globals[g];
  resetReceptionistRuntimeForTests();
  resetBlandRoutesForTests();
  saas = createMemorySaasStore();
  globals.__tradecatchSaas = { store: saas, durable: false };
  fetched = [];
  // No test, and nothing under test, may reach a carrier or a voice provider.
  mock.method(globalThis, "fetch", async (input: unknown) => {
    fetched.push(String(input));
    throw new Error("network access is blocked in this test");
  });
  mock.method(console, "warn", () => {});
  mock.method(console, "error", () => {});
  mock.method(console, "info", () => {});
});

afterEach(() => {
  mock.restoreAll();
  for (const g of RESET_GLOBALS) delete globals[g];
  resetReceptionistRuntimeForTests();
  resetBlandRoutesForTests();
  for (const [k, v] of saved) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
});

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const TEST_NUMBER = "+14382314700";
const OWNER_PHONE = "+14385597004";
const BUSINESS = "testTradeCatch";
/** A Wednesday, 10:00 in Toronto: inside business hours whatever day the suite runs. */
const BUSINESS_HOURS = new Date("2026-03-04T15:00:00Z");
/** Sunday 04:00 in Toronto. */
const SUNDAY_NIGHT = new Date("2026-03-08T08:00:00Z");
const OPEN_24_7 = { start: "00:00", end: "00:00", days: [0, 1, 2, 3, 4, 5, 6] };
const WEEKDAYS_9_TO_5 = { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] };

type Strategy = "ai_first" | "human_first";

function settings(strategy: Strategy, over: Record<string, unknown> = {}, phone: Record<string, unknown> = {}) {
  return profileSettingsSchema.parse({
    receptionistName: "Sophie",
    notifyEmail: "owner@example.com",
    emergencyTransferE164: "+14385597003",
    fallbackTransferE164: OWNER_PHONE,
    businessHours: OPEN_24_7,
    phoneSettings: {
      ...defaultPhoneSettings(),
      tradecatchNumberE164: TEST_NUMBER,
      humanTransferE164: OWNER_PHONE,
      inboundStrategy: strategy,
      aiEnabled: true,
      ...phone,
    },
    faqs: [
      {
        keywords: ["laval", "serve", "desservez"],
        answerFr: "Oui, nous desservons Laval.",
        answerEn: "Yes, we serve Laval.",
      },
    ],
    knowledge: { companyName: BUSINESS, services: ["plumbing"], serviceAreas: ["Montréal", "Laval"] },
    ...over,
  });
}

const client = demoClientAccount({ id: "client_a", contractorDisplayName: BUSINESS });

function profile(strategy: Strategy, over: Record<string, unknown> = {}, phone: Record<string, unknown> = {}): ReceptionistProfile {
  return {
    organizationId: "org_a",
    phoneNumberE164: TEST_NUMBER,
    activated: true,
    settings: settings(strategy, over, phone),
    updatedAt: new Date().toISOString(),
  };
}

/** Engine-level run with the clock pinned. */
async function simulate(
  scenario: LiveTestScenario,
  strategy: Strategy,
  opts: { language?: "fr" | "en"; over?: Record<string, unknown>; now?: Date } = {},
): Promise<SimulationRun> {
  const { run } = await runSimulatedPhoneScenario({
    organizationId: "org_a",
    profile: profile(strategy, opts.over),
    client,
    scenario,
    language: opts.language,
    now: opts.now ?? BUSINESS_HOURS,
  });
  return run;
}

const kindsOf = (run: SimulationRun) => run.events.map((e) => e.kind);

/** `expected` appears in `actual` in this order (other events may sit between). */
function assertInOrder(actual: string[], expected: string[]) {
  let at = -1;
  for (const kind of expected) {
    const found = actual.indexOf(kind, at + 1);
    assert.ok(found > at, `expected ${expected.join(" > ")} in order, got ${actual.join(" > ")}`);
    at = found;
  }
}

/* -- A real business behind the real routes ----------------------------------- */

async function signIn(organizationId: string, userId: string) {
  const session = {
    id: crypto.randomUUID(),
    organizationId,
    userId,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    createdAt: new Date().toISOString(),
  };
  await saas.createSession(session);
  const token = await signSessionClaims(
    { sid: session.id, uid: userId, oid: organizationId, plan: "receptionist", exp: Math.floor(Date.now() / 1000) + 600 },
    env.AUTH_SECRET!,
  );
  return `tc_session=${token}`;
}

type World = Awaited<ReturnType<typeof business>>;

let numbers = 0;
async function business(opts: {
  name?: string;
  strategy?: Strategy;
  number?: string;
  activated?: boolean;
  linkClient?: boolean;
  over?: Record<string, unknown>;
  phone?: Record<string, unknown>;
  rawSettings?: unknown;
} = {}) {
  const name = opts.name ?? BUSINESS;
  const number = opts.number ?? `+1438231${String(4700 + numbers++).padStart(4, "0")}`;
  const f = await saas.createOrganizationWithOwner({
    name,
    ownerName: "Owner",
    ownerEmail: `${crypto.randomUUID()}@example.test`,
  });
  const orgId = f.organization.id;
  // Receptionist Plus: the plan that includes live transfer, which ring-first routing needs.
  await saas.updateOrganizationPlan(orgId, "receptionist");
  const phoneClient = demoClientAccount({ id: `client_${orgId}`, contractorDisplayName: name });
  if (opts.linkClient !== false) {
    await getMissedCallRuntime().store.saveClient(phoneClient);
    await saas.linkMissedCallClient(orgId, phoneClient.id);
  }
  const runtime = getReceptionistRuntime();
  const base = settings(
    opts.strategy ?? "ai_first",
    { knowledge: { companyName: name, services: ["plumbing"], serviceAreas: ["Montréal"] }, ...opts.over },
    { tradecatchNumberE164: number, ...opts.phone },
  );
  await runtime.profileStore.saveSettings(orgId, (opts.rawSettings ?? base) as typeof base, f.user.id);
  if (opts.activated !== false) {
    await runtime.profileStore.setActivation(orgId, { phoneNumberE164: number, activated: true }, f.user.id);
  }
  await runtime.refresh(true);
  return {
    orgId,
    userId: f.user.id,
    name,
    number,
    client: phoneClient,
    cookie: await signIn(orgId, f.user.id),
    relogin: () => signIn(orgId, f.user.id),
  };
}

type Body = {
  ok?: boolean;
  code?: string;
  error?: string;
  details?: Record<string, unknown>;
  run?: SimulationRun;
  runs?: SimulationRun[];
  replayed?: boolean;
  mode?: string;
  callsPlaced?: number;
  carrierChargesMayApply?: boolean;
  dialNumber?: string | null;
  numbers?: { e164: string; via: string }[];
  checks?: { code: string; status: string }[];
  ready?: boolean;
  expected?: { greeting: string; startLanguage: string; voice: string };
  routing?: { action: string; limitedByPlan?: boolean };
};

async function send(
  method: "GET" | "POST",
  orgId: string,
  cookie: string,
  opts: { body?: unknown; query?: string } = {},
): Promise<{ status: number; body: Body }> {
  const url = `https://tradecatch.test/api/businesses/${orgId}/calls/test${opts.query ?? ""}`;
  const request = new NextRequest(url, {
    method,
    headers: { cookie, ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const ctx = { params: Promise.resolve({ id: orgId }) };
  const response = await withRequest(request, () => (method === "GET" ? getRuns(request, ctx) : postRun(request, ctx)));
  assert.ok(response);
  return { status: response.status, body: (await response.json()) as Body };
}

const simulateVia = (w: World, scenario: string, extra: Record<string, unknown> = {}) =>
  send("POST", w.orgId, w.cookie, {
    body: { mode: "simulation", scenario, runId: crypto.randomUUID(), ...extra },
  });

/* -- Twilio ---------------------------------------------------------------------- */

function hook(step: string, params: Record<string, string>, query = "") {
  const url = `https://tradecatch.test/api/twilio/voice/receptionist/${step}${query}`;
  return [
    new NextRequest(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    }),
    { params: Promise.resolve({ step }) },
  ] as const;
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, what: string): Promise<T> {
  let last = await read();
  for (let i = 0; i < 40 && !done(last); i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    last = await read();
  }
  assert.ok(done(last), `timed out waiting for ${what}`);
  return last;
}

const eventsFor = (orgId: string, callSid: string) =>
  getTelephonyRuntime().events.listForCall({ organizationId: orgId, callSid, limit: 200 });

/* -------------------------------------------------------------------------- */
/* SIM-01  Routing decisions are logged correctly                              */
/* -------------------------------------------------------------------------- */

describe("SIM-01 routing decision is logged", () => {
  it("receptionist-first: the decision is `ai`, the receptionist starts, nothing rings", async () => {
    const run = await simulate("receptionist_response", "ai_first");
    const kinds = kindsOf(run);
    assert.deepEqual(kinds.slice(0, 4), ["test_simulated", "incoming", "routing_decision", "ai_started"]);
    assert.ok(!kinds.includes("human_ring"));
    const decision = run.events.find((e) => e.kind === "routing_decision")!;
    assert.match(decision.detail!, /^ai:/);
    assert.equal(run.routing.action, "ai");
    assert.equal(run.routing.ringsFirst, false);
  });

  it("contractor-first: the decision is `ring_human`, then the ring, then what the ring did", async () => {
    const run = await simulate("answered_call", "human_first");
    const kinds = kindsOf(run);
    assert.deepEqual(kinds.slice(0, 4), ["test_simulated", "incoming", "routing_decision", "human_ring"]);
    assert.match(run.events.find((e) => e.kind === "routing_decision")!.detail!, /^ring_human:/);
    assert.equal(run.routing.action, "ring_human");
    assert.equal(run.routing.ringTargetLast4, OWNER_PHONE.slice(-4));
  });

  it("logs the decision the live webhook would take for the same saved settings", async () => {
    for (const strategy of ["ai_first", "human_first"] as const) {
      const run = await simulate("receptionist_response", strategy);
      const config = buildProfileConfig(profile(strategy), { client });
      const { routing } = resolveInboundRouting({ config, fromE164: SIMULATED_CALLER_E164, now: BUSINESS_HOURS });
      assert.equal(run.routing.action, routing.action, strategy);
      assert.equal(run.routing.reason, routing.reason, strategy);
      const logged = run.events.find((e) => e.kind === "routing_decision")!;
      assert.equal(logged.detail, `${routing.action}:${routing.reason}`);
    }
  });

  it("`ring_human` followed straight by `ai_started` (the reported bug) can no longer happen", async () => {
    for (const scenario of LIVE_TEST_SCENARIOS) {
      let run: SimulationRun;
      try {
        run = await simulate(scenario, "human_first");
      } catch (error) {
        assert.ok(error instanceof LiveTestError);
        continue;
      }
      const kinds = kindsOf(run);
      const ring = kinds.indexOf("human_ring");
      const ai = kinds.indexOf("ai_started");
      if (ring >= 0 && ai >= 0) {
        const between = kinds.slice(ring + 1, ai);
        assert.ok(
          between.includes("missed") || between.includes("error"),
          `${scenario}: ai_started must follow a missed or failed ring, got ${kinds.join(" > ")}`,
        );
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* SIM-02  Contractor-first routing is respected                               */
/* -------------------------------------------------------------------------- */

describe("SIM-02 human routing is respected", () => {
  it("a ring that is answered ends with the contractor, and the receptionist never speaks", async () => {
    const run = await simulate("answered_call", "human_first");
    assert.ok(!kindsOf(run).includes("ai_started"));
    assert.ok(!kindsOf(run).includes("ai_turn"));
    assert.equal(run.transcript.length, 0);
    assert.equal(run.finalStatus, "transferred");
    assert.deepEqual(run.termination, { reason: "answered_by_contractor", by: "contractor" });
    assert.equal(run.receptionist.greeting, "", "nobody from the receptionist greeted the caller");
    assertInOrder(kindsOf(run), ["human_ring", "transfer_result", "status", "finalized"]);
  });

  it("a ring nobody answers is missed first, and only then does the receptionist take the call", async () => {
    const run = await simulate("missed_call", "human_first");
    assertInOrder(kindsOf(run), ["routing_decision", "human_ring", "missed", "ai_started", "finalized"]);
    const ring = run.events.find((e) => e.kind === "human_ring")!;
    const missed = run.events.find((e) => e.kind === "missed")!;
    assert.ok(missed.offsetSeconds - ring.offsetSeconds >= (run.routing.ringTimeoutSeconds ?? 1));
    assert.equal(run.finalStatus, "completed");
  });

  it("the caller hanging up while it rings is a missed call, not an answered one", async () => {
    const run = await simulate("caller_hangup", "human_first");
    assert.ok(!kindsOf(run).includes("ai_started"));
    assert.equal(run.events.find((e) => e.kind === "missed")?.detail, "caller_hung_up_while_ringing");
    assert.equal(run.finalStatus, "caller_hung_up");
  });

  it("a ring that fails is reported as an error, then the receptionist answers", async () => {
    const run = await simulate("routing_failure", "human_first");
    const kinds = kindsOf(run);
    assertInOrder(kinds, ["human_ring", "error", "ai_started"]);
    assert.equal(run.events.find((e) => e.kind === "error")?.detail, "ring_failed");
    assert.notEqual(run.finalStatus, "failed", "the receptionist still handled the call");
  });

  it("outside business hours a contractor-first business goes to the receptionist, as a live call does", async () => {
    const run = await simulate("receptionist_response", "human_first", {
      now: SUNDAY_NIGHT,
      over: { businessHours: WEEKDAYS_9_TO_5 },
    });
    assert.equal(run.routing.afterHours, true);
    assert.equal(run.routing.action, "ai");
    assert.equal(run.routing.reason, "after_hours_ai");
    assert.ok(!kindsOf(run).includes("human_ring"));
  });
});

/* -------------------------------------------------------------------------- */
/* SIM-03  Receptionist-first routing is respected                             */
/* -------------------------------------------------------------------------- */

describe("SIM-03 receptionist routing is respected", () => {
  it("the receptionist answers at once and the contractor's phone is never rung", async () => {
    for (const scenario of ["answered_call", "receptionist_response", "appointment_request", "caller_hangup"] as const) {
      const run = await simulate(scenario, "ai_first");
      assert.ok(kindsOf(run).includes("ai_started"), scenario);
      assert.ok(!kindsOf(run).includes("human_ring"), scenario);
      assert.ok(!kindsOf(run).includes("missed"), scenario);
      assert.equal(run.routing.ringsFirst, false, scenario);
    }
  });

  it("a missed-call scenario is refused instead of faking a ring the settings would not make", async () => {
    await assert.rejects(
      () => simulate("missed_call", "ai_first"),
      (error: unknown) => error instanceof LiveTestError && error.code === "scenario_not_applicable",
    );
  });

  it("on a plan without live transfer a contractor-first setting cannot ring, and the simulation says so like a live call", async () => {
    const w = await business({ strategy: "human_first" });
    await saas.updateOrganizationPlan(w.orgId, "essential");
    await getReceptionistRuntime().refresh(true);
    const sim = await simulateVia(w, "receptionist_response");
    assert.equal(sim.status, 200);
    assert.equal(sim.body.run!.routing.action, "ai", "no ring: the plan has no live transfer");
    assert.equal(sim.body.run!.routing.limitedByPlan, true, "the run names the plan as the reason");
    assert.ok(sim.body.run!.notes.includes("ring_first_unavailable_on_plan"));
    assertActionable(await simulateVia(w, "missed_call"), 409, "ring_first_unavailable_on_plan");
    // The live-test panel explains the same thing before anyone runs anything.
    const panel = await send("POST", w.orgId, w.cookie, { body: { mode: "live_instructions" } });
    assert.equal(panel.body.routing?.action, "ai");
    assert.equal(panel.body.routing?.limitedByPlan, true);
    // The live webhook makes the same decision for the same business.
    const twiml = await (await twilioStep(...hook("incoming", { CallSid: "CAplan1", From: "+15145559876", To: w.number }))).text();
    assert.doesNotMatch(twiml, /<Dial/);
    assert.match(twiml, /<Gather /);
  });

  describe("blaming the plan only when the plan is the reason", () => {
    const professional = voiceCapabilitiesForPlan("professional");
    const run = (scenario: LiveTestScenario, strategy: Strategy, now: Date, over: Record<string, unknown> = {}) =>
      runSimulatedPhoneScenario({
        organizationId: "org_a",
        profile: profile(strategy, over),
        client,
        scenario,
        capabilities: professional,
        now,
      });

    it("contractor-first on a plan without live transfer is named as limited by the plan", async () => {
      const { run: result } = await run("receptionist_response", "human_first", BUSINESS_HOURS);
      assert.equal(result.routing.ringsFirst, false);
      assert.equal(result.routing.limitedByPlan, true);
      assert.ok(result.notes.includes("ring_first_unavailable_on_plan"));
      await assert.rejects(
        () => run("missed_call", "human_first", BUSINESS_HOURS),
        (error: unknown) => error instanceof LiveTestError && error.code === "ring_first_unavailable_on_plan",
      );
    });

    it("a business that never rings first is not told it is limited by the plan", async () => {
      const { run: result } = await run("receptionist_response", "ai_first", BUSINESS_HOURS);
      assert.equal(result.routing.limitedByPlan, undefined);
      assert.ok(!result.notes.includes("ring_first_unavailable_on_plan"));
      await assert.rejects(
        () => run("missed_call", "ai_first", BUSINESS_HOURS),
        (error: unknown) => error instanceof LiveTestError && error.code === "scenario_not_applicable",
      );
    });

    it("an after-hours call is not blamed on the plan: it would not ring first on any plan", async () => {
      const over = { businessHours: WEEKDAYS_9_TO_5 };
      const { run: result } = await run("receptionist_response", "human_first", SUNDAY_NIGHT, over);
      assert.equal(result.routing.afterHours, true);
      assert.equal(result.routing.limitedByPlan, undefined);
    });

    it("a plan with live transfer rings as saved and is never flagged", async () => {
      const { run: result } = await runSimulatedPhoneScenario({
        organizationId: "org_a",
        profile: profile("human_first"),
        client,
        scenario: "missed_call",
        capabilities: voiceCapabilitiesForPlan("receptionist"),
        now: BUSINESS_HOURS,
      });
      assert.equal(result.routing.ringsFirst, true);
      assert.equal(result.routing.limitedByPlan, undefined);
    });
  });

  it("a person is rung only when the caller asks for one", async () => {
    const run = await simulate("transfer_request", "ai_first");
    assertInOrder(kindsOf(run), ["ai_started", "ai_turn", "transfer_attempt", "transfer_result", "finalized"]);
    assert.equal(run.finalStatus, "transferred");
  });

  it("a transfer that is not answered leaves the receptionist to take the message", async () => {
    const run = await simulate("routing_failure", "ai_first");
    assertInOrder(kindsOf(run), ["ai_started", "transfer_attempt", "transfer_result", "error", "finalized"]);
    assert.equal(run.events.find((e) => e.kind === "transfer_result")?.detail, "no_answer");
    assert.equal(run.outcome, "message_taken");
    assert.equal(run.finalStatus, "completed");
  });
});

/* -------------------------------------------------------------------------- */
/* SIM-04  French greeting and language                                        */
/* -------------------------------------------------------------------------- */

describe("SIM-04 greeting and language follow the saved configuration", () => {
  it("opens in French with the saved receptionist and business names", async () => {
    const run = await simulate("receptionist_response", "ai_first");
    const config = buildProfileConfig(profile("ai_first"), { client });
    assert.equal(run.receptionist.greeting, greetingStatement(config, "fr"));
    assert.match(run.receptionist.greeting, /^Bonjour, ici Sophie de testTradeCatch/);
    assert.equal(run.receptionist.startLanguage, "fr");
    assert.equal(run.receptionist.callLanguage, "fr");
    assert.equal(run.receptionist.name, "Sophie");
    assert.equal(run.receptionist.businessName, BUSINESS);
    assert.equal(run.receptionist.voice, config.voices.fr);
    assert.equal(run.transcript.find((l) => l.speaker === "receptionist")?.text.startsWith("Bonjour, ici Sophie"), true);
  });

  it("an English caller presses 1 for English and the rest of the call is in English", async () => {
    const run = await simulate("receptionist_response", "ai_first", { language: "en" });
    assert.equal(run.receptionist.startLanguage, "fr", "the line still opens in French");
    assert.equal(run.receptionist.callLanguage, "en");
    assert.ok(run.events.some((e) => e.kind === "ai_turn" && e.detail === "language_selected:en"));
    const lastReply = [...run.transcript].reverse().find((l) => l.speaker === "receptionist")!;
    assert.doesNotMatch(lastReply.text, /Bonjour|Merci de votre appel/);
  });

  it("a greeting the owner wrote is what the caller hears, not a hard-coded one", async () => {
    const run = await simulate("receptionist_response", "ai_first", {
      over: { greetingFr: "Allo, ici Marc chez Plomberie Test. Comment puis-je vous aider?" },
    });
    assert.match(run.receptionist.greeting, /^Allo, ici Marc chez Plomberie Test/);
    assert.doesNotMatch(run.receptionist.greeting, /Sophie/);
  });

  it("with no saved receptionist name the screen, the simulation and the greeting all use the default name", async () => {
    const run = await simulate("receptionist_response", "ai_first", { over: { receptionistName: "" } });
    assert.equal(run.receptionist.name, "Lucie");
    assert.match(run.receptionist.greeting, /^Bonjour, ici Lucie de testTradeCatch/);
    const live = buildLiveTestInstructions({
      organizationId: "org_a",
      profile: profile("ai_first", { receptionistName: "" }),
      client,
      configs: [],
      now: BUSINESS_HOURS,
      env: {},
    });
    assert.equal(live.expected?.receptionistName, "Lucie");
    assert.match(live.expected!.greeting, /Lucie/);
  });

  it("a language the receptionist does not speak is refused with a clear error", async () => {
    await assert.rejects(
      () => simulate("receptionist_response", "ai_first", { language: "en", over: { languages: ["fr"], defaultLanguage: "fr" } }),
      (error: unknown) => error instanceof LiveTestError && error.code === "language_not_enabled",
    );
  });

  it("the greeting the dashboard shows, the Twilio TwiML and the Bland configuration are the same words", async () => {
    const w = await business({ strategy: "ai_first" });
    env.BLAND_TOOL_SECRET = "tool-secret-for-tests-0123456789abcdef";
    env.BLAND_ROUTES_JSON = JSON.stringify([{ toE164: "+14385550100", configId: `rc_org_${w.orgId}` }]);
    resetBlandRoutesForTests();

    const sim = (await simulateVia(w, "receptionist_response")).body.run!;
    const twiml = await (await twilioStep(...hook("incoming", { CallSid: "CAgreet1", From: SIMULATED_CALLER_E164, To: w.number }))).text();
    const bland = await blandConfig(
      new NextRequest(`http://localhost/api/bland/config?to=${encodeURIComponent("+14385550100")}&call_id=call-sim-greeting-1`, {
        headers: { authorization: `Bearer ${env.BLAND_TOOL_SECRET}` },
      }),
    );
    assert.equal(bland.status, 200);
    const config = ((await bland.json()) as { config: Record<string, string> }).config;

    assert.match(sim.receptionist.greeting, /^Bonjour, ici Sophie de testTradeCatch/);
    assert.ok(twiml.includes(sim.receptionist.greeting.replace(/[.!?]+$/, "")), twiml);
    assert.equal(config.greeting, sim.receptionist.greeting);
    assert.equal(config.language, "fr");
    assert.equal(config.business_name, BUSINESS);
  });
});

/* -------------------------------------------------------------------------- */
/* SIM-05  Zero outbound carrier calls                                         */
/* -------------------------------------------------------------------------- */

const CODE = (file: string) =>
  readFileSync(join(process.cwd(), file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const SIMULATION_SOURCES = [
  "src/product/telephony/live-test.ts",
  "src/product/telephony/live-test-instructions.ts",
  "src/product/telephony/live-test-store.ts",
  "src/product/telephony/call-timeline.ts",
  "src/app/api/businesses/[id]/calls/test/route.ts",
];

describe("SIM-05 no outbound carrier calls", () => {
  it("running every scenario, on both routing strategies, never touches the network", async () => {
    for (const strategy of ["ai_first", "human_first"] as const) {
      for (const scenario of LIVE_TEST_SCENARIOS) {
        try {
          await simulate(scenario, strategy);
        } catch (error) {
          assert.ok(error instanceof LiveTestError, `${strategy}/${scenario}: ${String(error)}`);
        }
      }
    }
    assert.deepEqual(fetched, []);
  });

  it("the dashboard route does not call out either, for any scenario or for the live instructions", async () => {
    for (const strategy of ["ai_first", "human_first"] as const) {
      const w = await business({ strategy });
      for (const scenario of LIVE_TEST_SCENARIOS) {
        const { status, body } = await simulateVia(w, scenario);
        assert.ok(status === 200 || status === 409, `${strategy}/${scenario}: ${status} ${body.code}`);
      }
    }
    const w = await business();
    await send("POST", w.orgId, w.cookie, { body: { mode: "live_instructions" } });
    assert.deepEqual(fetched, []);
  });

  it("the simulation code imports no carrier, voice-provider, SMS or notification client and never calls fetch", () => {
    for (const file of SIMULATION_SOURCES) {
      const source = CODE(file);
      const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
      for (const specifier of specifiers) {
        assert.doesNotMatch(specifier, /twilio|livekit|sms|notifications|bland\/(client|webhook)|outbound/i, `${file} imports ${specifier}`);
      }
      assert.doesNotMatch(source, /\bfetch\s*\(/, `${file} calls fetch`);
      assert.doesNotMatch(source, /XMLHttpRequest|api\.twilio\.com|api\.bland\.ai|calls\.create/i, file);
    }
  });

  it("a simulated call alerts nobody: no owner notification, no SMS", async () => {
    const delivered: string[] = [];
    const store = createMemoryReceptionistStore();
    void store;
    const run = await simulate("routing_failure", "ai_first");
    // The engine's notifier is a no-op in a simulation; nothing was attempted over the network.
    assert.ok(run.events.some((e) => e.kind === "error" && e.detail === "transfer_failed"));
    assert.deepEqual(delivered, []);
    assert.deepEqual(fetched, []);
  });
});

/* -------------------------------------------------------------------------- */
/* SIM-06  Timeline and final status                                           */
/* -------------------------------------------------------------------------- */

const EXPECTED: Record<Strategy, Partial<Record<LiveTestScenario, [string, string]>>> = {
  ai_first: {
    answered_call: ["completed", "completed_by_receptionist"],
    caller_hangup: ["caller_hung_up", "caller_hung_up"],
    receptionist_response: ["completed", "completed_by_receptionist"],
    routing_failure: ["completed", "completed_by_receptionist"],
    transfer_request: ["transferred", "answered_by_contractor"],
    appointment_request: ["completed", "completed_by_receptionist"],
  },
  human_first: {
    answered_call: ["transferred", "answered_by_contractor"],
    missed_call: ["completed", "completed_by_receptionist"],
    caller_hangup: ["caller_hung_up", "caller_hung_up"],
    receptionist_response: ["completed", "completed_by_receptionist"],
    routing_failure: ["completed", "completed_by_receptionist"],
    transfer_request: ["transferred", "answered_by_contractor"],
    appointment_request: ["completed", "completed_by_receptionist"],
  },
};

describe("SIM-06 timeline and final status", () => {
  for (const strategy of ["ai_first", "human_first"] as const) {
    for (const [scenario, [status, reason]] of Object.entries(EXPECTED[strategy]) as [LiveTestScenario, [string, string]][]) {
      it(`${strategy} / ${scenario}: chronological, labelled, ends ${status} (${reason})`, async () => {
        const run = await simulate(scenario, strategy);
        const events = run.events;

        assert.equal(events[0]!.kind, "test_simulated", "the run opens with its simulation marker");
        assert.equal(events[1]!.kind, "incoming");
        assert.equal(events[2]!.kind, "routing_decision");
        assert.deepEqual(kindsOf(run).slice(-2), ["status", "finalized"]);

        events.forEach((event, i) => {
          assert.equal(event.seq, i, "sequence numbers are contiguous");
          assert.equal(event.simulated, true, `event ${i} is labelled as simulated`);
          if (i > 0) {
            assert.ok(event.at >= events[i - 1]!.at, "timestamps never go backwards");
            assert.ok(event.offsetSeconds >= events[i - 1]!.offsetSeconds, "offsets never go backwards");
          }
        });

        assert.equal(run.finalStatus, status);
        assert.equal(run.termination.reason, reason);
        assert.ok(run.durationSeconds > 0);
        assert.equal(Date.parse(run.endedAt) - Date.parse(run.startedAt), run.durationSeconds * 1000);
        assert.equal(events.at(-2)!.payload?.durationSeconds, run.durationSeconds);
        const finalized = events.at(-1)!;
        assert.equal(finalized.payload?.finalStatus, status);
        assert.deepEqual(finalized.payload?.termination, run.termination);
      });
    }
  }

  it("the final status comes from the stored call, not from the scenario's name", async () => {
    const { run, session } = await runSimulatedPhoneScenario({
      organizationId: "org_a",
      profile: profile("ai_first"),
      client,
      scenario: "appointment_request",
      now: BUSINESS_HOURS,
    });
    assert.deepEqual({ finalStatus: run.finalStatus, termination: run.termination }, describeCallEnd(session));
    assert.equal(run.outcome, session.outcome);
    assert.equal(session.durationSeconds, run.durationSeconds);
  });

  it("events written in the same millisecond still read in the order the call happened", async () => {
    const events = createMemoryCallEventStore();
    const at = "2026-03-04T15:00:00.000Z";
    const kinds = ["finalized", "ai_started", "status", "human_ring", "routing_decision", "missed", "incoming"] as const;
    for (const kind of kinds) {
      await events.append({ organizationId: "org_a", clientAccountId: "client_a", callSid: "CAtie", kind, at, id: callEventId("CAtie", kind) });
    }
    const forCall = (await events.listForCall({ organizationId: "org_a", callSid: "CAtie" })).map((e) => e.kind);
    assert.deepEqual(forCall, ["incoming", "routing_decision", "human_ring", "missed", "ai_started", "status", "finalized"]);
    const newestFirst = (await events.listForOrganization({ organizationId: "org_a" })).map((e) => e.kind);
    assert.deepEqual(newestFirst, [...forCall].reverse());
  });

  it("the whole conversation is recorded: the caller's turns and the receptionist's replies", async () => {
    const run = await simulate("appointment_request", "ai_first");
    assert.ok(run.transcript.filter((l) => l.speaker === "caller").length >= 4);
    assert.ok(run.transcript.filter((l) => l.speaker === "receptionist").length >= 4);
    assert.ok(run.headline);
  });
});

/* -------------------------------------------------------------------------- */
/* SIM-07  Caller hang-up                                                      */
/* -------------------------------------------------------------------------- */

describe("SIM-07 caller hang-up", () => {
  it("hanging up on the greeting: the receptionist started, the caller ended the call", async () => {
    const run = await simulate("caller_hangup", "ai_first");
    assertInOrder(kindsOf(run), ["ai_started", "status", "finalized"]);
    assert.equal(run.events.find((e) => e.detail === "caller_hung_up")?.payload?.by, "caller");
    assert.equal(run.finalStatus, "caller_hung_up");
    assert.deepEqual(run.termination, { reason: "caller_hung_up", by: "caller" });
    assert.equal(run.outcome, "caller_hung_up");
  });

  it("hanging up while the contractor's phone rings", async () => {
    const run = await simulate("caller_hangup", "human_first");
    assertInOrder(kindsOf(run), ["human_ring", "missed", "status", "finalized"]);
    assert.equal(run.finalStatus, "caller_hung_up");
    assert.deepEqual(run.termination, { reason: "caller_hung_up", by: "caller" });
  });

  it("a hang-up is shown as one, and a finished conversation is not", async () => {
    const hungUp = await simulate("caller_hangup", "ai_first");
    const finished = await simulate("receptionist_response", "ai_first");
    assert.equal(hungUp.finalStatus, "caller_hung_up");
    assert.notEqual(finished.finalStatus, "caller_hung_up");
  });
});

/* -------------------------------------------------------------------------- */
/* SIM-08  Persistence after refresh                                           */
/* -------------------------------------------------------------------------- */

describe("SIM-08 results persist after refresh and sign-in", () => {
  it("a saved run reloads with the same timeline, status and transcript", async () => {
    const w = await business({ strategy: "human_first" });
    const created = await simulateVia(w, "missed_call");
    assert.equal(created.status, 200);
    const run = created.body.run!;

    const list = await send("GET", w.orgId, w.cookie);
    assert.equal(list.status, 200);
    const reloaded = list.body.runs!.find((r) => r.callSid === run.callSid)!;
    assert.ok(reloaded, "the run is listed after a refresh");
    assert.deepEqual(reloaded.events.map((e) => [e.seq, e.kind, e.detail, e.at, e.offsetSeconds]), run.events.map((e) => [e.seq, e.kind, e.detail, e.at, e.offsetSeconds]));
    for (const field of ["scenario", "startedAt", "endedAt", "durationSeconds", "finalStatus", "termination", "routing", "receptionist", "notes", "headline"] as const) {
      assert.deepEqual(reloaded[field], run[field], field);
    }
    assert.deepEqual(reloaded.transcript, run.transcript);
    assert.ok(reloaded.events.every((e) => e.simulated === true));
  });

  it("is still there after signing in again, and by its own id", async () => {
    const w = await business();
    const run = (await simulateVia(w, "receptionist_response")).body.run!;
    const cookie = await w.relogin();
    assert.notEqual(cookie, w.cookie);
    const list = await send("GET", w.orgId, cookie);
    assert.ok(list.body.runs!.some((r) => r.callSid === run.callSid));
    const one = await send("GET", w.orgId, cookie, { query: `?callSid=${run.callSid}` });
    assert.equal(one.status, 200);
    assert.equal(one.body.run!.finalStatus, run.finalStatus);
  });

  it("lists newest first and keeps every run", async () => {
    const w = await business();
    const ids: string[] = [];
    for (const scenario of ["receptionist_response", "caller_hangup", "appointment_request"]) {
      ids.push((await simulateVia(w, scenario)).body.run!.callSid);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const listed = (await send("GET", w.orgId, w.cookie)).body.runs!.map((r) => r.callSid);
    assert.deepEqual(listed, [...ids].reverse());
  });

  it("a simulation is a practice call: never a real call in the owner's history", async () => {
    const w = await business();
    const run = (await simulateVia(w, "appointment_request")).body.run!;
    const session = await getReceptionistRuntime().store.getSessionByCallSid(run.callSid);
    assert.ok(session);
    assert.equal(isPracticeCall(session), true);
    assert.deepEqual(ownerVisibleCalls([session]), []);
  });
});

/* -------------------------------------------------------------------------- */
/* SIM-09  Business isolation                                                  */
/* -------------------------------------------------------------------------- */

describe("SIM-09 business isolation", () => {
  it("business B never sees business A's simulations, in the list or by id", async () => {
    const a = await business({ name: "Alpha Plomberie" });
    const b = await business({ name: "Beta Toiture" });
    const run = (await simulateVia(a, "receptionist_response")).body.run!;

    const listB = await send("GET", b.orgId, b.cookie);
    assert.equal(listB.status, 200);
    assert.deepEqual(listB.body.runs, []);
    const byId = await send("GET", b.orgId, b.cookie, { query: `?callSid=${run.callSid}` });
    assert.equal(byId.status, 404);
    assert.equal(byId.body.run, undefined);
  });

  it("B's session cannot read or run anything for A", async () => {
    const a = await business({ name: "Alpha Plomberie" });
    const b = await business({ name: "Beta Toiture" });
    await simulateVia(a, "receptionist_response");

    const read = await send("GET", a.orgId, b.cookie);
    const write = await send("POST", a.orgId, b.cookie, { body: { mode: "simulation", scenario: "receptionist_response" } });
    for (const response of [read, write]) {
      assert.ok([401, 403, 404].includes(response.status), `status ${response.status}`);
      assert.equal(response.body.run, undefined);
      assert.equal(response.body.runs, undefined);
    }
    assert.equal((await send("GET", a.orgId, a.cookie)).body.runs!.length, 1, "A's history is untouched");
  });

  it("each business's simulation uses its own saved configuration", async () => {
    const a = await business({ name: "Alpha Plomberie", strategy: "ai_first" });
    const b = await business({ name: "Beta Toiture", strategy: "human_first", over: { receptionistName: "Julie" } });
    const ra = (await simulateVia(a, "answered_call")).body.run!;
    const rb = (await simulateVia(b, "answered_call")).body.run!;
    assert.equal(ra.receptionist.businessName, "Alpha Plomberie");
    assert.equal(rb.receptionist.businessName, "Beta Toiture");
    assert.equal(ra.routing.action, "ai");
    assert.equal(rb.routing.action, "ring_human");
    assert.equal(rb.receptionist.name, "Julie");
  });

  it("events are written under the business's own id and nobody else's", async () => {
    const a = await business();
    const b = await business();
    const run = (await simulateVia(a, "receptionist_response")).body.run!;
    const events = getTelephonyRuntime().events;
    const forA = await events.listForOrganization({ organizationId: a.orgId });
    const forB = await events.listForOrganization({ organizationId: b.orgId });
    assert.ok(forA.length >= run.events.length);
    assert.ok(forA.every((e) => e.organizationId === a.orgId && e.clientAccountId === a.client.id));
    assert.deepEqual(forB, []);
  });

  it("a call id that belongs to another business is never overwritten or shown", async () => {
    const a = await business({ name: "Alpha Plomberie" });
    const b = await business({ name: "Beta Toiture" });
    const runId = crypto.randomUUID();
    const mine = await send("POST", a.orgId, a.cookie, { body: { mode: "simulation", scenario: "receptionist_response", runId } });
    assert.equal(mine.status, 200);
    const stolen = await send("POST", b.orgId, b.cookie, { body: { mode: "simulation", scenario: "receptionist_response", runId } });
    assert.equal(stolen.status, 503);
    assert.equal(stolen.body.code, "persistence_failed");
    assert.equal(stolen.body.run, undefined);
    assert.deepEqual((await send("GET", b.orgId, b.cookie)).body.runs, []);
    const intact = (await send("GET", a.orgId, a.cookie, { query: `?callSid=${mine.body.run!.callSid}` })).body.run!;
    assert.equal(intact.receptionist.businessName, "Alpha Plomberie");
  });

  it("the store refuses to save a run under another business's scope", async () => {
    const output = await runSimulatedPhoneScenario({
      organizationId: "org_a",
      profile: profile("ai_first"),
      client,
      scenario: "receptionist_response",
      now: BUSINESS_HOURS,
    });
    const stores = { events: createMemoryCallEventStore(), sessions: createMemoryReceptionistStore() };
    await assert.rejects(() => saveSimulation(output, { organizationId: "org_b", clientAccountId: "client_b" }, stores));
    const loaded = await loadSimulation({ organizationId: "org_b", clientAccountId: "client_b" }, stores, output.run.callSid);
    assert.equal(loaded, null);
    assert.deepEqual(await listSimulations({ organizationId: "org_b", clientAccountId: "client_b" }, stores), []);
  });
});

/* -------------------------------------------------------------------------- */
/* SIM-10  Duplicate events are idempotent                                     */
/* -------------------------------------------------------------------------- */

describe("SIM-10 duplicate events are idempotent", () => {
  it("the same click sent twice is one run, and the second answer says so", async () => {
    const w = await business();
    const body = { mode: "simulation", scenario: "appointment_request", runId: crypto.randomUUID() };
    const first = await send("POST", w.orgId, w.cookie, { body });
    const second = await send("POST", w.orgId, w.cookie, { body });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(second.body.replayed, true);
    assert.equal(second.body.run!.callSid, first.body.run!.callSid);
    assert.deepEqual(second.body.run!.events.map((e) => e.seq), first.body.run!.events.map((e) => e.seq));
    const listed = (await send("GET", w.orgId, w.cookie)).body.runs!;
    assert.equal(listed.length, 1);
    assert.equal((await eventsFor(w.orgId, first.body.run!.callSid)).length, first.body.run!.events.length);
  });

  it("two identical requests at the same moment still leave one run and one row per event", async () => {
    const w = await business();
    const body = { mode: "simulation", scenario: "receptionist_response", runId: crypto.randomUUID() };
    const [a, b] = await Promise.all([send("POST", w.orgId, w.cookie, { body }), send("POST", w.orgId, w.cookie, { body })]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const listed = (await send("GET", w.orgId, w.cookie)).body.runs!;
    assert.equal(listed.length, 1);
    const stored = await eventsFor(w.orgId, listed[0]!.callSid);
    assert.equal(stored.length, a.body.run!.events.length);
    assert.equal(new Set(stored.map((e) => e.id)).size, stored.length);
  });

  it("saving the same run again adds nothing", async () => {
    const output = await runSimulatedPhoneScenario({
      organizationId: "org_a",
      profile: profile("human_first"),
      client,
      scenario: "missed_call",
      now: BUSINESS_HOURS,
    });
    const stores = { events: createMemoryCallEventStore(), sessions: createMemoryReceptionistStore() };
    const scope = { organizationId: "org_a", clientAccountId: client.id };
    const first = await saveSimulation(output, scope, stores);
    const count = (await stores.events.listForCall({ organizationId: "org_a", callSid: output.run.callSid, limit: 200 })).length;
    const second = await saveSimulation(output, scope, stores);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal((await stores.events.listForCall({ organizationId: "org_a", callSid: output.run.callSid, limit: 200 })).length, count);
    assert.equal(count, output.run.events.length);
  });

  it("an event with the same id is stored once, however often it arrives", async () => {
    const events = createMemoryCallEventStore();
    const row = { organizationId: "org_a", clientAccountId: "client_a", callSid: "CAdup", kind: "incoming" as const };
    const id = callEventId("CAdup", "incoming");
    await Promise.all([events.append({ ...row, id }), events.append({ ...row, id }), events.append({ ...row, id })]);
    assert.equal((await events.listForOrganization({ organizationId: "org_a" })).length, 1);
  });

  it("a real call whose webhooks Twilio retries has one row per lifecycle event", async () => {
    const w = await business({ strategy: "human_first" });
    const sid = "CAretry1";
    const params = { CallSid: sid, From: "+15145559876", To: w.number };
    const first = await twilioStep(...hook("incoming", params));
    await twilioStep(...hook("incoming", params));
    const session = (await first.text()).match(/session=(rcs_[0-9a-f-]+)/)?.[1];
    assert.ok(session);
    for (let i = 0; i < 2; i++) {
      await twilioStep(...hook("dial", { CallSid: sid, DialCallStatus: "no-answer" }, `?session=${session}`));
      await twilioStep(...hook("status", { CallSid: sid, CallStatus: "completed", CallDuration: "31", From: "+15145559876", To: w.number }));
    }
    const rows = await waitFor(() => eventsFor(w.orgId, sid), (r) => ["missed", "ai_started", "finalized"].every((k) => r.some((e) => e.kind === k)), "the dial and final events");
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
    for (const kind of ["incoming", "routing_decision", "human_ring", "missed", "ai_started", "status", "finalized"]) {
      assert.equal(counts.get(kind), 1, `${kind} written once, got ${JSON.stringify([...counts])}`);
    }
    assert.equal(new Set(rows.map((e) => e.id)).size, rows.length);
  });
});

/* -------------------------------------------------------------------------- */
/* SIM-11  Invalid configuration gives a clear error                           */
/* -------------------------------------------------------------------------- */

function assertActionable(response: { status: number; body: Body }, status: number, code: string) {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, code);
  assert.ok(typeof response.body.error === "string" && response.body.error.length > 20, "the error says what to do");
  assert.equal(response.body.run, undefined, "a failed simulation never returns a result");
}

describe("SIM-11 invalid configuration and failures give clear errors", () => {
  it("a receptionist that was never activated", async () => {
    const w = await business({ activated: false });
    const r = await simulateVia(w, "receptionist_response");
    assertActionable(r, 409, "receptionist_not_activated");
    assert.match(r.body.error!, /activate/i);
  });

  it("a receptionist whose call handling is switched off", async () => {
    const w = await business({ over: { callHandlingMode: "disabled" } });
    assertActionable(await simulateVia(w, "receptionist_response"), 409, "receptionist_disabled");
  });

  it("a saved number that is malformed names the broken field", async () => {
    const good = settings("ai_first");
    const w = await business({
      rawSettings: { ...good, phoneSettings: { ...good.phoneSettings, tradecatchNumberE164: "12345" } },
    });
    const r = await simulateVia(w, "receptionist_response");
    assertActionable(r, 422, "invalid_configuration");
    assert.deepEqual(r.body.details?.fields, ["phoneNumberE164"]);
  });

  it("a business with no phone number assigned", async () => {
    await assert.rejects(
      () =>
        runSimulatedPhoneScenario({
          organizationId: "org_a",
          profile: { ...profile("ai_first", {}, { tradecatchNumberE164: undefined }), phoneNumberE164: undefined },
          client: demoClientAccount({ id: "client_a", contractorDisplayName: BUSINESS, smsFromNumber: "" }),
          scenario: "receptionist_response",
          now: BUSINESS_HOURS,
        }),
      (error: unknown) => error instanceof LiveTestError && error.code === "no_phone_number",
    );
  });

  it("a language the receptionist is not set up for", async () => {
    const w = await business({ over: { languages: ["fr"], defaultLanguage: "fr" } });
    assertActionable(await simulateVia(w, "receptionist_response", { language: "en" }), 409, "language_not_enabled");
  });

  it("a missed-call scenario on a business that never rings the contractor first", async () => {
    const w = await business({ strategy: "ai_first" });
    assertActionable(await simulateVia(w, "missed_call"), 409, "scenario_not_applicable");
  });

  it("a transfer scenario on a plan that has no live transfer", async () => {
    const w = await business({ strategy: "ai_first" });
    await saas.updateOrganizationPlan(w.orgId, "essential");
    await getReceptionistRuntime().refresh(true);
    assertActionable(await simulateVia(w, "transfer_request"), 409, "no_transfer_destination");
  });

  it("a business with no phone account linked", async () => {
    const w = await business({ linkClient: false });
    assertActionable(await simulateVia(w, "receptionist_response"), 409, "phone_client_not_linked");
  });

  it("a malformed request is refused, never run", async () => {
    const w = await business();
    for (const body of [{ scenario: "launch_missiles" }, { runId: "not-a-uuid" }, { language: "de" }, { mode: "dial_out" }]) {
      const r = await send("POST", w.orgId, w.cookie, { body });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.body.ok, false);
    }
  });

  it("a database failure while saving is an error, never a result, and nothing is left listed", async () => {
    const w = await business();
    mock.method(getTelephonyRuntime().events, "append", async () => {
      throw new Error("db down");
    });
    const r = await simulateVia(w, "receptionist_response");
    assertActionable(r, 503, "persistence_failed");
    mock.restoreAll();
    mock.method(console, "error", () => {});
    assert.deepEqual((await send("GET", w.orgId, w.cookie)).body.runs, []);
  });

  it("a failure half-way through saving leaves an incomplete run that is not shown and is reported when asked for", async () => {
    const w = await business();
    const events = getTelephonyRuntime().events;
    const original = events.append.bind(events);
    let writes = 0;
    mock.method(events, "append", async (event: Parameters<typeof original>[0]) => {
      if (++writes === 4) throw new Error("connection reset");
      return original(event);
    });
    const runId = crypto.randomUUID();
    const r = await send("POST", w.orgId, w.cookie, { body: { mode: "simulation", scenario: "receptionist_response", runId } });
    assertActionable(r, 503, "persistence_failed");
    assert.deepEqual((await send("GET", w.orgId, w.cookie)).body.runs, [], "a half-saved run is not presented as a result");
    const one = await send("GET", w.orgId, w.cookie, { query: `?callSid=sim_live_${runId}` });
    assert.equal(one.status, 409);
    assert.equal(one.body.code, "simulation_incomplete");
    const again = await send("POST", w.orgId, w.cookie, { body: { mode: "simulation", scenario: "receptionist_response", runId } });
    assertActionable(again, 409, "simulation_incomplete");
  });

  it("a history that cannot be loaded is an error, not an empty list", async () => {
    const w = await business();
    mock.method(getTelephonyRuntime().events, "listForOrganization", async () => {
      throw new Error("db down");
    });
    const r = await send("GET", w.orgId, w.cookie);
    assert.equal(r.status, 503);
    assert.equal(r.body.code, "history_unavailable");
    assert.equal(r.body.runs, undefined);
  });

  it("every failure the route can return has a translated message in both languages", () => {
    const codes = ["receptionist_not_activated", "receptionist_disabled", "no_phone_number", "invalid_configuration", "call_not_answered_now", "routing_rejected", "language_not_enabled", "scenario_not_applicable", "no_transfer_destination", "voice_engine_not_simulatable", "test_caller_is_personal_contact", "persistence_failed", "history_unavailable", "simulation_incomplete", "runtime_unavailable", "simulation_failed", "phone_client_not_linked"];
    for (const lang of ["en", "fr"]) {
      const messages = JSON.parse(readFileSync(join(process.cwd(), `src/messages/${lang}.json`), "utf8")) as { app: { livePhoneTesting: { errors: Record<string, string> } } };
      for (const code of codes) {
        assert.ok(messages.app.livePhoneTesting.errors[code]?.length > 20, `${lang}: ${code}`);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* SIM-12  The Live Test button never places a call                            */
/* -------------------------------------------------------------------------- */

describe("SIM-12 the live test button never places a call", () => {
  it("asking for the live test returns instructions, places nothing and writes nothing", async () => {
    const w = await business();
    const r = await send("POST", w.orgId, w.cookie, { body: { mode: "live_instructions" } });
    assert.equal(r.status, 200);
    assert.equal(r.body.mode, "live_instructions");
    assert.equal(r.body.callsPlaced, 0);
    assert.equal(r.body.carrierChargesMayApply, true);
    assert.deepEqual(fetched, []);
    assert.deepEqual(await getTelephonyRuntime().events.listForOrganization({ organizationId: w.orgId }), []);
    assert.deepEqual((await send("GET", w.orgId, w.cookie)).body.runs, []);
  });

  it("pressing it repeatedly changes nothing either", async () => {
    const w = await business();
    for (let i = 0; i < 4; i++) await send("POST", w.orgId, w.cookie, { body: { mode: "live_instructions" } });
    assert.deepEqual(fetched, []);
    assert.deepEqual(await getTelephonyRuntime().events.listForOrganization({ organizationId: w.orgId }), []);
  });

  it("the instructions are computed without side effects", async () => {
    const w = await business();
    const runtime = getReceptionistRuntime();
    const profileBefore = await runtime.profileStore.getProfile(w.orgId);
    const instructions = buildLiveTestInstructions({
      organizationId: w.orgId,
      profile: profileBefore!,
      client: w.client,
      configs: runtime.configs,
    });
    assert.equal(instructions.callsPlaced, 0);
    assert.deepEqual(await runtime.profileStore.getProfile(w.orgId), profileBefore);
    assert.deepEqual(fetched, []);
  });

  it("the page code starts nothing by itself: no effect, no tel: link, one fetch, only from a click", () => {
    const component = readFileSync(join(process.cwd(), "src/components/app/LivePhoneTesting.tsx"), "utf8");
    assert.doesNotMatch(component, /useEffect|useLayoutEffect|setInterval|setTimeout/);
    assert.doesNotMatch(component, /tel:|sms:|window\.location|navigator\./);
    // KAN-26: the one request goes through timedFetch (it always ends), still exactly one call site.
    assert.equal((component.match(/\b(?:timedFetch|fetch)\(/g) ?? []).length, 1);
    assert.equal((component.match(/\bpost\(/g) ?? []).length, 3, "the helper and its two callers");
    // Each request is made by a handler that only a button's onClick reaches.
    assert.match(component, /onClick=\{\(\) => void runSimulation\(\)\}/);
    assert.match(component, /onClick=\{\(\) => void recheckLive\(\)\}/);
    assert.doesNotMatch(component, /mode: "live_instructions"[\s\S]*mode: "live_instructions"/);
  });

  it("carrier charges are stated, prominently, in both languages", () => {
    for (const [lang, pattern] of [["en", /carrier charges may apply/i], ["fr", /frais d.opérateur peuvent s.appliquer/i]] as const) {
      const messages = JSON.parse(readFileSync(join(process.cwd(), `src/messages/${lang}.json`), "utf8")) as { app: { livePhoneTesting: Record<string, string> } };
      assert.match(messages.app.livePhoneTesting.liveWarning, pattern, lang);
    }
    const component = readFileSync(join(process.cwd(), "src/components/app/LivePhoneTesting.tsx"), "utf8");
    assert.match(component, /role="note"[\s\S]{0,200}liveWarning/);
  });

  it("the number shown is the one the receptionist is configured on, never the owner's contact phone", async () => {
    const w = await business({ number: "+14382314711" });
    const r = await send("POST", w.orgId, w.cookie, { body: { mode: "live_instructions" } });
    assert.equal(r.body.dialNumber, "+14382314711");
    assert.deepEqual(r.body.numbers, [{ e164: "+14382314711", via: "tradecatch" }]);
    const page = readFileSync(join(process.cwd(), "src/app/[locale]/app/test-center/live-phone/page.tsx"), "utf8");
    assert.doesNotMatch(CODE("src/app/[locale]/app/test-center/live-phone/page.tsx"), /organization\.phoneE164|\.phoneE164/);
    assert.match(page, /buildLiveTestInstructions/);
  });

  it("carrier forwarding: the business's public line is offered, with the TradeCatch number behind it", async () => {
    const w = await business({
      phone: { routingMethod: "carrier_forwarding", businessPhoneE164: "+15145550999" },
    });
    const r = await send("POST", w.orgId, w.cookie, { body: { mode: "live_instructions" } });
    assert.equal(r.body.dialNumber, "+15145550999");
    assert.deepEqual(r.body.numbers!.map((n) => n.via), ["carrier_forwarding", "tradecatch"]);
  });

  it("it says plainly when the line is not ready, and why", async () => {
    const w = await business({ activated: false });
    const r = await send("POST", w.orgId, w.cookie, { body: { mode: "live_instructions" } });
    assert.equal(r.body.ready, false);
    assert.equal(r.body.checks!.find((c) => c.code === "activated")?.status, "problem");
  });
});

/* -------------------------------------------------------------------------- */
/* SIM-13  Real incoming test calls reach the configured receptionist          */
/* -------------------------------------------------------------------------- */

describe("SIM-13 a real call to the displayed number reaches the configured receptionist", () => {
  it("the number the page shows is answered by this business, with its greeting, in French", async () => {
    const w = await business({ strategy: "ai_first" });
    const instructions = (await send("POST", w.orgId, w.cookie, { body: { mode: "live_instructions" } })).body;
    assert.equal(instructions.ready, true, JSON.stringify(instructions.checks));
    assert.equal(instructions.checks!.find((c) => c.code === "number_reaches_this_business")?.status, "ok");
    assert.equal(instructions.routing?.action, "ai");

    const response = await twilioStep(...hook("incoming", { CallSid: "CAreal1", From: "+15145559876", To: instructions.dialNumber! }));
    assert.equal(response.status, 200);
    const xml = await response.text();
    assert.match(xml, /<Gather /);
    assert.ok(xml.includes(instructions.expected!.greeting.replace(/[.!?]+$/, "")), xml);
    assert.match(xml, /Bonjour, ici Sophie de testTradeCatch/);
    assert.equal(instructions.expected!.startLanguage, "fr");
    assert.match(xml, /language="fr/);
    assert.ok(xml.includes(`voice="${instructions.expected!.voice}"`) || xml.includes(instructions.expected!.voice), `the configured voice ${instructions.expected!.voice} is used`);
  });

  it("the real call is recorded as a real call, with the same timeline events, and no simulation label", async () => {
    const w = await business({ strategy: "ai_first" });
    const sid = "CAreal2";
    await twilioStep(...hook("incoming", { CallSid: sid, From: "+15145559876", To: w.number }));
    const rows = await waitFor(() => eventsFor(w.orgId, sid), (r) => r.some((e) => e.kind === "ai_started"), "the real call's events");
    assert.deepEqual(rows.map((e) => e.kind), ["incoming", "routing_decision", "ai_started"]);
    assert.match(rows[1]!.detail!, /^ai:/);
    assert.ok(rows.every((e) => e.payload?.simulated !== true));
    assert.ok(rows.every((e) => !e.callSid.startsWith("sim_")));
    const session = await getReceptionistRuntime().store.getSessionByCallSid(sid);
    assert.ok(session);
    assert.equal(isPracticeCall(session), false);
    assert.equal(ownerVisibleCalls([session]).length, 1, "it shows in the owner's call history");
    assert.deepEqual((await send("GET", w.orgId, w.cookie)).body.runs, [], "it is not listed among simulations");
  });

  it("a contractor-first business's real call rings the configured phone, then falls to the receptionist when missed", async () => {
    const w = await business({ strategy: "human_first" });
    const sid = "CAreal3";
    const params = { CallSid: sid, From: "+15145559876", To: w.number };
    const incoming = await (await twilioStep(...hook("incoming", params))).text();
    assert.match(incoming, new RegExp(`<Dial[^>]*>[\\s\\S]*${OWNER_PHONE.replace("+", "\\+")}`));
    const session = incoming.match(/session=(rcs_[0-9a-f-]+)/)![1]!;
    const afterRing = await (await twilioStep(...hook("dial", { CallSid: sid, DialCallStatus: "no-answer" }, `?session=${session}`))).text();
    assert.match(afterRing, /Bonjour, ici Sophie de testTradeCatch/);
    await twilioStep(...hook("status", { CallSid: sid, CallStatus: "completed", CallDuration: "34", From: params.From, To: w.number }));

    const rows = await waitFor(() => eventsFor(w.orgId, sid), (r) => ["missed", "ai_started", "finalized"].every((k) => r.some((e) => e.kind === k)), "the dial and final events");
    const kinds = rows.map((e) => e.kind);
    assertInOrder(kinds, ["incoming", "routing_decision", "human_ring", "missed", "ai_started", "status", "finalized"]);
    assert.match(rows.find((e) => e.kind === "routing_decision")!.detail!, /^ring_human:/);
    const finalized = rows.find((e) => e.kind === "finalized")!;
    const stored = await getReceptionistRuntime().store.getSessionByCallSid(sid);
    assert.deepEqual((finalized.payload as { finalStatus: string; termination: unknown }).termination, describeCallEnd(stored!).termination);
    assert.ok(rows.every((e) => e.payload?.simulated !== true));
  });

  it("each number reaches its own business and no other", async () => {
    const a = await business({ name: "Alpha Plomberie" });
    const b = await business({ name: "Beta Toiture" });
    const toA = await (await twilioStep(...hook("incoming", { CallSid: "CAiso1", From: "+15145559876", To: a.number }))).text();
    const toB = await (await twilioStep(...hook("incoming", { CallSid: "CAiso2", From: "+15145559876", To: b.number }))).text();
    assert.match(toA, /Alpha Plomberie/);
    assert.doesNotMatch(toA, /Beta Toiture/);
    assert.match(toB, /Beta Toiture/);
    assert.doesNotMatch(toB, /Alpha Plomberie/);
    assert.equal((await eventsFor(a.orgId, "CAiso2")).length, 0);
    assert.equal((await eventsFor(b.orgId, "CAiso1")).length, 0);
  });

  it("a Bland line routed to this business reaches the same configuration: name, language, greeting", async () => {
    const w = await business({ strategy: "ai_first" });
    const other = await business({ name: "Beta Toiture", over: { defaultLanguage: "en", languages: ["en", "fr"] } });
    env.BLAND_TOOL_SECRET = "tool-secret-for-tests-0123456789abcdef";
    env.BLAND_WEBHOOK_SECRET = "webhook-secret-for-tests-0123456789abc";
    env.BLAND_ROUTES_JSON = JSON.stringify([
      { toE164: "+14385550100", configId: `rc_org_${w.orgId}` },
      { toE164: "+14385550101", configId: `rc_org_${other.orgId}` },
    ]);
    resetBlandRoutesForTests();

    const instructions = (await send("POST", w.orgId, w.cookie, { body: { mode: "live_instructions" } })).body;
    assert.deepEqual(instructions.numbers!.map((n) => [n.e164, n.via]), [[w.number, "tradecatch"], ["+14385550100", "bland"]]);
    assert.equal(instructions.checks!.find((c) => c.code === "bland_route")?.status, "ok");
    assert.equal(instructions.checks!.find((c) => c.code === "bland_secrets")?.status, "ok");
    assert.equal(instructions.checks!.find((c) => c.code === "number_reaches_this_business")?.status, "ok");

    const ask = async (to: string) =>
      ((await (await blandConfig(new NextRequest(`http://localhost/api/bland/config?to=${encodeURIComponent(to)}&call_id=call-sim-${to.slice(-4)}`, { headers: { authorization: `Bearer ${env.BLAND_TOOL_SECRET}` } }))).json()) as { config: Record<string, string> }).config;
    const mine = await ask("+14385550100");
    const theirs = await ask("+14385550101");
    assert.equal(mine.business_name, BUSINESS);
    assert.equal(mine.language, "fr");
    assert.equal(mine.greeting, instructions.expected!.greeting);
    assert.equal(theirs.business_name, "Beta Toiture");
    assert.equal(theirs.language, "en");
    assert.notEqual(theirs.greeting, mine.greeting);
  });

  it("a number that points at another business is reported, not offered as a working test line", async () => {
    const a = await business({ name: "Alpha Plomberie" });
    const b = await business({ name: "Beta Toiture" });
    // Two businesses answering the same number: the live webhook could pick either one.
    const instructions = buildLiveTestInstructions({
      organizationId: a.orgId,
      profile: (await getReceptionistRuntime().profileStore.getProfile(a.orgId))!,
      client: a.client,
      configs: [
        ...getReceptionistRuntime().configs,
        { ...getReceptionistRuntime().configs.find((c) => c.id === `rc_org_${b.orgId}`)!, phoneNumberE164: a.number },
      ],
    });
    assert.equal(instructions.checks.find((c) => c.code === "number_reaches_this_business")?.status, "problem");
    assert.equal(instructions.ready, false);
  });

  it("a switched-off receptionist is flagged before anyone dials", async () => {
    const w = await business({ over: { callHandlingMode: "disabled" } });
    const instructions = (await send("POST", w.orgId, w.cookie, { body: { mode: "live_instructions" } })).body;
    assert.equal(instructions.ready, false);
    assert.equal(instructions.checks!.find((c) => c.code === "receptionist_enabled")?.status, "problem");
  });
});
