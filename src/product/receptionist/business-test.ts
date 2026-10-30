/**
 * Authenticated AI receptionist test for a specific business profile.
 *
 * Same engine as live calls and the public demo, but:
 * - Uses THAT organization's saved settings / knowledge (tenant isolation).
 * - Never dials, emails, or SMSes.
 * - Optionally records the simulated session under callSid `sim_*` for history.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { randomUUID } from "@/lib/id";
import { createRuleBrain } from "./brain-rules";
import { createReceptionistEngine } from "./engine";
import type { VoiceCapabilities } from "./plan-limits";
import {
  buildProfileConfig,
  type ReceptionistProfile,
} from "./profile";
import { createMemoryReceptionistStore } from "./store";
import type { ClientAccount } from "@/product/missed-call/types";
import type {
  CallSession,
  CallStep,
  CallSummary,
  ReceptionistConfig,
  ReceptionistLanguage,
  VoicePlan,
} from "./types";

export type BusinessTestScenario = "open" | "after_hours";

export type BusinessTestMessage = {
  role: "agent" | "system";
  text: string;
};

export type BusinessTestResponse = {
  state: string | null;
  messages: BusinessTestMessage[];
  ended: boolean;
  step: CallStep;
  language: ReceptionistLanguage;
  afterHours: boolean;
  transfer?: { name: string; emergency: boolean };
  summary?: CallSummary;
  simulated: true;
  organizationId: string;
  sessionId?: string;
};

export class BusinessTestError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_state" | "expired" | "too_long" | "config",
  ) {
    super(message);
    this.name = "BusinessTestError";
  }
}

const TEST_CALLER = "+15145550199";
const MAX_AGE_MS = 30 * 60 * 1000;
export const MAX_TEST_UTTERANCE = 400;
export const MAX_TEST_STATE_CHARS = 60_000;

const CLOCK: Record<BusinessTestScenario, Date> = {
  open: new Date("2026-03-04T15:00:00Z"),
  after_hours: new Date("2026-03-04T03:00:00Z"),
};

type SignedPayload = {
  iat: number;
  organizationId: string;
  scenario: BusinessTestScenario;
  session: CallSession;
};

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(payload: string, secret: string): string {
  return b64url(
    createHmac("sha256", secret)
      .update(`receptionist-biz-test:${payload}`)
      .digest(),
  );
}

export function signBusinessTestState(
  payload: Omit<SignedPayload, "iat"> & { iat?: number },
  secret: string,
  now = Date.now(),
): string {
  const body = b64url(
    Buffer.from(
      JSON.stringify({ ...payload, iat: payload.iat ?? now }),
      "utf8",
    ),
  );
  return `${body}.${sign(body, secret)}`;
}

export function verifyBusinessTestState(
  token: string,
  secret: string,
  expectedOrganizationId: string,
  now = Date.now(),
): SignedPayload {
  if (token.length > MAX_TEST_STATE_CHARS)
    throw new BusinessTestError("State too large", "too_long");
  const [payload, sig] = token.split(".");
  if (!payload || !sig)
    throw new BusinessTestError("Malformed state", "invalid_state");
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new BusinessTestError("Bad signature", "invalid_state");
  }
  let parsed: SignedPayload;
  try {
    parsed = JSON.parse(fromB64url(payload).toString("utf8"));
  } catch {
    throw new BusinessTestError("Malformed state", "invalid_state");
  }
  if (
    !parsed.session ||
    typeof parsed.iat !== "number" ||
    !parsed.session.callSid?.startsWith("sim_") ||
    parsed.organizationId !== expectedOrganizationId
  ) {
    throw new BusinessTestError("Not a business test session", "invalid_state");
  }
  if (now - parsed.iat > MAX_AGE_MS)
    throw new BusinessTestError("Test expired", "expired");
  return parsed;
}

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

function makeEngine(config: ReceptionistConfig, scenario: BusinessTestScenario) {
  const store = createMemoryReceptionistStore();
  const engine = createReceptionistEngine({
    store,
    configs: () => [{ ...config, enabled: true, callHandlingMode: "always" }],
    brain: createRuleBrain(),
    notifier: noopNotifier(),
    llm: null,
    clock: { now: () => CLOCK[scenario] },
  });
  return { store, engine };
}

function planMessages(plan: VoicePlan): BusinessTestMessage[] {
  const out: BusinessTestMessage[] = [];
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

function transferNote(
  name: string,
  language: ReceptionistLanguage,
  emergency: boolean,
): string {
  const fr = language === "fr";
  if (emergency) {
    return fr
      ? `Transfert d'urgence simulé vers ${name}. Aucun appel réel n'est passé.`
      : `Simulated emergency transfer to ${name}. No real call is placed.`;
  }
  return fr
    ? `Transfert simulé vers ${name}. Aucun appel réel n'est passé.`
    : `Simulated transfer to ${name}. No real call is placed.`;
}

async function settle(
  engine: ReturnType<typeof makeEngine>["engine"],
  store: ReturnType<typeof makeEngine>["store"],
  first: VoicePlan,
  language: ReceptionistLanguage,
  callSid: string,
): Promise<Omit<BusinessTestResponse, "state" | "afterHours" | "simulated" | "organizationId">> {
  let plan = first;
  const messages = planMessages(plan);
  let ended = plan.verbs.some((v) => v.verb === "hangup");
  let transfer: BusinessTestResponse["transfer"];

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
      // Simulate failed transfer when configured timeout would fire — default completed.
      plan = await engine.handleDialResult({
        sessionId: session.id,
        dialStatus: "completed",
        durationSeconds: 45,
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
    sessionId: session.id,
  };
}

export type BusinessTestRequest =
  | {
      action: "start";
      language: ReceptionistLanguage;
      scenario: BusinessTestScenario;
    }
  | { action: "say"; state: string; speech: string };

export type BusinessTestDeps = {
  organizationId: string;
  profile: ReceptionistProfile;
  /** The owner's plan limits, so the test call behaves like a live one. */
  capabilities?: VoiceCapabilities;
  client: ClientAccount;
  secret: string;
  /** Persist finalized (or in-progress) sim sessions for call history. */
  persistSession?: (session: CallSession) => Promise<void>;
};

export async function runBusinessTestTurn(
  request: BusinessTestRequest,
  deps: BusinessTestDeps,
): Promise<BusinessTestResponse> {
  let config: ReceptionistConfig;
  try {
    config = buildProfileConfig(deps.profile, {
      client: deps.client,
      capabilities: deps.capabilities,
    });
  } catch (err) {
    throw new BusinessTestError(
      err instanceof Error ? err.message : "Invalid profile",
      "config",
    );
  }

  if (request.action === "start") {
    const { store, engine } = makeEngine(config, request.scenario);
    const callSid = `sim_${randomUUID()}`;
    const plan = await engine.startCall({
      callSid,
      fromE164: TEST_CALLER,
      toE164: config.phoneNumberE164,
    });
    const result = await settle(
      engine,
      store,
      plan,
      request.language === "en" ? "en" : config.defaultLanguage,
      callSid,
    );
    const session = (await store.getSessionByCallSid(callSid))!;
    // Force requested language after bilingual menu if single-language start preferred.
    if (request.language && session.language !== request.language) {
      session.language = request.language;
    }
    if (deps.persistSession) await deps.persistSession(session);
    return {
      ...result,
      language: session.language,
      afterHours: session.afterHours,
      state: result.ended
        ? null
        : signBusinessTestState(
            {
              organizationId: deps.organizationId,
              scenario: request.scenario,
              session,
            },
            deps.secret,
          ),
      simulated: true,
      organizationId: deps.organizationId,
    };
  }

  const hydrated = verifyBusinessTestState(
    request.state,
    deps.secret,
    deps.organizationId,
  );
  const language = hydrated.session.language;
  const { store, engine } = makeEngine(config, hydrated.scenario);
  await store.insertSessionIfAbsent(hydrated.session);

  const speech = request.speech.trim().slice(0, MAX_TEST_UTTERANCE);
  const plan = await engine.handleGather({
    sessionId: hydrated.session.id,
    speech,
  });
  const result = await settle(
    engine,
    store,
    plan,
    language,
    hydrated.session.callSid,
  );
  const session = (await store.getSessionByCallSid(hydrated.session.callSid))!;
  if (deps.persistSession) await deps.persistSession(session);
  return {
    ...result,
    afterHours: session.afterHours,
    state: result.ended
      ? null
      : signBusinessTestState(
          {
            organizationId: deps.organizationId,
            scenario: hydrated.scenario,
            session,
          },
          deps.secret,
        ),
    simulated: true,
    organizationId: deps.organizationId,
  };
}
