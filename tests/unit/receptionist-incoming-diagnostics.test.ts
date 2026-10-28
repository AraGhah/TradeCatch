import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { NextRequest } from "next/server";
import { POST as voice } from "../../src/app/api/webhooks/twilio/voice/route";
import { POST as step } from "../../src/app/api/twilio/voice/receptionist/[step]/route";
import {
  getReceptionistRuntime,
  receptionistReadiness,
  resetReceptionistRuntimeForTests,
} from "../../src/product/receptionist/runtime";
import { logReceptionistDiagnostic } from "../../src/product/receptionist/diagnostics";

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
const lines: string[] = [];
const phone = "+14385597001";
const callSid = "CA0123456789abcdef0123456789abcdef";
function request(path: string, params: Record<string, string>) {
  return new NextRequest(`https://tradecatch.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
}
beforeEach(() => {
  for (const key of keys) delete env[key];
  env.NODE_ENV = "test";
  env.RECEPTIONIST_LLM_PROVIDER = "none";
  env.MISSED_CALL_SMS_MODE = "dry-run";
  resetReceptionistRuntimeForTests();
  lines.length = 0;
  mock.method(console, "error", (line: string) => lines.push(line));
});
afterEach(() => {
  mock.restoreAll();
  resetReceptionistRuntimeForTests();
  for (const [key, value] of saved) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
});

test("canonical voice URL reproduces unconfigured voicemail and identifies the missing mapping", async () => {
  const response = await voice(
    request("/api/webhooks/twilio/voice", {
      CallSid: callSid,
      To: phone,
      From: "+15145559876",
    }),
  );
  assert.equal(response.status, 200);
  const xml = await response.text();
  assert.match(xml, /problème technique/);
  assert.match(
    xml,
    /<Record action="https:\/\/tradecatch.test\/api\/twilio\/voice\/receptionist\/voicemail"/,
  );
  assert.doesNotMatch(xml, /<Gather|<Connect|session=/);
  assert.deepEqual(JSON.parse(lines[0]!), {
    event: "tradecatch.receptionist.incoming_declined",
    code: "NO_ENABLED_CONFIG_FOR_NUMBER",
    callSid,
    profiles: 0,
    enabledProfiles: 0,
    dialedNumberLast4: "7001",
  });
  const ended = await step(
    request("/api/twilio/voice/receptionist/voicemail", {
      CallSid: callSid,
      From: "+15145559876",
      RecordingUrl: "https://private.example/recording",
      Digits: "#",
    }),
    { params: Promise.resolve({ step: "voicemail" }) },
  );
  assert.match(await ended.text(), /<Hangup\/>/);
  assert.match(lines.join(""), /MISSING_SESSION_ID/);
  assert.doesNotMatch(
    lines.join(""),
    /private\.example|15145559876|14385597001/,
  );
});

test("configured voicemail-only business starts a session and returns the correct gather URL", async () => {
  env.RECEPTIONIST_CONFIG_JSON = JSON.stringify({
    id: "rc_fixture",
    clientAccountId: "client_fixture",
    phoneNumberE164: phone,
    businessName: "Fixture Business",
    languages: ["fr"],
    allowVoicemailOnly: true,
    notifications: [{ type: "email", to: "owner@example.test" }],
  });
  const response = await voice(
    request("/api/webhooks/twilio/voice", {
      CallSid: callSid,
      To: phone,
      From: "+15145559876",
    }),
  );
  const xml = await response.text();
  assert.match(xml, /Fixture Business/);
  assert.match(
    xml,
    /<Gather[^>]+action="https:\/\/tradecatch.test\/api\/twilio\/voice\/receptionist\/gather\?session=rcs_/,
  );
  assert.doesNotMatch(xml, /problème technique|<Record|<Dial/);
  assert.equal(lines.length, 0);
});

test("a suppressed profile reload failure is exposed safely and clears on recovery", async () => {
  const rt = getReceptionistRuntime();
  const failure = Object.assign(
    new Error("postgres://user:password@host/db Bearer secret"),
    { code: "ECONNRESET" },
  );
  const method = mock.method(
    rt.profileStore,
    "listActivatedProfiles",
    async () => {
      throw failure;
    },
  );
  await rt.refresh(true);
  assert.equal(rt.profileLoadError, "ECONNRESET");
  assert.equal(
    receptionistReadiness().error,
    "PROFILE_RELOAD_FAILED:ECONNRESET",
  );
  assert.match(lines.join(""), /profile_reload_failed/);
  assert.doesNotMatch(lines.join(""), /password|Bearer|postgres:\/\//);
  method.mock.restore();
  await rt.refresh(true);
  assert.equal(rt.profileLoadError, undefined);
});

test("diagnostics never serialize exception messages, stacks, or arbitrary error codes", () => {
  logReceptionistDiagnostic({
    event: "webhook_failed",
    step: "incoming",
    callSid,
    error: Object.assign(
      new Error("sk-private-secret https://secret.example"),
      { code: "private-secret" },
    ),
  });
  assert.equal(JSON.parse(lines[0]!).errorCode, "UNKNOWN");
  assert.doesNotMatch(lines.join(""), /private-secret|secret\.example|stack/);
});
