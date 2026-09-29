import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { POST as twilioStep } from "../../src/app/api/twilio/voice/receptionist/[step]/route";
import { POST as sandbox } from "../../src/app/api/receptionist/sandbox/route";
import { GET as listCalls } from "../../src/app/api/receptionist/calls/route";
import { GET as tick } from "../../src/app/api/receptionist/tick/route";
import { resetReceptionistRuntimeForTests } from "../../src/product/receptionist/runtime";

const KEYS = [
  "NODE_ENV",
  "RECEPTIONIST_CONFIG_JSON",
  "RECEPTIONIST_ENABLED",
  "RECEPTIONIST_LLM_PROVIDER",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "MISSED_CALL_PUBLIC_WEBHOOK_BASE",
  "MISSED_CALL_SKIP_TWILIO_VALIDATE",
  "MISSED_CALL_SMS_MODE",
  "MISSED_CALL_OPS_SECRET",
  "CRON_SECRET",
  "MISSED_CALL_DURABLE_STORE",
  "DATABASE_URL",
  "MISSED_CALL_SANDBOX",
] as const;

const saved = new Map(KEYS.map((k) => [k, process.env[k]]));
const env = process.env as Record<string, string | undefined>;

const CONFIG = JSON.stringify({
  id: "rc_hook",
  clientAccountId: "client_hook",
  phoneNumberE164: "+14385597001",
  businessName: "Nord Plomberie",
  emergencyTransferE164: "+14385597003",
  fallbackTransferE164: "+14385597004",
  notifications: [{ type: "sms", toE164: "+14385597005" }],
});

function form(params: Record<string, string>) {
  return new URLSearchParams(params).toString();
}

function hook(step: string, params: Record<string, string>, opts: { query?: string; sign?: boolean } = {}) {
  const url = `https://tradecatch.test/api/twilio/voice/receptionist/${step}${opts.query ?? ""}`;
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (opts.sign) {
    const data =
      url +
      Object.keys(params)
        .sort()
        .map((k) => k + params[k])
        .join("");
    headers["x-twilio-signature"] = createHmac("sha1", "tok").update(Buffer.from(data, "utf8")).digest("base64");
  }
  return [
    new NextRequest(url, { method: "POST", headers, body: form(params) }),
    { params: Promise.resolve({ step }) },
  ] as const;
}

async function text(res: Response) {
  return res.text();
}

beforeEach(() => {
  resetReceptionistRuntimeForTests();
  env.NODE_ENV = "test";
  env.RECEPTIONIST_CONFIG_JSON = CONFIG;
  env.MISSED_CALL_SMS_MODE = "dry-run";
  env.RECEPTIONIST_LLM_PROVIDER = "none";
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "MISSED_CALL_SKIP_TWILIO_VALIDATE", "MISSED_CALL_OPS_SECRET", "CRON_SECRET", "MISSED_CALL_DURABLE_STORE", "DATABASE_URL", "MISSED_CALL_PUBLIC_WEBHOOK_BASE"]) {
    delete env[k];
  }
});

afterEach(() => {
  resetReceptionistRuntimeForTests();
  for (const [k, v] of saved) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
});

describe("Twilio receptionist webhooks", () => {
  it("answers an incoming call with TwiML and follows the gather callback", async () => {
    const incoming = await twilioStep(...hook("incoming", { CallSid: "CAw1", From: "+15145559876", To: "+14385597001" }));
    assert.equal(incoming.status, 200);
    assert.match(incoming.headers.get("content-type")!, /text\/xml/);
    const xml = await text(incoming);
    assert.match(xml, /<Gather /);
    assert.match(xml, /Nord Plomberie/);
    const session = xml.match(/receptionist\/gather\?session=(rcs_[0-9a-f-]+)/)?.[1];
    assert.ok(session, "gather action carries the session id");

    const menu = await twilioStep(...hook("gather", { CallSid: "CAw1", Digits: "1" }, { query: `?session=${session}` }));
    assert.match(await text(menu), /Comment puis-je vous aider/);

    const status = await twilioStep(...hook("status", { CallSid: "CAw1", CallStatus: "completed", CallDuration: "12" }));
    assert.equal(status.status, 200);
    assert.equal(await text(status), `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  });

  it("bridges emergencies with <Dial> and texts the owner", async () => {
    const incoming = await twilioStep(...hook("incoming", { CallSid: "CAw2", From: "+15145559876", To: "+14385597001" }));
    const session = (await text(incoming)).match(/session=(rcs_[0-9a-f-]+)/)![1]!;
    await twilioStep(...hook("gather", { CallSid: "CAw2", Digits: "2" }, { query: `?session=${session}` }));
    const res = await twilioStep(
      ...hook("gather", { CallSid: "CAw2", SpeechResult: "there is a gas leak in my house" }, { query: `?session=${session}` }),
    );
    const xml = await text(res);
    assert.match(xml, /<Dial [^>]*><Number>\+14385597003<\/Number><\/Dial>/);
    assert.match(xml, /9-1-1/);
  });

  it("rejects unknown steps and bad signatures, fails safe without a profile", async () => {
    const unknown = await twilioStep(...hook("nope", { CallSid: "x" }));
    assert.equal(unknown.status, 404);

    env.NODE_ENV = "production";
    env.TWILIO_AUTH_TOKEN = "tok";
    env.MISSED_CALL_PUBLIC_WEBHOOK_BASE = "https://tradecatch.test";
    const unsigned = await twilioStep(...hook("incoming", { CallSid: "CAx", From: "+15145559876", To: "+14385597001" }));
    assert.equal(unsigned.status, 403);
    env.NODE_ENV = "test";
    delete env.TWILIO_AUTH_TOKEN;
    delete env.MISSED_CALL_PUBLIC_WEBHOOK_BASE;

    delete env.RECEPTIONIST_CONFIG_JSON;
    resetReceptionistRuntimeForTests();
    const orphan = await twilioStep(...hook("incoming", { CallSid: "CAy", From: "+15145559876", To: "+14385597001" }));
    const xml = await text(orphan);
    assert.equal(orphan.status, 200);
    assert.match(xml, /problème technique/);
    assert.match(xml, /<Hangup\/>|<Record /);
  });

  it("accepts a correctly signed request in production", async () => {
    env.NODE_ENV = "production";
    env.TWILIO_AUTH_TOKEN = "tok";
    env.MISSED_CALL_PUBLIC_WEBHOOK_BASE = "https://tradecatch.test";
    env.TWILIO_ACCOUNT_SID = "ACtest";
    env.MISSED_CALL_DURABLE_STORE = "";
    // Production refuses the in-memory session store — the safe failure is a spoken apology.
    const res = await twilioStep(
      ...hook("incoming", { CallSid: "CAz", From: "+15145559876", To: "+14385597001" }, { sign: true }),
    );
    assert.equal(res.status, 200);
    assert.match(await text(res), /problème technique/);
  });
});

describe("receptionist ops routes", () => {
  it("sandbox drives a call end to end and ops endpoints list it", async () => {
    const post = (body: unknown) =>
      sandbox(new NextRequest("http://localhost/api/receptionist/sandbox", { method: "POST", body: JSON.stringify(body) }));

    const started = (await (await post({ action: "start", callSid: "CAs1", from: "+15145559876", to: "+14385597001" })).json()) as {
      sessionId: string;
      twiml: string;
    };
    assert.match(started.twiml, /<Gather /);

    await post({ action: "say", sessionId: started.sessionId, speech: "", digits: "1" });
    await post({ action: "say", sessionId: started.sessionId, speech: "besoin d'un plombier" });
    const ended = (await (await post({ action: "end", callSid: "CAs1", status: "completed", duration: 20 })).json()) as {
      finalized: boolean;
      summary: { outcome: string };
    };
    assert.equal(ended.finalized, true);

    const bad = await post({ action: "explode" });
    assert.equal(bad.status, 400);

    const list = (await (
      await listCalls(new NextRequest("http://localhost/api/receptionist/calls?clientAccountId=client_hook"))
    ).json()) as { calls: { callSid: string; turnCount: number }[] };
    assert.equal(list.calls.length, 1);
    assert.equal(list.calls[0]!.callSid, "CAs1");
    assert.ok(list.calls[0]!.turnCount > 0);
    assert.equal("turns" in list.calls[0]!, false, "list view never exposes transcripts");

    const t = (await (await tick(new NextRequest("http://localhost/api/receptionist/tick", { method: "POST" }))).json()) as { ok: boolean };
    assert.equal(t.ok, true);
  });

  it("requires the ops bearer when a secret is configured and 404s in production without the flag", async () => {
    env.MISSED_CALL_OPS_SECRET = "s3cret-s3cret";
    const denied = await listCalls(new NextRequest("http://localhost/api/receptionist/calls"));
    assert.equal(denied.status, 401);

    delete env.MISSED_CALL_OPS_SECRET;
    env.NODE_ENV = "production";
    delete env.MISSED_CALL_SANDBOX;
    const off = await sandbox(new NextRequest("http://localhost/api/receptionist/sandbox", { method: "POST", body: "{}" }));
    assert.equal(off.status, 404);
  });
});
