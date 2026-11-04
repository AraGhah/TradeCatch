import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/twilio/sms/inbound/route";
import { getCrmService } from "../../src/product/crm/runtime";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { ensureMissedCallReady } from "../../src/product/missed-call/runtime";
import { getSaasStore } from "../../src/product/saas/runtime";
import type { MissedCallWorkflow } from "../../src/product/missed-call/types";
import {
  getSmsInbox,
  processSmsInbox,
} from "../../src/product/sms-receptionist/inbox-runtime";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

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
  it("acknowledges persisted receipt before processing, then completes from background work", async () => {
    const { client, organization } = await business();
    const pending: (() => Promise<void>)[] = [];
    const work = mock.method(
      workAsyncStorage,
      "getStore",
      () =>
        ({
          afterContext: {
            after: (task: () => Promise<void>) => pending.push(task),
          },
        }) as unknown as NonNullable<
          ReturnType<typeof workAsyncStorage.getStore>
        >,
    );
    const unit = mock.method(
      workUnitAsyncStorage,
      "getStore",
      () =>
        ({ type: "request" }) as NonNullable<
          ReturnType<typeof workUnitAsyncStorage.getStore>
        >,
    );
    try {
      const response = await POST(
        webhook(client.smsFromNumber, "Hello, my drain is blocked"),
      );
      assert.equal(response.status, 200);
      assert.equal(pending.length, 1);
      assert.equal((await automatedReplies(organization.id)).length, 0);
      await pending[0]!();
      assert.equal((await automatedReplies(organization.id)).length, 1);
    } finally {
      work.mock.restore();
      unit.mock.restore();
    }
  });

  it("returns retryable 503 when receipt storage fails", async () => {
    const { client } = await business();
    const enqueue = mock.method(getSmsInbox(), "enqueue", async () => {
      throw new Error("DB unavailable");
    });
    try {
      assert.equal(
        (await POST(webhook(client.smsFromNumber, "Hello"))).status,
        503,
      );
    } finally {
      enqueue.mock.restore();
    }
  });

  it("retries a failed history write from the inbox without requiring Twilio redelivery", async () => {
    const { client, organization } = await business();
    const capture = mock.method(getCrmService(), "capture", async () => {
      throw new Error("DB unavailable");
    });
    try {
      assert.equal(
        (await POST(webhook(client.smsFromNumber, "Hello, blocked drain")))
          .status,
        200,
      );
    } finally {
      capture.mock.restore();
    }
    mock.timers.tick(61_000);
    await processSmsInbox();
    assert.equal((await automatedReplies(organization.id)).length, 1);
  });
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

  it("continues the same conversation on later messages with a follow-up reply", async () => {
    const { client, organization } = await business();
    await POST(webhook(client.smsFromNumber, "Bonjour, j'ai un problème"));
    await POST(webhook(client.smsFromNumber, "Mon évier est bouché"));
    const messages = await getCrmService().recentMessagesByPhone(
      organization.id,
      CUSTOMER,
      50,
    );
    assert.equal(messages.filter((m) => m.direction === "inbound").length, 2);
    const replies = await automatedReplies(organization.id);
    assert.equal(replies.length, 2);
    assert.match(replies[0]!.body, /assistant virtuel de Nord Plomberie/);
    assert.match(replies[1]!.body, /adresse/i);
  });

  it("never leaves a customer's short follow-ups unanswered (no model configured)", async () => {
    const { client, organization } = await business();
    for (const body of ["Hi", "ok", "hello?"]) {
      assert.equal(
        (await POST(webhook(client.smsFromNumber, body))).status,
        200,
      );
    }
    const replies = await automatedReplies(organization.id);
    assert.equal(replies.length, 3, "one reply per text");
    assert.match(replies[0]!.body, /virtual assistant for Nord Plomberie/);
    assert.match(replies[1]!.body, /Got it, thanks/);
    assert.match(replies[2]!.body, /Got it, thanks/);
  });

  for (const status of ["awaiting_technician", "awaiting_human"] as const) {
    it(`answers a customer whose missed-call job is ${status}`, async () => {
      const { client, organization, store } = await business();
      const at = new Date(NOW - 10 * 60_000).toISOString();
      await store.saveWorkflow({
        id: `wf_open_${status}`,
        clientAccountId: client.id,
        callId: `call_open_${status}`,
        callerE164: CUSTOMER,
        status,
        currentStep: "done",
        collected: {
          language: "fr",
          photoUrls: [],
          customerName: "Marie",
          serviceAddress: "12 rue Main",
          issueDescription: "évier bouché",
        },
        escalationIndex: 0,
        escalationStage: "primary",
        technicianAlerts: [],
        outcome: "open",
        events: [],
        createdAt: at,
        updatedAt: at,
        dedupeKey: `dedupe_open_${status}`,
      } as MissedCallWorkflow);
      const res = await POST(
        webhook(
          client.smsFromNumber,
          "Bonjour, est-ce que quelqu'un s'en vient?",
        ),
      );
      assert.equal(res.status, 200);
      const replies = await automatedReplies(organization.id);
      assert.equal(replies.length, 1, "the customer is answered");
      assert.match(replies[0]!.body, /a déjà votre demande/);
      assert.doesNotMatch(replies[0]!.body, /adresse/);
    });
  }

  it("still answers when Twilio redelivers a cold SMS MessageSid after Module A released it", async () => {
    const { client, organization, store } = await business();
    const sid = "SMredeliver_cold_1";
    // Simulate a prior Module A cold-path attempt that claimed then released.
    assert.equal(await store.claimInboundMessageSid(sid), true);
    await store.releaseInboundMessageSid(sid);
    const res = await POST(
      webhook(client.smsFromNumber, "Salut, besoin d'aide", { sid }),
    );
    assert.equal(res.status, 200);
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

  it("still honors STOP for a business whose organization is suspended, with no AI reply or CRM record", async () => {
    const { client, organization, store } = await business();
    await getSaasStore().updateOrganization(organization.id, {
      status: "suspended",
    });
    const res = await POST(webhook(client.smsFromNumber, "STOP"));
    assert.equal(res.status, 200);
    assert.equal(
      await store.isSmsSuppressed(client.id, CUSTOMER, { asCustomer: true }),
      true,
      "the opt-out is recorded even though the business is suspended",
    );
    const later = await POST(
      webhook(client.smsFromNumber, "Finalement j'ai un problème"),
    );
    assert.equal(later.status, 200);
    assert.equal((await automatedReplies(organization.id)).length, 0);
    assert.equal(
      (
        await getCrmService().recentMessagesByPhone(
          organization.id,
          CUSTOMER,
          50,
        )
      ).length,
      0,
      "a suspended business gets no new CRM history",
    );
  });

  it("flushes technician guidance right away instead of waiting for the next tick", async () => {
    const { client, store } = await business();
    const technician = client.technicianRoster[0]!.phone;
    const { engine } = await ensureMissedCallReady();
    const handle = mock.method(engine, "handleInboundSms", async () => ({
      handled: true,
      replies: ["Accepté. Voici les détails du client."],
    }));
    const flush = mock.method(engine, "flushOutbound");
    try {
      const res = await POST(
        webhook(client.smsFromNumber, "Accepter", { from: technician }),
      );
      assert.equal(res.status, 200);
      assert.equal(handle.mock.callCount(), 1);
      assert.equal(flush.mock.callCount(), 1, "sent immediately");
      assert.equal(
        (await store.getOutboundQueueStats()).queued,
        0,
        "nothing left waiting for the cron",
      );
    } finally {
      handle.mock.restore();
      flush.mock.restore();
    }
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
