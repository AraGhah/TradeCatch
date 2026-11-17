import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/twilio/sms/inbound/route";
import { getCrmService } from "../../src/product/crm/runtime";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { ensureMissedCallReady } from "../../src/product/missed-call/runtime";
import { getSaasStore } from "../../src/product/saas/runtime";
import { getSmsInbox } from "../../src/product/sms-receptionist/inbox-runtime";
import {
  parseBlandRoutes,
  resetBlandRoutesForTests,
} from "../../src/product/bland/routes";
import {
  findSmsConflicts,
  isBlandSmsNumber,
  smsTextingAllowed,
} from "../../src/product/bland/sms-guard";
import { parseReceptionistConfig } from "../../src/product/receptionist/config";

// Wednesday 11:00 in Toronto: inside the default sending window.
const NOW = new Date("2026-10-28T15:00:00Z").getTime();
const CUSTOMER = "+15145551234";

process.env.LAUNCH_ENABLE_SMS_CHATBOT = "1";

const ENV_KEYS = [
  "TWILIO_AUTH_TOKEN",
  "TWILIO_ACCOUNT_SID",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "RECEPTIONIST_LLM_PROVIDER",
  "MISSED_CALL_SKIP_TWILIO_VALIDATE",
  "BLAND_ROUTES_JSON",
] as const;
const savedEnv: Record<string, string | undefined> = {};

let seq = 0;

async function business() {
  seq += 1;
  const client = demoClientAccount({
    id: `client_bland_sms_${seq}`,
    smsFromNumber: `+1438556${String(1000 + seq)}`,
    contractorDisplayName: "Nord Plomberie",
  });
  const { store } = await ensureMissedCallReady();
  await store.saveClient(client);
  const { organization } = await getSaasStore().createOrganizationWithOwner({
    name: `Bland SMS ${seq}`,
    ownerEmail: `owner${seq}@bland-sms.test`,
    ownerName: "Owner",
    missedCallClientId: client.id,
    accountType: "production",
  });
  return { client, organization, store };
}

function webhook(to: string, body: string) {
  seq += 1;
  const form = new URLSearchParams({
    From: CUSTOMER,
    To: to,
    Body: body,
    MessageSid: `SMbland${seq}`,
    NumMedia: "0",
  });
  return new NextRequest("http://localhost/api/twilio/sms/inbound", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

/** Declare `number` as a number Bland texts from. */
function blandOwns(number: string) {
  process.env.BLAND_ROUTES_JSON = JSON.stringify([
    { toE164: "+14385550100", configId: "rc_any", smsE164: number },
  ]);
  resetBlandRoutesForTests();
}

describe("Twilio SMS responder vs a number Bland also texts from", () => {
  before(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.RECEPTIONIST_LLM_PROVIDER = "none";
    mock.timers.enable({ apis: ["Date"], now: NOW });
    mock.method(console, "info", () => {});
    mock.method(console, "warn", () => {});
  });

  afterEach(() => {
    delete process.env.BLAND_ROUTES_JSON;
    resetBlandRoutesForTests();
  });

  after(() => {
    mock.restoreAll();
    mock.timers.reset();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    resetBlandRoutesForTests();
  });

  it("control: without Bland on the number, the responder takes the text as usual", async () => {
    const { client } = await business();
    const enqueue = mock.method(getSmsInbox(), "enqueue");
    try {
      assert.equal((await POST(webhook(client.smsFromNumber, "Hello"))).status, 200);
      assert.equal(enqueue.mock.callCount(), 1);
    } finally {
      enqueue.mock.restore();
    }
  });

  it("never creates an AI reply or a CRM record on a number Bland texts from", async () => {
    const { client, organization } = await business();
    blandOwns(client.smsFromNumber);
    const enqueue = mock.method(getSmsInbox(), "enqueue");
    try {
      const res = await POST(webhook(client.smsFromNumber, "Hello, my drain is blocked"));
      assert.equal(res.status, 200);
      assert.equal(enqueue.mock.callCount(), 0, "nothing entered the SMS inbox");
    } finally {
      enqueue.mock.restore();
    }
    const messages = await getCrmService().recentMessagesByPhone(organization.id, CUSTOMER, 50);
    assert.equal(messages.length, 0, "no CRM history from this number");
  });

  it("still honors STOP on that number, so an opt-out is never lost", async () => {
    const { client, store } = await business();
    blandOwns(client.smsFromNumber);
    const res = await POST(webhook(client.smsFromNumber, "STOP"));
    assert.equal(res.status, 200);
    assert.equal(
      await store.isSmsSuppressed(client.id, CUSTOMER, { asCustomer: true }),
      true,
    );
  });

  it("another business's number is unaffected by Bland's number", async () => {
    const bland = await business();
    const other = await business();
    blandOwns(bland.client.smsFromNumber);
    const enqueue = mock.method(getSmsInbox(), "enqueue");
    try {
      await POST(webhook(other.client.smsFromNumber, "Hello"));
      assert.equal(enqueue.mock.callCount(), 1);
    } finally {
      enqueue.mock.restore();
    }
  });
});

describe("Bland SMS number rules", () => {
  const config = (over: Record<string, unknown> = {}) =>
    parseReceptionistConfig({
      id: "rc_sms",
      clientAccountId: "client_sms",
      phoneNumberE164: "+15145550000",
      businessName: "Nord Plomberie",
      notifications: [],
      ...over,
    });

  it("recognises a Bland SMS number however it is formatted", () => {
    const env = {
      BLAND_ROUTES_JSON: JSON.stringify([
        { toE164: "+14385550100", configId: "a", smsE164: "+14385550199" },
      ]),
    };
    assert.equal(isBlandSmsNumber("+14385550199", env), true);
    assert.equal(isBlandSmsNumber("4385550199", env), true);
    assert.equal(isBlandSmsNumber("+14385550100", env), false, "the voice line is not an SMS number");
    assert.equal(isBlandSmsNumber(undefined, env), false);
    resetBlandRoutesForTests();
  });

  it("a Bland route cannot text from its own voice number or from another route's", () => {
    const parsed = parseBlandRoutes(
      JSON.stringify([
        { toE164: "+14385550100", configId: "a", smsE164: "+14385550100" },
        { toE164: "+14385550101", configId: "b", smsE164: "+14385550177" },
        { toE164: "+14385550102", configId: "c", smsE164: "+14385550177" },
        { toE164: "+14385550103", configId: "d", smsE164: "+14385550101" },
      ]),
    );
    assert.equal(parsed.routes.length, 4, "the voice lines still work");
    for (const route of parsed.routes) {
      assert.equal(route.smsE164, undefined, `route ${route.configId} claims no SMS number`);
    }
    assert.deepEqual(
      parsed.problems.map((p) => p.reason).sort(),
      [
        "sms_equals_voice_number",
        "sms_number_not_unique",
        "sms_number_not_unique",
        "sms_number_not_unique",
      ],
    );
  });

  it("finds a receptionist that already uses the number Bland would text from", () => {
    const route = { toE164: "+14385550100", configId: "rc_a", smsE164: "+15145550199" };
    const sameSms = config({ id: "rc_b", smsFromE164: "+15145550199" });
    const sameVoice = config({ id: "rc_c", phoneNumberE164: "+15145550199" });
    const unrelated = config({ id: "rc_d", smsFromE164: "+15145550888" });
    assert.deepEqual(findSmsConflicts(route, [sameSms, sameVoice, unrelated]), [
      { configId: "rc_b", reason: "is_receptionist_sms_number" },
      { configId: "rc_c", reason: "is_voice_line" },
    ]);
    assert.deepEqual(findSmsConflicts({ ...route, smsE164: undefined }, [sameSms]), []);
  });

  it("the agent only offers a text from the business's own number, never Bland's", () => {
    const env = {
      BLAND_ROUTES_JSON: JSON.stringify([
        { toE164: "+14385550100", configId: "a", smsE164: "+14385550199" },
      ]),
    };
    assert.equal(smsTextingAllowed(config({ smsFromE164: "+15145550888" }), env), true);
    assert.equal(smsTextingAllowed(config(), env), false, "no business text number");
    assert.equal(smsTextingAllowed(config({ smsFromE164: "+14385550199" }), env), false);
    resetBlandRoutesForTests();
  });
});
