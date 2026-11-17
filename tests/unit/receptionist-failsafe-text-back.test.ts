/**
 * The Twilio receptionist route's error branch, with recording switched off for
 * the business: the caller is told a text is coming and really gets one (right
 * number, right call id, once); an unknown caller is not promised a text; with
 * recording on, the voicemail is unchanged. Nobody is told to call back.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { NextRequest } from "next/server";
import { POST as step } from "../../src/app/api/twilio/voice/receptionist/[step]/route";
import {
  getReceptionistRuntime,
  resetReceptionistRuntimeForTests,
} from "../../src/product/receptionist/runtime";

const keys = [
  "NODE_ENV",
  "TRADECATCH_ENV",
  "RECEPTIONIST_CONFIG_JSON",
  "RECEPTIONIST_ENABLED",
  "RECEPTIONIST_LLM_PROVIDER",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_ACCOUNT_SID",
  "MISSED_CALL_PUBLIC_WEBHOOK_BASE",
  "MISSED_CALL_DURABLE_STORE",
  "SAAS_DURABLE_STORE",
  "DATABASE_URL",
  "MISSED_CALL_SMS_MODE",
];
const saved = new Map(keys.map((key) => [key, process.env[key]]));
const env = process.env as Record<string, string | undefined>;
const LINE = "+14385597001";
const CALLER = "+15145559876";
const CALL_SID = "CA0123456789abcdef0123456789abcdef";

function request(params: Record<string, string>) {
  return new NextRequest("https://tradecatch.test/api/twilio/voice/receptionist/incoming", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
}

/** A business whose first step fails; `recording` is what the owner chose. */
function failingLine(recording: boolean) {
  env.RECEPTIONIST_CONFIG_JSON = JSON.stringify({
    id: "rc_failsafe",
    clientAccountId: "client_failsafe",
    phoneNumberE164: LINE,
    businessName: "Plomberie Filet",
    languages: ["fr"],
    allowVoicemailOnly: true,
    smsRecoveryOnIncomplete: true,
    notifications: [{ type: "email", to: "owner@example.test" }],
  });
  const rt = getReceptionistRuntime();
  const real = rt.engine.resolveConfig.bind(rt.engine);
  mock.method(rt.engine, "startCall", async () => {
    throw new Error("the step failed");
  });
  mock.method(rt.engine, "resolveConfig", (to: string) => {
    const config = real(to);
    return config ? { ...config, callRecordingEnabled: recording } : config;
  });
  const texts: { callerE164: string; callSid: string }[] = [];
  mock.method(rt.engine, "sendFailSafeTextBack", async (_config: unknown, caller: { callerE164: string; callSid: string }) => {
    texts.push(caller);
    return true;
  });
  return texts;
}

async function call(params: Record<string, string>) {
  const response = await step(request({ CallSid: CALL_SID, To: LINE, ...params }), {
    params: Promise.resolve({ step: "incoming" }),
  });
  assert.equal(response.status, 200);
  return response.text();
}

beforeEach(() => {
  for (const key of keys) delete env[key];
  env.NODE_ENV = "test";
  env.RECEPTIONIST_LLM_PROVIDER = "none";
  env.MISSED_CALL_SMS_MODE = "dry-run";
  resetReceptionistRuntimeForTests();
  mock.method(console, "error", () => {});
  mock.method(console, "warn", () => {});
});

afterEach(() => {
  mock.restoreAll();
  resetReceptionistRuntimeForTests();
  for (const [key, value] of saved) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
});

test("recording off: the caller is told a text is coming, hears no 'call back', is not recorded, and is texted once", async () => {
  const texts = failingLine(false);
  const xml = await call({ From: CALLER });
  assert.match(xml, /message texte/);
  assert.doesNotMatch(xml, /<Record|rappeler|plus tard|call back/i);
  assert.match(xml, /<Hangup\/>/);
  assert.deepEqual(texts, [{ callerE164: CALLER, callSid: CALL_SID }]);
});

test("recording off, caller number unknown: no text is promised or sent; the team will see the call", async () => {
  for (const from of ["anonymous", ""]) {
    mock.restoreAll();
    mock.method(console, "error", () => {});
    resetReceptionistRuntimeForTests();
    const texts = failingLine(false);
    const xml = await call({ From: from });
    assert.match(xml, /notre équipe verra votre appel/, JSON.stringify(from));
    assert.doesNotMatch(xml, /<Record|message texte|rappeler|plus tard|call back/i, JSON.stringify(from));
    assert.equal(texts.length, 0, JSON.stringify(from));
  }
});

test("recording on: the voicemail is unchanged and no text is sent", async () => {
  const texts = failingLine(true);
  const xml = await call({ From: CALLER });
  assert.match(xml, /<Record/);
  assert.match(xml, /sera enregistré/);
  assert.equal(texts.length, 0);
});
