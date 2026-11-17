/**
 * KAN-15 · the Twilio status webhook, end to end through the route: it must be
 * authentic, record the call it describes (and only that), and answer Twilio
 * with an empty TwiML whatever happens inside.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { POST as step } from "../../src/app/api/twilio/voice/receptionist/[step]/route";
import { POST as statusAlias } from "../../src/app/api/webhooks/twilio/status/route";
import {
  getReceptionistRuntime,
  resetReceptionistRuntimeForTests,
} from "../../src/product/receptionist/runtime";

const KEYS = [
  "NODE_ENV",
  "RECEPTIONIST_CONFIG_JSON",
  "RECEPTIONIST_LLM_PROVIDER",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_ACCOUNT_SID",
  "MISSED_CALL_PUBLIC_WEBHOOK_BASE",
  "MISSED_CALL_SKIP_TWILIO_VALIDATE",
  "MISSED_CALL_SMS_MODE",
  "MISSED_CALL_DURABLE_STORE",
  "SAAS_DURABLE_STORE",
  "DATABASE_URL",
] as const;
const saved = new Map(KEYS.map((k) => [k, process.env[k]]));
const env = process.env as Record<string, string | undefined>;

const LINE = "+14385597001";
const CALLER = "+15145559876";
const SID = "CA0123456789abcdef0123456789abcdef";
const BASE = "https://tradecatch.test";
const EMPTY = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

function signed(path: string, params: Record<string, string>, token = "tok") {
  const url = `${BASE}${path}`;
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": createHmac("sha1", token).update(Buffer.from(data, "utf8")).digest("base64"),
    },
    body: new URLSearchParams(params).toString(),
  });
}

const statusStep = (params: Record<string, string>, token?: string) =>
  step(signed("/api/twilio/voice/receptionist/status", params, token), {
    params: Promise.resolve({ step: "status" }),
  });

async function calls() {
  const { store } = getReceptionistRuntime();
  return store.listSessions({ clientAccountId: "client_hook" });
}

beforeEach(() => {
  for (const k of KEYS) delete env[k];
  env.NODE_ENV = "test";
  env.RECEPTIONIST_LLM_PROVIDER = "none";
  env.MISSED_CALL_SMS_MODE = "dry-run";
  env.TWILIO_AUTH_TOKEN = "tok";
  env.TWILIO_ACCOUNT_SID = "ACtest";
  env.MISSED_CALL_PUBLIC_WEBHOOK_BASE = BASE;
  env.RECEPTIONIST_CONFIG_JSON = JSON.stringify({
    id: "rc_hook",
    clientAccountId: "client_hook",
    phoneNumberE164: LINE,
    businessName: "Nord Plomberie",
    notifications: [{ type: "email", to: "owner@example.test" }],
  });
  resetReceptionistRuntimeForTests();
  mock.method(console, "error", () => {});
  mock.method(console, "warn", () => {});
  mock.method(console, "info", () => {});
});

afterEach(() => {
  mock.restoreAll();
  resetReceptionistRuntimeForTests();
  for (const [k, v] of saved) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
});

describe("Twilio status webhook", () => {
  it("rejects a request that is not signed by Twilio, and records nothing", async () => {
    const params = { CallSid: SID, CallStatus: "completed", CallDuration: "300", From: CALLER, To: LINE };
    // Signed with a token that is not ours.
    assert.equal((await statusStep(params, "wrong-token")).status, 403);
    // No signature at all.
    const unsigned = await step(
      new NextRequest(`${BASE}/api/twilio/voice/receptionist/status`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
      }),
      { params: Promise.resolve({ step: "status" }) },
    );
    assert.equal(unsigned.status, 403);
    // A genuine signature over different values (a tampered body).
    const tampered = signed("/api/twilio/voice/receptionist/status", { ...params, CallDuration: "1" });
    const forged = new NextRequest(tampered.url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": tampered.headers.get("x-twilio-signature")! },
      body: new URLSearchParams(params).toString(),
    });
    assert.equal((await step(forged, { params: Promise.resolve({ step: "status" }) })).status, 403);
    assert.deepEqual(await calls(), []);

    // The genuine request is accepted and recorded.
    assert.equal((await statusStep(params)).status, 200);
    assert.equal((await calls()).length, 1);
  });

  it("records a call whose own webhook never arrived, with E.164 numbers, once", async () => {
    const params = {
      CallSid: SID,
      CallStatus: "completed",
      CallDuration: "300",
      From: "(514) 555-9876",
      To: LINE,
      Direction: "inbound",
    };
    const first = await statusStep(params);
    assert.equal(first.status, 200);
    assert.equal(await first.text(), EMPTY);
    // Twilio sends the same callback again.
    await statusStep(params);
    await statusAlias(signed("/api/webhooks/twilio/status", params));

    const saved = await calls();
    assert.equal(saved.length, 1, "one call, however many times it is reported");
    assert.equal(saved[0]!.callSid, SID);
    assert.equal(saved[0]!.fromE164, CALLER);
    assert.equal(saved[0]!.toE164, LINE);
    assert.equal(saved[0]!.durationSeconds, 300);
    assert.equal(saved[0]!.activity?.providerStatus, "completed");
  });

  it("does not record a leg the platform dialed out to the owner", async () => {
    const res = await statusStep({
      CallSid: "CAchild00000000000000000000000000aa",
      ParentCallSid: SID,
      CallStatus: "completed",
      CallDuration: "30",
      From: LINE,
      To: "+15145550100",
      Direction: "outbound-dial",
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await calls(), []);
  });

  it("answers Twilio normally, and records nothing, for a number that is not a business's", async () => {
    env.RECEPTIONIST_CONFIG_JSON = JSON.stringify([
      { id: "rc_a", clientAccountId: "client_a", phoneNumberE164: LINE, businessName: "A" },
      { id: "rc_b", clientAccountId: "client_b", phoneNumberE164: "+14385597002", businessName: "B" },
    ]);
    resetReceptionistRuntimeForTests();
    const res = await statusStep({ CallSid: SID, CallStatus: "completed", From: CALLER, To: "+19995550000" });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), EMPTY);
    const { store } = getReceptionistRuntime();
    assert.deepEqual(await store.listSessions({}), []);
  });

  it("ignores a status that is not final", async () => {
    for (const s of ["queued", "initiated", "ringing", "in-progress"]) {
      await statusStep({ CallSid: SID, CallStatus: s, From: CALLER, To: LINE });
    }
    assert.deepEqual(await calls(), []);
  });
});
