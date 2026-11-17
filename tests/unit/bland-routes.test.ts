import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { POST as availability } from "../../src/app/api/bland/availability/route";
import { POST as appointments } from "../../src/app/api/bland/appointments/route";
import { POST as book } from "../../src/app/api/bland/book/route";
import { GET as config } from "../../src/app/api/bland/config/route";
import { POST as details } from "../../src/app/api/bland/details/route";
import { POST as report } from "../../src/app/api/bland/report/route";
import { POST as opsAvailability } from "../../src/app/api/receptionist/agent/availability/route";
import {
  getReceptionistRuntime,
  resetReceptionistRuntimeForTests,
} from "../../src/product/receptionist/runtime";
import {
  hashBlandToken,
  resetBlandLinesCacheForTests,
} from "../../src/product/receptionist/bland/lines";

const OPS_SECRET = "ops-secret-never-given-to-bland";
const TOKEN_A = "tcbl_token_for_line_a_0123456789";
const TOKEN_B = "tcbl_token_for_line_b_0123456789";
const LINE_A = "+15145550111";
const LINE_B = "+15145550222";
const BUSINESS_A = "+14385550100";
const BUSINESS_B = "+14385550200";
const CALLER = "+15145559876";

const businessConfig = (id: string, number: string, name: string) => ({
  id,
  clientAccountId: `client_${id}`,
  phoneNumberE164: number,
  businessName: name,
  languages: ["fr", "en"],
  defaultLanguage: "en",
  notifications: [],
  fallbackTransferE164: "+15145550142",
  emergencyTransferE164: "+15145550143",
  transferHours: "always",
});

type Handler = (request: NextRequest) => Promise<Response>;

function post(handler: Handler, body: unknown, token?: string, raw?: string) {
  return handler(
    new NextRequest("http://localhost/api/bland/x", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: raw ?? JSON.stringify(body),
    }),
  );
}

const callA = { number: LINE_A, callId: "bland-call-aaaa1", from: CALLER };

describe("Bland endpoints", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.MISSED_CALL_OPS_SECRET = OPS_SECRET;
    process.env.RECEPTIONIST_CONFIG_JSON = JSON.stringify([
      businessConfig("rc_a", BUSINESS_A, "Nord Plomberie"),
      businessConfig("rc_b", BUSINESS_B, "Sud Électrique"),
    ]);
    process.env.BLAND_LINES_JSON = JSON.stringify([
      { number: LINE_A, receptionistNumber: BUSINESS_A, tokenSha256: hashBlandToken(TOKEN_A) },
      { number: LINE_B, receptionistNumber: BUSINESS_B, tokenSha256: hashBlandToken(TOKEN_B) },
    ]);
    resetBlandLinesCacheForTests();
    resetReceptionistRuntimeForTests();
  });
  afterEach(() => {
    process.env = { ...saved };
    resetBlandLinesCacheForTests();
    resetReceptionistRuntimeForTests();
  });

  const toolRoutes = [
    ["availability", availability, { ...callA }],
    ["book", book, { ...callA, startAt: "2026-11-18T15:00:00.000Z" }],
    ["appointments", appointments, { ...callA, action: "find", callerName: "Marie" }],
    ["details", details, { ...callA, callerName: "Marie" }],
    ["report", report, { ...callA, intent: "message" }],
  ] as const;

  describe("authentication", () => {
    for (const [name, handler, body] of toolRoutes) {
      it(`${name}: refuses a missing or wrong token`, async () => {
        assert.equal((await post(handler, body)).status, 401);
        assert.equal((await post(handler, body, "tcbl_wrong")).status, 401);
      });

      it(`${name}: refuses the general operations secret`, async () => {
        assert.equal((await post(handler, body, OPS_SECRET)).status, 401);
      });

      it(`${name}: another line's token cannot act for this line`, async () => {
        assert.equal((await post(handler, body, TOKEN_B)).status, 401);
      });

      it(`${name}: accepts the line's own token`, async () => {
        assert.equal((await post(handler, body, TOKEN_A)).status, 200);
      });
    }

    it("an unknown line, a wrong token and a missing token are indistinguishable", async () => {
      const responses = await Promise.all([
        post(details, { ...callA, number: "+15145550999" }, TOKEN_A),
        post(details, callA, "tcbl_wrong"),
        post(details, callA),
        post(details, { ...callA, number: undefined }, TOKEN_A),
      ]);
      const bodies = await Promise.all(responses.map((r) => r.text()));
      assert.deepEqual(
        responses.map((r) => r.status),
        [401, 401, 401, 401],
      );
      assert.equal(new Set(bodies).size, 1, "same body, nothing says which numbers exist");
    });

    it("the line token is not accepted by the operations endpoints", async () => {
      const res = await opsAvailability(
        new NextRequest("http://localhost/api/receptionist/agent/availability", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN_A}` },
          body: JSON.stringify({ number: BUSINESS_A, callId: "bland-call-aaaa1", language: "en" }),
        }),
      );
      assert.equal(res.status, 401);
    });

    it("responses are never cached", async () => {
      const res = await post(details, callA, TOKEN_A);
      assert.equal(res.headers.get("cache-control"), "no-store");
    });
  });

  describe("input handling", () => {
    it("rejects a body that is not JSON", async () => {
      assert.equal((await post(details, null, TOKEN_A, "{nope")).status, 400);
    });

    it("rejects a body that is too large", async () => {
      const big = JSON.stringify({ ...callA, message: "x".repeat(300_000) });
      assert.equal((await post(details, null, TOKEN_A, big)).status, 413);
    });

    it("names the bad fields but never echoes what the caller said", async () => {
      const res = await post(book, { ...callA, startAt: "<script>x</script>", callId: "bad id!!" }, TOKEN_A);
      assert.equal(res.status, 400);
      const text = await res.text();
      assert.match(text, /callId/);
      assert.doesNotMatch(text, /script/);
    });

    it("ignores values a template left unfilled", async () => {
      const res = await post(
        details,
        { ...callA, callerName: "{{input.callerName}}", serviceAddress: "", issue: "no heat" },
        TOKEN_A,
      );
      assert.deepEqual(await res.json(), { ok: true, result: { saved: ["issue"] } });
    });

    it("the caller is the number Bland says is calling, not one the model supplied", async () => {
      // `from` comes from {{phone_number}}; a body cannot swap in another party
      // through a field the schema does not have.
      const res = await post(
        appointments,
        { ...callA, action: "find", callerName: "Marie", callerE164: "+15145550000" },
        TOKEN_A,
      );
      assert.equal(res.status, 200);
    });
  });

  describe("tenant isolation", () => {
    it("a line only ever reaches its own business", async () => {
      const a = await (await post(details, callA, TOKEN_A)).json();
      assert.equal((a as { ok: boolean }).ok, true);
      const runtime = getReceptionistRuntime();
      const session = await runtime.store.getSessionByCallSid("bl_bland-call-aaaa1");
      assert.equal(session?.clientAccountId, "client_rc_a");
    });

    it("a call id started on one line cannot be used on another", async () => {
      assert.equal((await post(details, { ...callA, callerName: "Marie" }, TOKEN_A)).status, 200);
      const hijack = await post(details, { ...callA, number: LINE_B, callerName: "Mallory" }, TOKEN_B);
      assert.equal(hijack.status, 409);
      const session = await getReceptionistRuntime().store.getSessionByCallSid("bl_bland-call-aaaa1");
      assert.equal(session?.slots.callerName, "Marie");
    });

    it("the call-start config for a line holds that business only", async () => {
      const res = await config(
        new NextRequest(
          `http://localhost/api/bland/config?number=${encodeURIComponent(LINE_A)}&from=${encodeURIComponent(CALLER)}&callId=bland-call-aaaa1`,
          { headers: { authorization: `Bearer ${TOKEN_A}` } },
        ),
      );
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.match(text, /Nord Plomberie/);
      assert.doesNotMatch(text, /Sud/);
      assert.doesNotMatch(text, new RegExp(BUSINESS_B.slice(1)));
    });

    it("the config endpoint refuses another line's token", async () => {
      const res = await config(
        new NextRequest(`http://localhost/api/bland/config?number=${encodeURIComponent(LINE_A)}`, {
          headers: { authorization: `Bearer ${TOKEN_B}` },
        }),
      );
      assert.equal(res.status, 401);
    });
  });

  describe("booking is not simulated", () => {
    it("offers no times and confirms nothing while no real calendar is connected", async () => {
      assert.deepEqual(await (await post(availability, callA, TOKEN_A)).json(), {
        ok: true,
        availability: { ok: false, reason: "booking_disabled" },
      });
      const booked = (await (
        await post(
          book,
          {
            ...callA,
            startAt: "2026-11-18T15:00:00.000Z",
            callerName: "Marie",
            serviceAddress: "123 Rue Principale, Laval",
          },
          TOKEN_A,
        )
      ).json()) as { booking: { status: string; reason: string } };
      assert.equal(booked.booking.status, "request");
      assert.equal(booked.booking.reason, "booking_disabled");
    });

    it("the call-start config says booking is not available", async () => {
      const res = await config(
        new NextRequest(`http://localhost/api/bland/config?number=${encodeURIComponent(LINE_A)}`, {
          headers: { authorization: `Bearer ${TOKEN_A}` },
        }),
      );
      const body = (await res.json()) as { config: { capabilities: { booking: boolean; bookingProvider: string } } };
      assert.equal(body.config.capabilities.booking, false);
      assert.equal(body.config.capabilities.bookingProvider, "none");
    });
  });

  describe("the call report", () => {
    it("records the call and never lets the model claim a person answered a transfer", async () => {
      const res = await post(
        report,
        {
          ...callA,
          intent: "transfer",
          callerName: "Marie",
          transferCompleted: "true",
          transferTarget: "Owner",
          endReason: "completed",
        },
        TOKEN_A,
      );
      assert.equal(res.status, 200);
      const session = await getReceptionistRuntime().store.getSessionByCallSid("bl_bland-call-aaaa1");
      assert.equal(session?.transfers.length, 1);
      assert.equal(session?.transfers[0].status, "completed");
      assert.equal(session?.transfers[0].answerConfirmed, false);
    });

    it("repeating the report does not create a second call", async () => {
      await post(report, { ...callA, intent: "message" }, TOKEN_A);
      await post(report, { ...callA, intent: "message" }, TOKEN_A);
      const all = await getReceptionistRuntime().store.listSessions({});
      assert.equal(all.length, 1);
    });
  });
});
