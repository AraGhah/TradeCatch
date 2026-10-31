import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";

const managed = [
  "NODE_ENV",
  "TRADECATCH_ENV",
  "TWILIO_AUTH_TOKEN",
  "MISSED_CALL_SKIP_TWILIO_VALIDATE",
];
const original = new Map(managed.map((key) => [key, process.env[key]]));
const mainTechnicianOnCallAllWeek = Array.from({ length: 7 }, (_, day) => ({
  day,
  start: "00:00",
  end: "23:59",
  technicianId: "tech_marc",
}));

function setNodeEnv(value: string) {
  (process.env as { NODE_ENV?: string }).NODE_ENV = value;
}

function resetGlobals() {
  const g = globalThis as unknown as {
    __tradecatchMissedCall?: unknown;
    __tradecatchMissedCallReadStore?: unknown;
  };
  delete g.__tradecatchMissedCall;
  delete g.__tradecatchMissedCallReadStore;
}

beforeEach(() => {
  managed.forEach((key) => delete process.env[key]);
  setNodeEnv("development");
  resetGlobals();
  mock.method(console, "warn", () => {});
  mock.method(console, "info", () => {});
});

afterEach(() => {
  mock.restoreAll();
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetGlobals();
});

function voiceRequest(params: Record<string, string>) {
  const body = new URLSearchParams(params).toString();
  return new NextRequest("http://localhost/api/twilio/voice/inbound", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

describe("POST /api/twilio/voice/inbound", () => {
  it("rejects a call with no To number", async () => {
    const { POST } = await import(
      "../../src/app/api/twilio/voice/inbound/route"
    );
    const response = await POST(voiceRequest({ From: "+15145551234" }));
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /<Reject/);
  });

  it("rejects a call to a number no organization has claimed", async () => {
    const { POST } = await import(
      "../../src/app/api/twilio/voice/inbound/route"
    );
    const response = await POST(
      voiceRequest({ From: "+15145551234", To: "+15145559999" }),
    );
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /<Reject/);
  });

  it("dials the current on-call technician for a linked organization", async () => {
    const { getMissedCallRuntime } = await import(
      "../../src/product/missed-call/runtime"
    );
    const client = demoClientAccount({
      id: "client_pilot",
      smsFromNumber: "+14162010199",
      onCallSchedule: mainTechnicianOnCallAllWeek,
    });
    const runtime = getMissedCallRuntime();
    await runtime.ready;
    await runtime.store.saveClient(client);

    const { POST } = await import(
      "../../src/app/api/twilio/voice/inbound/route"
    );
    const response = await POST(
      voiceRequest({ From: "+15145551234", To: "+14162010199" }),
    );
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /<Dial/);
    const onCallPhone = client.technicianRoster.find(
      (t) => t.id === client.mainTechnicianId,
    )!.phone;
    assert.ok(text.includes(onCallPhone));
  });

  it("rejects an invalid Twilio signature in production", async () => {
    setNodeEnv("production");
    process.env.TRADECATCH_ENV = "production";
    process.env.TWILIO_AUTH_TOKEN = "real-token";
    const { POST } = await import(
      "../../src/app/api/twilio/voice/inbound/route"
    );
    const request = voiceRequest({ From: "+15145551234", To: "+14162010199" });
    request.headers.set("x-twilio-signature", "forged");
    const response = await POST(request);
    assert.equal(response.status, 403);
  });
});
