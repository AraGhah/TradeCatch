import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/twilio/sms/inbound/route";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { ensureMissedCallReady } from "../../src/product/missed-call/runtime";
import {
  createDryRunSmsPort,
  createTwilioSmsPort,
  SmsDeliveryError,
} from "../../src/product/missed-call/twilio";
import { getSaasStore } from "../../src/product/saas/runtime";
import { getSmsInbox } from "../../src/product/sms-receptionist/inbox-runtime";
import {
  hashBlandToken,
  isBlandOwnedSmsNumber,
  resetBlandLinesCacheForTests,
} from "../../src/product/receptionist/bland/lines";

const NOW = new Date("2026-10-28T15:00:00Z").getTime();
const CUSTOMER = "+15145551234";
const BLAND_SMS = "+14385557001";
const TWILIO_SMS = "+14385557002";
const saved = { ...process.env };

const linesJson = (smsNumber?: string) =>
  JSON.stringify([
    {
      number: "+15145550111",
      receptionistNumber: "+14385550100",
      tokenSha256: hashBlandToken("tcbl_x"),
      ...(smsNumber ? { smsNumber } : {}),
    },
  ]);

function webhook(to: string, sid: string) {
  return new NextRequest("http://localhost/api/twilio/sms/inbound", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      From: CUSTOMER,
      To: to,
      Body: "Hello, my drain is blocked",
      MessageSid: sid,
      NumMedia: "0",
    }).toString(),
  });
}

async function businessOn(smsNumber: string, id: string) {
  const client = demoClientAccount({ id, smsFromNumber: smsNumber, contractorDisplayName: "Nord" });
  const { store } = await ensureMissedCallReady();
  await store.saveClient(client);
  await getSaasStore().createOrganizationWithOwner({
    name: id,
    ownerEmail: `${id}@sms.test`,
    ownerName: "Owner",
    missedCallClientId: client.id,
    accountType: "production",
  });
  return client;
}

describe("Bland SMS never conflicts with the Twilio responder", () => {
  before(() => {
    for (const key of ["TWILIO_AUTH_TOKEN", "TWILIO_ACCOUNT_SID", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) {
      delete process.env[key];
    }
    process.env.RECEPTIONIST_LLM_PROVIDER = "none";
    process.env.LAUNCH_ENABLE_SMS_CHATBOT = "1";
    mock.timers.enable({ apis: ["Date"], now: NOW });
    mock.method(console, "info", () => {});
    mock.method(console, "warn", () => {});
  });
  after(() => {
    mock.restoreAll();
    mock.timers.reset();
    process.env = { ...saved };
    resetBlandLinesCacheForTests();
  });
  beforeEach(() => {
    process.env.BLAND_LINES_JSON = linesJson(BLAND_SMS);
    resetBlandLinesCacheForTests();
  });
  afterEach(() => {
    delete process.env.BLAND_LINES_JSON;
    resetBlandLinesCacheForTests();
  });

  it("recognises numbers whose texts Bland answers", () => {
    assert.equal(isBlandOwnedSmsNumber(BLAND_SMS), true);
    assert.equal(isBlandOwnedSmsNumber("438-555-7001"), true);
    assert.equal(isBlandOwnedSmsNumber(TWILIO_SMS), false);
    assert.equal(isBlandOwnedSmsNumber(undefined), false);
  });

  it("inbound: a text to a Bland-owned number gets no TradeCatch reply and is not stored", async () => {
    // Even when a tenant record also lists that number as its sending number.
    await businessOn(BLAND_SMS, "client_bland_sms");
    const enqueue = mock.method(getSmsInbox(), "enqueue", async () => {
      throw new Error("must not be stored");
    });
    try {
      const res = await POST(webhook(BLAND_SMS, "SMbland1"));
      assert.equal(res.status, 200);
      assert.match(await res.text(), /<Response\s*\/>|<Response><\/Response>/);
      assert.equal(enqueue.mock.callCount(), 0);
    } finally {
      enqueue.mock.restore();
    }
  });

  it("inbound: the same text to a Twilio-owned number is handled as before", async () => {
    await businessOn(TWILIO_SMS, "client_twilio_sms");
    const enqueue = mock.method(getSmsInbox(), "enqueue", async () => ({ id: "x" }) as never);
    try {
      const res = await POST(webhook(TWILIO_SMS, "SMtwilio1"));
      assert.equal(res.status, 200);
      assert.equal(enqueue.mock.callCount(), 1);
    } finally {
      enqueue.mock.restore();
    }
  });

  for (const [name, port] of [
    ["dry-run", () => createDryRunSmsPort()],
    ["live", () => createTwilioSmsPort({ TWILIO_ACCOUNT_SID: "ACtest", TWILIO_AUTH_TOKEN: "x", NODE_ENV: "test", MISSED_CALL_SMS_MODE: "live", BLAND_LINES_JSON: process.env.BLAND_LINES_JSON } as never)],
  ] as const) {
    it(`outbound (${name}): TradeCatch refuses to send from a Bland-owned number`, async () => {
      const calls: unknown[] = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async (...args: unknown[]) => {
        calls.push(args);
        return new Response("{}", { status: 201 });
      }) as typeof fetch;
      try {
        await assert.rejects(
          port().send({ toE164: CUSTOMER, fromE164: BLAND_SMS, body: "Hi", internal: true } as never),
          (error: unknown) =>
            error instanceof SmsDeliveryError && error.disposition === "dead",
        );
        assert.equal(calls.length, 0, "nothing reached Twilio");
      } finally {
        globalThis.fetch = realFetch;
      }
    });
  }

  it("outbound: other numbers are unaffected", async () => {
    await assert.doesNotReject(
      createDryRunSmsPort().send({ toE164: CUSTOMER, fromE164: TWILIO_SMS, body: "Hi" } as never),
    );
  });
});
