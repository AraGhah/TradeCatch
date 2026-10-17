import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { POST as demoRoute } from "../../src/app/api/receptionist/demo/route";
import {
  DemoError,
  MAX_DEMO_HISTORY,
  runDemoTurn,
  type DemoResponse,
  type DemoScenario,
} from "../../src/product/receptionist/demo";

/**
 * Plays a demo call the way the browser does: every turn sends the language,
 * the scenario and what the caller already said, and the server replays it.
 */
class Call {
  private history: string[] = [];
  constructor(
    private language: "fr" | "en",
    private scenario: DemoScenario,
  ) {}

  start(): Promise<DemoResponse> {
    return runDemoTurn({
      action: "start",
      language: this.language,
      scenario: this.scenario,
    });
  }

  async say(speech: string): Promise<DemoResponse> {
    const response = await runDemoTurn({
      action: "say",
      language: this.language,
      scenario: this.scenario,
      history: this.history,
      speech,
    });
    this.history = [...this.history, speech];
    return response;
  }
}

const agent = (r: DemoResponse) => r.messages.filter((m) => m.role === "agent").map((m) => m.text).join(" | ");

describe("website demo engine", () => {
  it("runs a complete French service request and returns a real summary", async () => {
    const call = new Call("fr", "open");
    let r = await call.start();
    assert.equal(r.ended, false);
    assert.equal(r.afterHours, false);
    assert.match(agent(r), /Plomberie Nord \(démo\)/);
    assert.equal(r.step, "reason");

    r = await call.say("j'ai un évier qui coule depuis hier");
    assert.equal(r.step, "name");
    r = await call.say("je m'appelle Marie Tremblay");
    assert.equal(r.step, "address");
    r = await call.say("123 rue Saint-Denis à Montréal");
    assert.equal(r.step, "callback");
    r = await call.say("oui");
    assert.equal(r.step, "preferred_time");
    r = await call.say("demain matin");

    assert.equal(r.ended, true);
    assert.equal(r.summary!.outcome, "message_taken");
    assert.equal(r.summary!.callerName, "Marie Tremblay");
    assert.equal(r.summary!.serviceAddress, "123 rue Saint-Denis à Montréal");
    assert.equal(r.summary!.preferredTime, "demain matin");
    assert.match(r.summary!.nextStep, /Rappeler/);
  });

  it("keeps a personal message instead of the service questionnaire", async () => {
    const call = new Call("fr", "open");
    await call.start();
    let r = await call.say("je suis malade");
    assert.match(agent(r), /malade/);
    assert.equal(r.step, "name");
    assert.doesNotMatch(agent(r), /adresse/);

    r = await call.say("je m'appelle Marie Tremblay");
    assert.equal(r.step, "callback");
    r = await call.say("5145550199");
    assert.notEqual(r.step, "address");
    assert.notEqual(r.step, "preferred_time");
  });

  it("answers an FAQ in English then closes", async () => {
    const call = new Call("en", "open");
    await call.start();
    let r = await call.say("what are your opening hours?");
    assert.match(agent(r), /Monday to Friday/);
    r = await call.say("no thanks");
    assert.equal(r.ended, true);
    assert.equal(r.summary!.outcome, "faq_answered");
    assert.equal(r.language, "en");
  });

  it("bridges an emergency (simulated) and never dials for real", async () => {
    const call = new Call("fr", "open");
    await call.start();
    const r = await call.say("je sens une forte odeur de gaz");
    assert.equal(r.ended, true);
    assert.deepEqual(r.transfer, { name: "l'équipe de garde", emergency: true });
    assert.match(agent(r), /9-1-1/);
    assert.ok(r.messages.some((m) => m.role === "system" && /simulé/i.test(m.text)));
    assert.equal(r.summary!.outcome, "emergency_transferred");
    assert.equal(r.summary!.urgency, "critical");
  });

  it("transfers to a department only when the office is open", async () => {
    const openCall = new Call("en", "open");
    await openCall.start();
    const open = await openCall.say("I need to talk to billing");
    assert.equal(open.transfer?.name, "billing");
    assert.equal(open.summary!.outcome, "transferred");

    const closedCall = new Call("en", "after_hours");
    const closedStart = await closedCall.start();
    assert.equal(closedStart.afterHours, true);
    assert.match(agent(closedStart), /closed/i);
    const closed = await closedCall.say("I need to talk to billing");
    assert.equal(closed.transfer, undefined);
    assert.equal(closed.ended, false);
  });

  it("replays a call identically, returning only the newest turn", async () => {
    const call = new Call("en", "open");
    const start = await call.start();
    const first = await call.say("my kitchen sink is leaking");
    assert.equal(first.step, "name");
    // The greeting is not repeated on later turns.
    assert.ok(!agent(first).includes(agent(start).split(" | ")[0]!));

    const again = await runDemoTurn({
      action: "say",
      language: "en",
      scenario: "open",
      history: ["my kitchen sink is leaking"],
      speech: "My name is Marie Tremblay",
    });
    assert.equal(again.step, "address");
    assert.match(agent(again), /Marie Tremblay/);
  });

  it("rejects histories that are not a live call", async () => {
    // The call ends on a gas smell, so nothing can follow it.
    await assert.rejects(
      () =>
        runDemoTurn({
          action: "say",
          language: "en",
          scenario: "open",
          history: ["I smell gas in my house"],
          speech: "hello?",
        }),
      (e) => e instanceof DemoError && e.code === "invalid_state",
    );
    await assert.rejects(
      () =>
        runDemoTurn({
          action: "say",
          language: "en",
          scenario: "open",
          history: Array.from({ length: MAX_DEMO_HISTORY + 1 }, () => "hi"),
          speech: "hi",
        }),
      (e) => e instanceof DemoError && e.code === "invalid_state",
    );
    await assert.rejects(
      () =>
        runDemoTurn({
          action: "say",
          language: "en",
          scenario: "open",
          history: [],
          speech: "   ",
        }),
      (e) => e instanceof DemoError,
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
    // The demo must not depend on any secret being configured.
    delete env.AUTH_SECRET;
    delete env.SESSION_SECRET;
    delete env.MISSED_CALL_OPS_SECRET;
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

  it("plays a turn end to end and never sets cookies or needs auth or a secret", async () => {
    const res = await post({ action: "start", language: "fr" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const start = (await res.json()) as DemoResponse;
    assert.equal(start.ended, false);

    const next = (await (
      await post({
        action: "say",
        language: "fr",
        scenario: "open",
        history: [],
        speech: "fuite d'eau",
      })
    ).json()) as DemoResponse;
    assert.equal(next.step, "name");
  });

  it("keeps working in production with no signing secret configured", async () => {
    env.NODE_ENV = "production";
    assert.equal((await post({ action: "start", language: "en" })).status, 200);
    const reply = await post({
      action: "say",
      language: "en",
      scenario: "after_hours",
      history: [],
      speech: "my sink is leaking",
    });
    assert.equal(reply.status, 200);
  });

  it("validates input and payload size", async () => {
    assert.equal((await post("not json")).status, 400);
    assert.equal((await post({ action: "start", language: "de" })).status, 400);
    assert.equal((await post({ action: "say", language: "en", speech: "y".repeat(401) })).status, 400);
    assert.equal((await post({ action: "say", language: "en", speech: "hi", history: Array(13).fill("hi") })).status, 400);
    assert.equal((await post({ action: "say", language: "en", speech: "hi", history: ["x".repeat(9_000)] })).status, 413);
    assert.equal((await post({ action: "say", language: "en", speech: "hi", history: ["I smell gas"] })).status, 400);
  });

  it("can be disabled and rate limits per IP", async () => {
    env.RECEPTIONIST_DEMO = "0";
    assert.equal((await post({ action: "start", language: "en" })).status, 404);
    delete env.RECEPTIONIST_DEMO;

    const ip = "198.51.100.99";
    let last = 200;
    for (let i = 0; i < 122; i += 1) {
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
      await post({ action: "start", language: "fr" });
      await post({ action: "say", language: "fr", scenario: "open", history: [], speech: "odeur de gaz" });
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(called, 0);
  });
});
