import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { POST as availability } from "../../src/app/api/receptionist/agent/availability/route";
import { POST as book } from "../../src/app/api/receptionist/agent/book/route";
import { POST as report } from "../../src/app/api/receptionist/agent/report/route";
import {
  getReceptionistRuntime,
  resetReceptionistRuntimeForTests,
} from "../../src/product/receptionist/runtime";

const SECRET = "s3cret-s3cret";
const NUMBER = "+14385550100";

const CONFIG = {
  id: "rc_agent_routes",
  clientAccountId: "client_agent_routes",
  phoneNumberE164: NUMBER,
  businessName: "Nord Plomberie",
  languages: ["fr", "en"],
  defaultLanguage: "fr",
  // No owner notification targets: this test must not send anything.
  notifications: [],
};

function post(
  handler: typeof availability,
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${SECRET}` },
  raw?: string,
) {
  return handler(
    new NextRequest("http://localhost/api/receptionist/agent/x", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: raw ?? JSON.stringify(body),
    }),
  );
}

const call = { number: NUMBER, callId: "call-route-1", language: "fr", from: "+15145559876" };

describe("voice agent endpoints", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.MISSED_CALL_OPS_SECRET = SECRET;
    process.env.RECEPTIONIST_CONFIG_JSON = JSON.stringify([CONFIG]);
    resetReceptionistRuntimeForTests();
  });
  afterEach(() => {
    process.env = { ...saved };
    resetReceptionistRuntimeForTests();
  });

  const routes = [
    ["availability", availability],
    ["book", book],
    ["report", report],
  ] as const;

  for (const [name, handler] of routes) {
    it(`${name}: refuses a request without the ops bearer`, async () => {
      assert.equal((await post(handler, call, {})).status, 401);
      assert.equal((await post(handler, call, { authorization: "Bearer wrong" })).status, 401);
    });

    it(`${name}: rejects a body that is not JSON`, async () => {
      assert.equal((await post(handler, null, undefined, "{nope")).status, 400);
    });

    it(`${name}: does not answer an unknown number as some other business`, async () => {
      const res = await post(handler, { ...call, number: "+14165550199", startAt: "2026-10-22T13:00:00Z" });
      assert.equal(res.status, 404);
    });

    it(`${name}: names the bad fields but never echoes what the caller said`, async () => {
      const res = await post(handler, {
        ...call,
        callId: "bad id <script>alert(1)</script>",
        language: "de",
        startAt: "2026-10-22T13:00:00Z",
      });
      assert.equal(res.status, 400);
      const text = await res.text();
      const body = JSON.parse(text) as { fields: string[] };
      assert.ok(body.fields.includes("callId"));
      assert.ok(body.fields.includes("language"));
      assert.doesNotMatch(text, /script/);
    });
  }

  it("refuses an oversize body", async () => {
    const res = await post(report, { ...call, slots: { issue: "x".repeat(300_000) } });
    assert.equal(res.status, 413);
  });

  it("rejects out-of-range values instead of storing them", async () => {
    for (const body of [
      { ...call, slots: { callerName: "x".repeat(81) } },
      { ...call, transcript: [{ speaker: "robot", text: "hi" }] },
      { ...call, durationSeconds: -5 },
      { ...call, endReason: "exploded" },
    ]) {
      assert.equal((await post(report, body)).status, 400, JSON.stringify(body).slice(0, 60));
    }
  });

  it("availability and booking say 'not available' when the owner has not enabled phone booking", async () => {
    const a = await post(availability, call);
    assert.equal(a.status, 200);
    assert.deepEqual(await a.json(), {
      ok: true,
      availability: { ok: false, reason: "booking_disabled" },
    });

    const b = await post(book, {
      ...call,
      startAt: "2026-10-22T13:00:00Z",
      callerName: "Marie",
      callbackE164: "+15145559876",
      serviceAddress: "12 rue des Pins",
    });
    assert.equal(b.status, 200);
    assert.deepEqual(await b.json(), {
      ok: true,
      booking: { status: "request", reason: "booking_disabled" },
    });
  });

  it("records the finished call once, however many times it is sent", async () => {
    const body = {
      ...call,
      intent: "service_request",
      slots: {
        callerName: "Marie Tremblay",
        callbackE164: "+15145559876",
        serviceAddress: "12 rue des Pins, Laval",
        issue: "fuite sous l'évier",
      },
      transcript: [
        { speaker: "caller", text: "J'ai une fuite" },
        { speaker: "agent", text: "Je prends votre demande." },
      ],
      durationSeconds: 80,
      endReason: "completed",
    };
    const first = await post(report, body);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), {
      ok: true,
      recorded: true,
      outcome: "message_taken",
      notified: 0,
    });
    const again = await post(report, body);
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as { recorded: boolean }).recorded, true);

    const sessions = await getReceptionistRuntime().store.listSessions({});
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]!.callSid, "lk_call-route-1");
    assert.equal(sessions[0]!.slots.callerName, "Marie Tremblay");
    assert.equal(sessions[0]!.turns.length, 2);
  });
});
