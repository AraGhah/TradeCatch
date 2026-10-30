import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/twilio/sms/inbound/route";
import { getCrmService } from "../../src/product/crm/runtime";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { ensureMissedCallReady } from "../../src/product/missed-call/runtime";
import { getSaasStore } from "../../src/product/saas/runtime";

// Wednesday 11:00 in Toronto: inside the default 08:00–20:00 sending window.
const NOW = new Date("2026-10-28T15:00:00Z").getTime();
const CUSTOMER = "+15145551234";

const ENV_KEYS = [
  "TWILIO_AUTH_TOKEN",
  "TWILIO_ACCOUNT_SID",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "RECEPTIONIST_LLM_PROVIDER",
  "MISSED_CALL_SKIP_TWILIO_VALIDATE",
] as const;
const savedEnv: Record<string, string | undefined> = {};

let seq = 0;

async function business(
  overrides: Parameters<typeof demoClientAccount>[0] = {},
) {
  seq += 1;
  const client = demoClientAccount({
    id: `client_route_${seq}`,
    smsFromNumber: `+1438555${String(1000 + seq)}`,
    contractorDisplayName: "Nord Plomberie",
    ...overrides,
  });
  const { store } = await ensureMissedCallReady();
  await store.saveClient(client);
  const { organization } = await getSaasStore().createOrganizationWithOwner({
    name: `Nord ${seq}`,
    ownerEmail: `owner${seq}@route.test`,
    ownerName: "Owner",
    missedCallClientId: client.id,
    accountType: "production",
  });
  return { client, organization, store };
}

function webhook(
  to: string,
  body: string,
  extra: { from?: string; sid?: string; headers?: Record<string, string> } = {},
) {
  seq += 1;
  const form = new URLSearchParams({
    From: extra.from ?? CUSTOMER,
    To: to,
    Body: body,
    MessageSid: extra.sid ?? `SMroute${seq}`,
    NumMedia: "0",
  });
  return new NextRequest("http://localhost/api/twilio/sms/inbound", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...extra.headers,
    },
    body: form.toString(),
  });
}

async function automatedReplies(orgId: string, phone = CUSTOMER) {
  const messages = await getCrmService().recentMessagesByPhone(
    orgId,
    phone,
    50,
  );
  return messages.filter((m) => m.direction === "outbound" && m.automated);
}

describe("POST /api/twilio/sms/inbound — SMS receptionist", () => {
  before(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
    // No model configured: the deterministic acknowledgement path.
    process.env.RECEPTIONIST_LLM_PROVIDER = "none";
    mock.timers.enable({ apis: ["Date"], now: NOW });
    mock.method(console, "info", () => {});
    mock.method(console, "warn", () => {});
  });

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.RECEPTIONIST_LLM_PROVIDER = "none";
  });

  after(() => {
    mock.restoreAll();
    mock.timers.reset();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("answers 'Salut, j'ai un problème' once, records the conversation, and answers with empty TwiML", async () => {
    const { client, organization } = await business();
    const res = await POST(
      webhook(client.smsFromNumber, "Salut, j'ai un problème"),
    );
    assert.equal(res.status, 200);
    assert.equal(
      await res.text(),
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    );

    const messages = await getCrmService().recentMessagesByPhone(
      organization.id,
      CUSTOMER,
      50,
    );
    assert.equal(messages.filter((m) => m.direction === "inbound").length, 1);
    const replies = await automatedReplies(organization.id);
    assert.equal(replies.length, 1);
    assert.match(replies[0]!.body, /assistant virtuel de Nord Plomberie/);
  });

  it("continues the same conversation on later messages without duplicating the first reply", async () => {
    const { client, organization } = await business();
    await POST(webhook(client.smsFromNumber, "Bonjour, j'ai un problème"));
    await POST(webhook(client.smsFromNumber, "Mon évier est bouché"));
    const messages = await getCrmService().recentMessagesByPhone(
      organization.id,
      CUSTOMER,
      50,
    );
    assert.equal(messages.filter((m) => m.direction === "inbound").length, 2);
    // The acknowledgement is not repeated to someone who already received it.
    assert.equal((await automatedReplies(organization.id)).length, 1);
  });

  it("sends one reply when Twilio redelivers the same MessageSid", async () => {
    const { client, organization } = await business();
    await POST(
      webhook(client.smsFromNumber, "Hello, I have a problem", {
        sid: "SMdup_1",
      }),
    );
    await POST(
      webhook(client.smsFromNumber, "Hello, I have a problem", {
        sid: "SMdup_1",
      }),
    );
    assert.equal((await automatedReplies(organization.id)).length, 1);
  });

  it("does not reply when the owner turned AI replies off", async () => {
    const { client, organization } = await business({ aiSmsReplies: false });
    const res = await POST(webhook(client.smsFromNumber, "Bonjour"));
    assert.equal(res.status, 200);
    assert.equal((await automatedReplies(organization.id)).length, 0);
  });

  it("does not reply to a customer who sent STOP, now or afterwards", async () => {
    const { client, organization, store } = await business();
    const stop = await POST(webhook(client.smsFromNumber, "STOP"));
    assert.equal(stop.status, 200);
    assert.equal(
      await store.isSmsSuppressed(client.id, CUSTOMER, { asCustomer: true }),
      true,
    );

    await POST(webhook(client.smsFromNumber, "Finalement j'ai un problème"));
    assert.equal((await automatedReplies(organization.id)).length, 0);
  });

  it("does not auto-reply while a human has taken over the conversation", async () => {
    const { client, organization } = await business();
    const crm = getCrmService();
    await crm.capture({
      organizationId: organization.id,
      source: "sms",
      phoneE164: CUSTOMER,
      message: {
        direction: "inbound",
        body: "Bonjour",
        fromE164: CUSTOMER,
        toE164: client.smsFromNumber,
      },
    });
    const conversationId = await crm.latestConversationIdByPhone(
      organization.id,
      CUSTOMER,
    );
    assert.ok(conversationId);
    await crm.setControl(
      organization.id,
      conversationId,
      "human_managed",
      "test",
    );

    await POST(webhook(client.smsFromNumber, "Quelqu'un peut m'aider?"));
    assert.equal((await automatedReplies(organization.id)).length, 0);
  });

  it("leaves technician SMS to the technician flow", async () => {
    const { client, organization } = await business();
    const technician = client.technicianRoster[0]!.phone;
    const res = await POST(
      webhook(client.smsFromNumber, "Accepter", { from: technician }),
    );
    assert.equal(res.status, 200);
    assert.equal(
      (await automatedReplies(organization.id, technician)).length,
      0,
    );
  });

  it("stays silent for a number no business owns", async () => {
    const res = await POST(webhook("+14385550000", "Salut, j'ai un problème"));
    assert.equal(res.status, 200);
    assert.equal(
      await res.text(),
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    );
  });

  it("rejects an unsigned webhook when Twilio validation is on, and sends nothing", async () => {
    process.env.TWILIO_AUTH_TOKEN = "test-token";
    const { client, organization } = await business();
    const res = await POST(webhook(client.smsFromNumber, "Bonjour"));
    assert.equal(res.status, 403);
    assert.equal((await automatedReplies(organization.id)).length, 0);
  });

  it("rejects a webhook with a wrong signature", async () => {
    process.env.TWILIO_AUTH_TOKEN = "test-token";
    const { client, organization } = await business();
    const res = await POST(
      webhook(client.smsFromNumber, "Bonjour", {
        headers: { "x-twilio-signature": "AAAA" },
      }),
    );
    assert.equal(res.status, 403);
    assert.equal((await automatedReplies(organization.id)).length, 0);
  });
});
