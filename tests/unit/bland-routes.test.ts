import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { POST as appointments } from "../../src/app/api/bland/appointments/route";
import { POST as availability } from "../../src/app/api/bland/availability/route";
import { POST as book } from "../../src/app/api/bland/book/route";
import { GET as configRoute } from "../../src/app/api/bland/config/route";
import { POST as details } from "../../src/app/api/bland/details/route";
import { POST as report } from "../../src/app/api/bland/report/route";
import { POST as webhook } from "../../src/app/api/bland/webhook/route";
import { resetBlandRoutesForTests } from "../../src/product/bland/routes";
import {
  getReceptionistRuntime,
  resetReceptionistRuntimeForTests,
} from "../../src/product/receptionist/runtime";

const TOOL = "tool-secret-for-tests-0123456789abcdef";
const WEBHOOK = "webhook-secret-for-tests-0123456789abc";
const OPS = "ops-secret-for-tests-0123456789abcdef-x";

const LINE_A = "+14385550100";
const LINE_B = "+14385550101";
const LINE_LOOP = "+14385550102";

const CONFIGS = [
  {
    id: "rc_bland_a",
    clientAccountId: "client_bland_a",
    phoneNumberE164: "+15145550001",
    businessName: "Nord Plomberie",
    languages: ["fr", "en"],
    defaultLanguage: "fr",
    notifications: [],
    transferHours: "always",
    fallbackTransferE164: "+15145550111",
    backupTransferE164: "+15145550333",
    emergencyTransferE164: "+15145550222",
    phoneBooking: true,
  },
  {
    id: "rc_bland_b",
    clientAccountId: "client_bland_b",
    phoneNumberE164: "+15145550002",
    businessName: "Sud Toiture",
    languages: ["fr", "en"],
    defaultLanguage: "en",
    notifications: [],
  },
  {
    // Transfers into a line this system owns: both must be refused.
    id: "rc_bland_loop",
    clientAccountId: "client_bland_loop",
    phoneNumberE164: "+15145550003",
    businessName: "Boucle Inc",
    notifications: [],
    transferHours: "always",
    fallbackTransferE164: LINE_LOOP,
    emergencyTransferE164: LINE_B,
  },
];

const ROUTES = [
  { toE164: LINE_A, configId: "rc_bland_a" },
  { toE164: LINE_B, configId: "rc_bland_b" },
  { toE164: LINE_LOOP, configId: "rc_bland_loop" },
];

const A = { to: LINE_A, call_id: "call-bland-a1", from: "+15145559876" };

function post(
  handler: (request: NextRequest) => Promise<Response>,
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${TOOL}` },
  raw?: string,
) {
  return handler(
    new NextRequest("http://localhost/api/bland/x", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: raw ?? JSON.stringify(body),
    }),
  );
}

function get(
  params: Record<string, string>,
  headers: Record<string, string> = { authorization: `Bearer ${TOOL}` },
) {
  const url = new URL("http://localhost/api/bland/config");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return configRoute(new NextRequest(url, { headers }));
}

type Json = Record<string, unknown>;
const json = async (res: Response) => (await res.json()) as Json;

describe("Bland tool endpoints", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.BLAND_TOOL_SECRET = TOOL;
    process.env.BLAND_WEBHOOK_SECRET = WEBHOOK;
    process.env.MISSED_CALL_OPS_SECRET = OPS;
    process.env.RECEPTIONIST_CONFIG_JSON = JSON.stringify(CONFIGS);
    process.env.BLAND_ROUTES_JSON = JSON.stringify(ROUTES);
    resetBlandRoutesForTests();
    resetReceptionistRuntimeForTests();
    mock.method(console, "warn", () => {});
    mock.method(console, "error", () => {});
  });
  afterEach(() => {
    process.env = { ...saved };
    resetBlandRoutesForTests();
    resetReceptionistRuntimeForTests();
    mock.restoreAll();
  });

  const postRoutes = [
    ["availability", availability],
    ["book", book],
    ["details", details],
    ["appointments", appointments],
    ["report", report],
  ] as const;

  describe("authentication", () => {
    for (const [name, handler] of postRoutes) {
      it(`${name}: refuses a missing, wrong or operations bearer`, async () => {
        const body = { ...A, action: "find", start_at: "2026-10-22T13:00:00Z" };
        const attempts: Record<string, string>[] = [
          {},
          { authorization: "Bearer wrong" },
          { authorization: `Bearer ${OPS}` },
          { authorization: `Bearer ${WEBHOOK}` },
        ];
        for (const headers of attempts) {
          const res = await post(handler, body, headers);
          assert.equal(res.status, 401, JSON.stringify(headers));
          assert.equal(res.headers.get("cache-control"), "no-store");
        }
      });

      it(`${name}: fails closed with 503 when no tool secret is configured`, async () => {
        delete process.env.BLAND_TOOL_SECRET;
        const res = await post(handler, { ...A, action: "find" });
        assert.equal(res.status, 503);
      });
    }

    it("config: same bearer rules", async () => {
      assert.equal((await get({ to: LINE_A, call_id: A.call_id }, {})).status, 401);
      assert.equal((await get({ to: LINE_A, call_id: A.call_id }, { authorization: `Bearer ${OPS}` })).status, 401);
      assert.equal((await get({ to: LINE_A, call_id: A.call_id })).status, 200);
      delete process.env.BLAND_TOOL_SECRET;
      assert.equal((await get({ to: LINE_A, call_id: A.call_id })).status, 503);
    });
  });

  describe("input and tenant", () => {
    for (const [name, handler] of postRoutes) {
      it(`${name}: does not answer an unrouted number as some other business`, async () => {
        const res = await post(handler, { ...A, to: "+14165550199", action: "find", start_at: "2026-10-22T13:00:00Z" });
        assert.equal(res.status, 404);
        assert.equal((await json(res)).code, "no_route");
      });

      it(`${name}: names the bad fields but never echoes what the caller said`, async () => {
        const res = await post(handler, {
          ...A,
          call_id: "bad id <script>alert(1)</script>",
          to: "1",
          action: "find",
          start_at: "2026-10-22T13:00:00Z",
        });
        assert.equal(res.status, 400);
        const text = await res.text();
        const body = JSON.parse(text) as { fields: string[] };
        assert.ok(body.fields.includes("call_id"));
        assert.ok(body.fields.includes("to"));
        assert.doesNotMatch(text, /script/);
      });
    }

    it("rejects a body that is not a JSON object, and one that is too large", async () => {
      assert.equal((await post(details, null, undefined, "{nope")).status, 400);
      assert.equal((await post(details, null, undefined, "[1,2]")).status, 400);
      assert.equal((await post(details, { ...A, caller_name: "x".repeat(40_000) })).status, 413);
    });

    it("rejects out-of-range values instead of storing them", async () => {
      assert.equal((await post(details, { ...A, caller_name: "x".repeat(81) })).status, 400);
      assert.equal((await post(appointments, { ...A, action: "drop_table" })).status, 400);
      assert.equal((await post(appointments, { ...A, action: "text", kind: "anything" })).status, 400);
    });

    it("treats a blank or an unfilled template as 'not given', never as something the caller said", async () => {
      const saved = await post(details, { ...A, caller_name: "Marie Tremblay", use_caller_id: true });
      assert.equal(saved.status, 200);
      // Control: a call with no confirmed name is asked for one.
      const fresh = { ...A, call_id: "call-bland-a9" };
      const asked = await json(await post(appointments, { ...fresh, action: "find", caller_name: "" }));
      assert.deepEqual(asked.result, { status: "name_needed" });
      // The model left the name out: "" or Bland's own unfilled placeholder.
      // The confirmed name is used instead, so the lookup proceeds (this business has no
      // appointment management behind it, hence "disabled", but never "name_needed").
      for (const blank of ["", "   ", "{{input.caller_name}}"]) {
        const res = await json(await post(appointments, { ...A, action: "find", caller_name: blank }));
        assert.deepEqual(res.result, { status: "disabled" }, JSON.stringify(blank));
      }
      const again = await json(await post(details, { ...A, caller_name: "{{input.caller_name}}", address: "" }));
      const kept = (again.details as Json).confirmed as Json;
      assert.equal(kept.callerName, "Marie Tremblay", "a template did not replace the confirmed name");
      assert.equal(kept.serviceAddress, undefined);
      // {{from}} unresolved (withheld caller ID) is not a phone number.
      const hidden = await json(
        await post(details, { ...A, call_id: "call-bland-a2", from: "{{from}}", use_caller_id: "true" }),
      );
      assert.deepEqual((hidden.details as Json).rejected, ["callbackE164"]);
    });

    it("an unresolved language variable falls back to the business default", async () => {
      const res = await get({ to: LINE_B, call_id: "call-bland-b1", language: "{{language}}" });
      assert.equal(res.status, 200);
      assert.equal(((await json(res)).config as Json).language, "en");
    });

    it("the same call id cannot be used on another business", async () => {
      const first = await post(details, { ...A, caller_name: "Marie Tremblay" });
      assert.equal(first.status, 200);
      const intruder = await post(details, { ...A, to: LINE_B, caller_name: "Mallory" });
      assert.equal(intruder.status, 409);
      assert.equal((await json(intruder)).code, "call_conflict");
      const viaReport = await post(report, { ...A, to: LINE_B, issue: "x" });
      assert.equal(viaReport.status, 409);
      const session = await getReceptionistRuntime().store.getSessionByCallSid(`bl_${A.call_id}`);
      assert.equal(session?.slots.callerName, "Marie Tremblay", "the owner of the call is untouched");
    });

    it("does not serve a business whose line is routed but whose receptionist is disabled", async () => {
      process.env.RECEPTIONIST_CONFIG_JSON = JSON.stringify([{ ...CONFIGS[0], enabled: false }]);
      resetReceptionistRuntimeForTests();
      const res = await get({ to: LINE_A, call_id: A.call_id });
      assert.equal(res.status, 404);
      assert.equal((await json(res)).code, "no_receptionist");
    });
  });

  describe("config", () => {
    it("returns the pathway variables for the dialed business only", async () => {
      const res = await get({ to: LINE_A, call_id: A.call_id, from: A.from });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("cache-control"), "no-store");
      const { config } = (await json(res)) as { config: Json };
      assert.equal(config.business_name, "Nord Plomberie");
      assert.equal(config.normal_transfer_number, "+15145550111");
      assert.equal(config.backup_transfer_number, "+15145550333");
      assert.equal(config.emergency_transfer_number, "+15145550222");
      assert.equal(config.transfer_available, "true");
      assert.equal(config.emergency_transfer_available, "true");
      assert.equal(config.transfer_unavailable_reason, "");
      assert.equal(config.booking_enabled, "true");
      assert.equal(config.sms_text_enabled, "false", "no business text number is configured");
      assert.deepEqual(config.warnings, []);

      const other = (await json(await get({ to: LINE_B, call_id: "call-bland-b2" }))).config as Json;
      assert.equal(other.business_name, "Sud Toiture");
      assert.equal(other.normal_transfer_number, "");
      assert.equal(other.transfer_available, "false");
      assert.equal(other.transfer_unavailable_reason, "not_configured");
      assert.equal(other.booking_enabled, "false");
    });

    it("only ever contains strings and a warnings list, and no secrets or owner contacts", async () => {
      const text = await (await get({ to: LINE_A, call_id: A.call_id })).text();
      const { config } = JSON.parse(text) as { config: Json };
      for (const [key, value] of Object.entries(config)) {
        if (key === "warnings") assert.ok(Array.isArray(value));
        else assert.equal(typeof value, "string", key);
      }
      for (const secret of [TOOL, WEBHOOK, OPS]) assert.ok(!text.includes(secret));
      assert.doesNotMatch(text, /notifications|ringFirst|personalContacts/);
    });

    it("never offers a transfer into a line this system owns", async () => {
      const { config } = (await json(await get({ to: LINE_LOOP, call_id: "call-bland-l1" }))) as { config: Json };
      assert.equal(config.normal_transfer_number, "", "own Bland number");
      assert.equal(config.emergency_transfer_number, "", "another business's Bland number");
      assert.equal(config.transfer_available, "false");
      assert.deepEqual(config.warnings, ["transfer_normal_loops_to_own_line", "transfer_emergency_loops_to_own_line"]);
    });

    it("warns when the Bland SMS number is also a business's own number", async () => {
      process.env.BLAND_ROUTES_JSON = JSON.stringify([
        { toE164: LINE_A, configId: "rc_bland_a", smsE164: "+15145550001" },
      ]);
      resetBlandRoutesForTests();
      const { config } = (await json(await get({ to: LINE_A, call_id: A.call_id }))) as { config: Json };
      assert.deepEqual(config.warnings, ["bland_sms_number_conflict"]);
    });
  });

  describe("caller details, availability and booking", () => {
    it("saves confirmed details in canonical form and says what is still missing", async () => {
      const res = await post(details, {
        ...A,
        caller_name: "Marie Tremblay",
        use_caller_id: "true",
        street: "12 rue des Pins",
        city: "Laval",
        province: "Québec",
        postal_code: "h7n1a1",
      });
      assert.equal(res.status, 200);
      const { details: saved } = (await json(res)) as { details: Json };
      assert.equal(saved.status, "saved");
      assert.deepEqual(saved.missing, []);
      assert.equal((saved.confirmed as Json).serviceAddress, "12 rue des Pins, Laval, QC H7N 1A1");
      assert.equal((saved.confirmed as Json).callbackE164, "+15145559876", "the carrier's caller ID, not a model-chosen number");
    });

    it("does not save an incomplete address and names the missing part", async () => {
      const res = await post(details, { ...A, address: "12 rue des Pins, Laval" });
      const { details: saved } = (await json(res)) as { details: Json };
      assert.equal(saved.status, "rejected");
      assert.deepEqual((saved.address as Json).missing, ["province"]);
    });

    it("ignores a number that is not the caller's when use_caller_id is set", async () => {
      const res = await post(details, { ...A, from: "anonymous", use_caller_id: true });
      const { details: saved } = (await json(res)) as { details: Json };
      assert.deepEqual(saved.rejected, ["callbackE164"]);
    });

    it("books only with details the caller confirmed: nothing is taken from the booking request", async () => {
      const res = await post(book, {
        ...A,
        start_at: "2026-10-22T13:00:00Z",
        caller_name: "Mallory",
        serviceAddress: "somewhere",
      });
      assert.equal(res.status, 200);
      const { booking } = (await json(res)) as { booking: Json };
      assert.equal(booking.status, "missing_details");
      assert.deepEqual(booking.missing, ["name", "callback number", "service address"]);
    });

    it("never says a time is booked when phone booking is off for the business", async () => {
      const b = { to: LINE_B, call_id: "call-bland-b3", from: "+15145559876" };
      const avail = await json(await post(availability, b));
      assert.deepEqual(avail.availability, { ok: false, reason: "booking_disabled" });
      const booked = await json(await post(book, { ...b, start_at: "2026-10-22T13:00:00Z" }));
      assert.deepEqual(booked.booking, { status: "request", reason: "booking_disabled" });
    });

    it("offers no time for an appointment that is not the caller's", async () => {
      const res = await json(await post(availability, { ...A, appointment_id: "appt_not_mine", caller_name: "Marie" }));
      assert.deepEqual(res.availability, { ok: false, reason: "not_bookable" });
    });
  });

  describe("appointments and report", () => {
    it("finds, moves and cancels nothing when the owner has not enabled appointment management", async () => {
      const B = { to: LINE_B, call_id: "call-bland-b4", from: "+15145559876" };
      const find = await json(await post(appointments, { ...B, action: "find", caller_name: "Marie" }));
      assert.deepEqual(find.result, { status: "disabled" });
      const cancel = await json(
        await post(appointments, { ...B, action: "cancel", caller_name: "Marie", appointment_id: "appt_1" }),
      );
      assert.deepEqual(cancel.result, { status: "disabled" });
    });

    it("cancels or moves nothing that is not the caller's, even with a valid appointment id format", async () => {
      const cancel = await json(
        await post(appointments, { ...A, action: "cancel", caller_name: "Marie", appointment_id: "appt_not_mine" }),
      );
      assert.deepEqual(cancel.result, { status: "not_found" });
      const move = await json(
        await post(appointments, {
          ...A,
          action: "move",
          caller_name: "Marie",
          appointment_id: "appt_not_mine",
          start_at: "2026-10-22T13:00:00Z",
        }),
      );
      assert.deepEqual(move.result, { status: "not_found" });
    });

    it("promises no text from a business without a text number", async () => {
      const res = await json(await post(appointments, { ...A, action: "text", kind: "business_info" }));
      assert.deepEqual(res.result, { status: "unavailable" });
    });

    it("refuses to text from a number Bland also texts from", async () => {
      process.env.RECEPTIONIST_CONFIG_JSON = JSON.stringify([{ ...CONFIGS[0], smsFromE164: "+15145550199" }]);
      process.env.BLAND_ROUTES_JSON = JSON.stringify([
        { toE164: LINE_A, configId: "rc_bland_a", smsE164: "+15145550199" },
      ]);
      resetBlandRoutesForTests();
      resetReceptionistRuntimeForTests();
      const res = await json(await post(appointments, { ...A, action: "text", kind: "business_info" }));
      assert.deepEqual(res.result, { status: "unavailable" });
    });

    it("saves report notes on the call without finishing it", async () => {
      const res = await post(report, { ...A, intent: "service_request", issue: "Fuite sous l'évier", emergency: "true" });
      assert.equal(res.status, 200);
      const session = await getReceptionistRuntime().store.getSessionByCallSid(`bl_${A.call_id}`);
      assert.equal(session?.slots.issue, "Fuite sous l'évier");
      assert.equal(session?.finalizedAt, undefined);
    });
  });

  describe("post-call webhook", () => {
    const payload = (over: Json = {}) => ({
      call_id: "call-bland-w1",
      to: LINE_A,
      from: "+15145559876",
      inbound: true,
      transcripts: [
        { user: "assistant", text: "Bonjour, Nord Plomberie." },
        { user: "user", text: "J'ai une fuite d'eau." },
      ],
      call_length: 2,
      call_ended_by: "USER",
      ...over,
    });
    const signed = (body: unknown, secret = WEBHOOK) => {
      const raw = JSON.stringify(body);
      return post(webhook, null, { "x-webhook-signature": createHmac("sha256", secret).update(raw).digest("hex") }, raw);
    };

    it("rejects an unsigned or wrongly signed request, and fails closed without a secret", async () => {
      assert.equal((await post(webhook, payload(), {})).status, 401);
      assert.equal((await signed(payload(), "x".repeat(40))).status, 401);
      assert.equal(
        (await post(webhook, payload(), { authorization: `Bearer ${TOOL}` })).status,
        401,
        "the tool secret does not sign webhooks",
      );
      delete process.env.BLAND_WEBHOOK_SECRET;
      assert.equal((await signed(payload())).status, 503);
    });

    it("rejects a signed body that is not valid", async () => {
      const res = await signed(payload({ call_id: "bad id" }));
      assert.equal(res.status, 400);
      assert.deepEqual((await json(res)).fields, ["call_id"]);
    });

    it("acknowledges and ignores a call for a number that is not routed here", async () => {
      const res = await signed(payload({ to: "+14165550199" }));
      assert.equal(res.status, 200);
      assert.equal((await json(res)).ignored, "no_route");
      assert.equal(await getReceptionistRuntime().store.getSessionByCallSid("bl_call-bland-w1"), null);
    });

    it("ignores outbound calls: this integration answers inbound calls only", async () => {
      const res = await signed(payload({ inbound: false }));
      assert.equal((await json(res)).ignored, "not_inbound");
      assert.equal(await getReceptionistRuntime().store.getSessionByCallSid("bl_call-bland-w1"), null);
    });

    it("finalizes the call once, and a retry changes nothing", async () => {
      await post(report, { ...A, call_id: "call-bland-w1", issue: "Fuite d'eau", intent: "service_request" });
      const first = await signed(payload());
      assert.equal(first.status, 200);
      const done = await json(first);
      assert.equal(done.recorded, true);

      const store = getReceptionistRuntime().store;
      const session = await store.getSessionByCallSid("bl_call-bland-w1");
      assert.ok(session?.finalizedAt);
      assert.equal(session?.durationSeconds, 120);
      assert.equal(session?.turns.length, 2);
      const finalizedAt = session?.finalizedAt;

      const retry = await signed(payload({ call_length: 9 }));
      assert.equal(retry.status, 200);
      const again = await store.getSessionByCallSid("bl_call-bland-w1");
      assert.equal(again?.finalizedAt, finalizedAt);
      assert.equal(again?.durationSeconds, 120, "the retry did not rewrite the finished call");
    });

    it("will not attach a call that belongs to another business", async () => {
      await post(details, { ...A, call_id: "call-bland-w2", caller_name: "Marie Tremblay" });
      const res = await signed(payload({ call_id: "call-bland-w2", to: LINE_B }));
      assert.equal(res.status, 409);
    });
  });
});
