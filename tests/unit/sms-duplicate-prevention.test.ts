/**
 * One inbound text, at most one automated reply.
 *
 * Root cause covered here: the missed-call conversation engine sent each prompt
 * through the outbox (REST) AND returned the same text in `replies`, which the
 * inbound processor then queued and sent a second time. Retries of the same
 * MessageSid, concurrent deliveries, identical-looking texts from the customer
 * (distinct MessageSids) and failed sends are covered too.
 *
 * Route-level tests drive the real webhook -> inbox -> engine -> outbox path and
 * count the texts that actually reach the SMS port (the dry-run port logs each
 * one).
 */
import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/twilio/sms/inbound/route";
import { getCrmService } from "../../src/product/crm/runtime";
import { createMissedCallEngine } from "../../src/product/missed-call/engine";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { ensureMissedCallReady } from "../../src/product/missed-call/runtime";
import { createMemoryStore } from "../../src/product/missed-call/store";
import type { SmsPort } from "../../src/product/missed-call/types";
import { getSaasStore } from "../../src/product/saas/runtime";

// Wednesday 11:00 in Toronto: inside business hours and the sending window.
const NOW = new Date("2026-10-28T15:00:00Z");
const CUSTOMER = "+15145551234";

const ENV_KEYS = [
  "TWILIO_AUTH_TOKEN",
  "TWILIO_ACCOUNT_SID",
  "MISSED_CALL_SKIP_TWILIO_VALIDATE",
] as const;
const savedEnv: Record<string, string | undefined> = {};

type DryRunSend = { to: string; body: string };
const sends: DryRunSend[] = [];
let seq = 0;

async function business() {
  seq += 1;
  const client = demoClientAccount({
    id: `client_dup_${seq}`,
    smsFromNumber: `+1438555${String(2000 + seq)}`,
    contractorDisplayName: "Nord Plomberie",
  });
  const { store, engine } = await ensureMissedCallReady();
  await store.saveClient(client);
  const { organization } = await getSaasStore().createOrganizationWithOwner({
    name: `Dup ${seq}`,
    ownerEmail: `owner${seq}@dup.test`,
    ownerName: "Owner",
    missedCallClientId: client.id,
    accountType: "production",
  });
  const start = await engine.handleCallEvent({
    clientAccountId: client.id,
    callerE164: CUSTOMER,
    answered: false,
    abandoned: false,
    calledAt: NOW,
  });
  assert.ok(start.workflow, "a missed call starts the SMS conversation");
  sends.length = 0; // only count what the customer's replies cause
  return { client, organization, store, workflowId: start.workflow!.id };
}

function webhook(
  to: string,
  body: string,
  extra: { sid?: string; media?: string[] } = {},
) {
  seq += 1;
  const form = new URLSearchParams({
    From: CUSTOMER,
    To: to,
    Body: body,
    MessageSid: extra.sid ?? `SMdup${seq}`,
    NumMedia: String(extra.media?.length ?? 0),
  });
  (extra.media ?? []).forEach((url, i) => {
    form.set(`MediaUrl${i}`, url);
    form.set(`MediaContentType${i}`, "image/jpeg");
  });
  return new NextRequest("http://localhost/api/twilio/sms/inbound", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

const toCustomer = () => sends.filter((s) => s.to === CUSTOMER);

describe("one inbound text, at most one automated reply", () => {
  before(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
    mock.timers.enable({ apis: ["Date"], now: NOW.getTime() });
    mock.method(console, "warn", () => {});
    const info = console.info;
    mock.method(console, "info", (...args: unknown[]) => {
      if (args[0] === "[missed-call] SMS dry-run") {
        sends.push(args[1] as DryRunSend);
        return;
      }
      if (typeof args[0] === "string" && args[0].startsWith("{")) return;
      void info;
    });
  });

  after(() => {
    mock.restoreAll();
    mock.timers.reset();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("a customer's text during the missed-call conversation gets exactly one reply", async () => {
    const { client } = await business();
    const res = await POST(webhook(client.smsFromNumber, "EN"));
    assert.equal(res.status, 200);
    assert.equal(
      await res.text(),
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      "the webhook never answers with TwiML on top of the REST send",
    );
    const replies = toCustomer();
    assert.equal(replies.length, 1, JSON.stringify(replies));
    assert.match(replies[0]!.body, /full name/i);
  });

  it("every step of the conversation is sent once, in order", async () => {
    const { client } = await business();
    for (const text of ["EN", "Marie Tremblay", "12 Main St, Laval"]) {
      await POST(webhook(client.smsFromNumber, text));
    }
    const bodies = toCustomer().map((s) => s.body);
    assert.equal(bodies.length, 3, JSON.stringify(bodies));
    assert.equal(new Set(bodies).size, 3, "no prompt is repeated");
    assert.match(bodies[0]!, /full name/i);
    assert.match(bodies[1]!, /service address/i);
    assert.match(bodies[2]!, /describe/i);
  });

  it("a Twilio redelivery of the same MessageSid sends nothing more", async () => {
    const { client } = await business();
    const sid = "SMredelivered_1";
    await POST(webhook(client.smsFromNumber, "EN", { sid }));
    await POST(webhook(client.smsFromNumber, "EN", { sid }));
    await POST(webhook(client.smsFromNumber, "EN", { sid }));
    assert.equal(toCustomer().length, 1);
  });

  it("concurrent deliveries of the same MessageSid send one reply", async () => {
    const { client } = await business();
    const sid = "SMconcurrent_1";
    const responses = await Promise.all(
      [1, 2, 3].map(() => POST(webhook(client.smsFromNumber, "EN", { sid }))),
    );
    assert.ok(responses.every((r) => r.status === 200));
    assert.equal(toCustomer().length, 1);
  });

  it("separate messages with identical text are each processed and answered once", async () => {
    const { client, organization } = await business();
    await POST(webhook(client.smsFromNumber, "EN"));
    sends.length = 0;
    // One character is too short for a name: each text earns its own correction.
    await POST(webhook(client.smsFromNumber, "x"));
    await POST(webhook(client.smsFromNumber, "x"));
    const corrections = toCustomer();
    assert.equal(corrections.length, 2, JSON.stringify(corrections));
    // History keeps both inbound texts.
    const inbound = (
      await getCrmService().recentMessagesByPhone(organization.id, CUSTOMER, 50)
    ).filter((m) => m.direction === "inbound");
    assert.deepEqual(
      inbound.map((m) => m.body),
      ["EN", "x", "x"],
    );
  });

  it("a customer who sends the same answer twice moves on only once", async () => {
    const { client, workflowId, store } = await business();
    await POST(webhook(client.smsFromNumber, "EN"));
    await POST(webhook(client.smsFromNumber, "Marie Tremblay"));
    const wf = await store.getWorkflow(workflowId);
    assert.equal(wf?.collected.customerName, "Marie Tremblay");
    assert.equal(wf?.currentStep, "address");
  });
});

describe("a failed delivery is retried once from the outbox and never replays the customer's answer", () => {
  const NOW_ENGINE = new Date("2026-07-22T18:00:00.000Z");

  it("keeps the conversation where the customer left it", async () => {
    const store = createMemoryStore();
    const client = demoClientAccount();
    await store.saveClient(client);
    let calls = 0;
    const delivered: string[] = [];
    const sms: SmsPort = {
      async send(message) {
        calls += 1;
        // 1 = opening text; 2 = the first prompt (fails once); the rest succeed.
        if (calls === 2) throw new Error("Twilio SMS failed: 500 boom");
        delivered.push(message.body);
        return { sid: `SM_${calls}` };
      },
    };
    const engine = createMissedCallEngine({
      store,
      sms,
      clock: { now: () => NOW_ENGINE },
    });
    const start = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145551111",
      answered: false,
      abandoned: false,
      calledAt: NOW_ENGINE,
    });

    const first = await engine.handleInboundSms({
      fromE164: "+15145551111",
      toE164: client.smsFromNumber,
      body: "FR",
      messageSid: "SM_fail_once",
    });
    assert.equal(first.handled, true, "the answer is recorded, not rejected");

    // The same MessageSid arriving again (Twilio retry, inbox retry) is a no-op.
    const again = await engine.handleInboundSms({
      fromE164: "+15145551111",
      toE164: client.smsFromNumber,
      body: "FR",
      messageSid: "SM_fail_once",
    });
    assert.deepEqual(again, { handled: true, replies: [] });

    // The language answer was applied once: the name step is next, "FR" is not
    // taken as the customer's name.
    const wf = await store.getWorkflow(start.workflow!.id);
    assert.equal(wf?.currentStep, "name");
    assert.equal(wf?.collected.customerName, undefined);

    // The undelivered prompt is delivered by the outbox flush, once.
    const flushed = await engine.processEscalations();
    assert.equal(flushed.outboxSent, 1);
    const prompts = delivered.filter((b) => /nom complet/i.test(b));
    assert.equal(prompts.length, 1, JSON.stringify(delivered));
    assert.equal((await engine.processEscalations()).outboxSent, 0);
  });
});
