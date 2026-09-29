import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { POST as demoRoute } from "../../src/app/api/receptionist/demo/route";
import {
  DemoError,
  runDemoTurn,
  signDemoState,
  verifyDemoState,
  type DemoResponse,
} from "../../src/product/receptionist/demo";

const SECRET = "test-secret-test-secret";

async function say(prev: DemoResponse, speech: string): Promise<DemoResponse> {
  assert.ok(prev.state, "call still in progress");
  return runDemoTurn({ action: "say", state: prev.state!, speech }, SECRET);
}

const agent = (r: DemoResponse) => r.messages.filter((m) => m.role === "agent").map((m) => m.text).join(" | ");

describe("website demo engine", () => {
  it("runs a complete French service request and returns a real summary", async () => {
    let r = await runDemoTurn({ action: "start", language: "fr", scenario: "open" }, SECRET);
    assert.equal(r.ended, false);
    assert.equal(r.afterHours, false);
    assert.match(agent(r), /Plomberie Nord \(démo\)/);
    assert.equal(r.step, "reason");

    r = await say(r, "j'ai un évier qui coule depuis hier");
    assert.equal(r.step, "name");
    r = await say(r, "je m'appelle Marie Tremblay");
    assert.equal(r.step, "address");
    r = await say(r, "123 rue Saint-Denis à Montréal");
    assert.equal(r.step, "callback");
    r = await say(r, "oui");
    assert.equal(r.step, "preferred_time");
    r = await say(r, "demain matin");

    assert.equal(r.ended, true);
    assert.equal(r.state, null);
    assert.equal(r.summary!.outcome, "message_taken");
    assert.equal(r.summary!.callerName, "Marie Tremblay");
    assert.equal(r.summary!.serviceAddress, "123 rue Saint-Denis à Montréal");
    assert.equal(r.summary!.preferredTime, "demain matin");
    assert.match(r.summary!.nextStep, /Rappeler/);
  });

  it("answers an FAQ in English then closes", async () => {
    let r = await runDemoTurn({ action: "start", language: "en", scenario: "open" }, SECRET);
    r = await say(r, "what are your opening hours?");
    assert.match(agent(r), /Monday to Friday/);
    r = await say(r, "no thanks");
    assert.equal(r.ended, true);
    assert.equal(r.summary!.outcome, "faq_answered");
    assert.equal(r.language, "en");
  });

  it("bridges an emergency (simulated) and never dials for real", async () => {
    let r = await runDemoTurn({ action: "start", language: "fr", scenario: "open" }, SECRET);
    r = await say(r, "je sens une forte odeur de gaz");
    assert.equal(r.ended, true);
    assert.deepEqual(r.transfer, { name: "l'équipe de garde", emergency: true });
    assert.match(agent(r), /9-1-1/);
    assert.ok(r.messages.some((m) => m.role === "system" && /simulé/i.test(m.text)));
    assert.equal(r.summary!.outcome, "emergency_transferred");
    assert.equal(r.summary!.urgency, "critical");
  });

  it("transfers to a department only when the office is open", async () => {
    let open = await runDemoTurn({ action: "start", language: "en", scenario: "open" }, SECRET);
    open = await say(open, "I need to talk to billing");
    assert.equal(open.transfer?.name, "billing");
    assert.equal(open.summary!.outcome, "transferred");

    let closed = await runDemoTurn({ action: "start", language: "en", scenario: "after_hours" }, SECRET);
    assert.equal(closed.afterHours, true);
    assert.match(agent(closed), /closed/i);
    closed = await say(closed, "I need to talk to billing");
    assert.equal(closed.transfer, undefined);
    assert.equal(closed.ended, false);
  });

  it("rejects tampered, foreign, and expired state", async () => {
    const start = await runDemoTurn({ action: "start", language: "fr", scenario: "open" }, SECRET);
    const [payload, sig] = start.state!.split(".");

    await assert.rejects(
      () => runDemoTurn({ action: "say", state: start.state!, speech: "x" }, "another-secret-another"),
      (e) => e instanceof DemoError && e.code === "invalid_state",
    );
    const forgedPayload = Buffer.from(
      JSON.stringify({ iat: Date.now(), session: { callSid: "demo_x", language: "fr" } }),
    ).toString("base64url");
    await assert.rejects(
      () => runDemoTurn({ action: "say", state: `${forgedPayload}.${sig}`, speech: "x" }, SECRET),
      (e) => e instanceof DemoError && e.code === "invalid_state",
    );
    await assert.rejects(
      () => runDemoTurn({ action: "say", state: `${payload}.`, speech: "x" }, SECRET),
      (e) => e instanceof DemoError,
    );

    const session = verifyDemoState(start.state!, SECRET);
    const old = signDemoState(session, SECRET, Date.now() - 31 * 60 * 1000);
    await assert.rejects(
      () => runDemoTurn({ action: "say", state: old, speech: "x" }, SECRET),
      (e) => e instanceof DemoError && e.code === "expired",
    );
    const notDemo = signDemoState({ ...session, callSid: "CA_real_call" }, SECRET);
    await assert.rejects(
      () => runDemoTurn({ action: "say", state: notDemo, speech: "x" }, SECRET),
      (e) => e instanceof DemoError && e.code === "invalid_state",
    );
  });
});

describe("website demo route", () => {
  const saved = new Map<string, string | undefined>();
  const env = process.env as Record<string, string | undefined>;
  const KEYS = ["NODE_ENV", "AUTH_SECRET", "SESSION_SECRET", "MISSED_CALL_OPS_SECRET", "RECEPTIONIST_DEMO", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"];

  beforeEach(() => {
    for (const k of KEYS) saved.set(k, env[k]);
    env.NODE_ENV = "test";
    env.AUTH_SECRET = SECRET;
    delete env.RECEPTIONIST_DEMO;
  });
  afterEach(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  });

  const post = (body: unknown, ip = "203.0.113.7") =>
    demoRoute(
      new NextRequest("http://localhost/api/receptionist/demo", {
        method: "POST",
        headers: { "x-real-ip": ip },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );

  it("plays a turn end to end and never sets cookies or needs auth", async () => {
    const res = await post({ action: "start", language: "fr" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const start = (await res.json()) as DemoResponse;
    assert.ok(start.state);

    const next = (await (await post({ action: "say", state: start.state, speech: "fuite d'eau" })).json()) as DemoResponse;
    assert.equal(next.step, "name");
  });

  it("validates input and payload size", async () => {
    assert.equal((await post("not json")).status, 400);
    assert.equal((await post({ action: "start", language: "de" })).status, 400);
    assert.equal((await post({ action: "say", state: "x".repeat(20), speech: "y".repeat(401) })).status, 400);
    assert.equal((await post({ action: "say", state: "x".repeat(70_000), speech: "hi" })).status, 413);
    const bad = await post({ action: "say", state: `${"a".repeat(30)}.${"b".repeat(30)}`, speech: "hi" });
    assert.equal(bad.status, 400);
  });

  it("can be disabled, fails closed in production without a secret, and rate limits per IP", async () => {
    env.RECEPTIONIST_DEMO = "0";
    assert.equal((await post({ action: "start", language: "en" })).status, 404);
    delete env.RECEPTIONIST_DEMO;

    env.NODE_ENV = "production";
    delete env.AUTH_SECRET;
    delete env.SESSION_SECRET;
    delete env.MISSED_CALL_OPS_SECRET;
    assert.equal((await post({ action: "start", language: "en" })).status, 503);
    env.NODE_ENV = "test";
    env.AUTH_SECRET = SECRET;

    const ip = "198.51.100.99";
    let last = 200;
    for (let i = 0; i < 62; i += 1) {
      last = (await post({ action: "start", language: "en" }, ip)).status;
    }
    assert.equal(last, 429);
    assert.equal((await post({ action: "start", language: "en" }, "198.51.100.100")).status, 200);
  });

  it("never touches Twilio (no outbound SMS attempted)", async () => {
    env.TWILIO_ACCOUNT_SID = "ACdemo";
    env.TWILIO_AUTH_TOKEN = "token";
    const realFetch = globalThis.fetch;
    let called = 0;
    globalThis.fetch = (async () => {
      called += 1;
      throw new Error("network must not be used by the demo");
    }) as typeof fetch;
    try {
      const start = (await (await post({ action: "start", language: "fr" })).json()) as DemoResponse;
      await post({ action: "say", state: start.state, speech: "odeur de gaz" });
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(called, 0);
  });
});
