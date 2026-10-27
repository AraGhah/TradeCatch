/**
 * Edge-case coverage for the SMS lead qualifier conversation (Module A /
 * missed-call engine), filling the gaps the build plan calls out: angry
 * customer, French speaker, spam/off-topic input, price requests. Drives
 * the real engine end-to-end — not a mock — the same way
 * missed-call-recovery.test.ts does.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMissedCallEngine } from "../../src/product/missed-call/engine";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { createMemoryStore } from "../../src/product/missed-call/store";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";

function wednesdayBusinessHours(): Date {
  return new Date("2026-07-22T18:00:00.000Z");
}

async function startWorkflow() {
  const store = createMemoryStore();
  const sms = createMemorySmsPort();
  const client = demoClientAccount();
  await store.saveClient(client);
  const fixed = wednesdayBusinessHours();
  const engine = createMissedCallEngine({
    store,
    sms,
    clock: { now: () => fixed },
  });
  const callerE164 = "+15145551234";
  const start = await engine.handleCallEvent({
    clientAccountId: client.id,
    callerE164,
    answered: false,
    abandoned: false,
    calledAt: fixed,
  });
  return {
    store,
    sms,
    client,
    engine,
    workflowId: start.workflow!.id,
    toE164: client.smsFromNumber,
    fromE164: callerE164,
  };
}

describe("SMS qualifier — angry customer", () => {
  it("hands off to a human instead of recording the rant as the customer's name", async () => {
    const { store, sms, client, engine, workflowId, toE164, fromE164 } =
      await startWorkflow();

    await engine.handleInboundSms({ fromE164, toE164, body: "EN" });
    // The customer is furious at the "name" step — the plan requires this
    // to end the conversation / hand off, not get stored as their name.
    await engine.handleInboundSms({
      fromE164,
      toE164,
      body: "This is ridiculous, I've been waiting for hours, your service is garbage!",
    });

    const wf = await store.getWorkflow(workflowId);
    assert.ok(wf);
    assert.equal(wf.humanReviewRequired, true);
    assert.equal(wf.status, "awaiting_human");
    assert.equal(wf.collected.customerName, undefined);

    const alert = sms.sent.find((m) => m.toE164 === client.humanReviewPhone);
    assert.ok(alert, "expected a human-review alert to be sent");
    assert.match(alert.body, /REVUE HUMAINE/);
    assert.match(alert.body, /distress/i);

    const customerReply = sms.sent.find((m) => m.toE164 === fromE164);
    assert.ok(customerReply);
    assert.doesNotMatch(customerReply.body, /What is your full name/i);
  });

  it("hands off on a French-language angry message too", async () => {
    const { store, workflowId, engine, toE164, fromE164 } =
      await startWorkflow();

    await engine.handleInboundSms({ fromE164, toE164, body: "FR" });
    await engine.handleInboundSms({
      fromE164,
      toE164,
      body: "C'est une arnaque, votre service est pourri, je vais vous poursuivre!",
    });

    const wf = await store.getWorkflow(workflowId);
    assert.ok(wf);
    assert.equal(wf.humanReviewRequired, true);
    assert.equal(wf.status, "awaiting_human");
  });
});

describe("SMS qualifier — price requests never get an invented price", () => {
  it("treats a price question as the current step's answer, never as a priced reply", async () => {
    const { store, sms, workflowId, engine, toE164, fromE164 } =
      await startWorkflow();

    await engine.handleInboundSms({ fromE164, toE164, body: "EN" });
    await engine.handleInboundSms({
      fromE164,
      toE164,
      body: "How much will this cost? Can you give me a quote right now?",
    });

    const wf = await store.getWorkflow(workflowId);
    assert.ok(wf);
    // The rule-based engine has no free-form generation path at all, so it
    // is architecturally incapable of inventing a dollar figure — every
    // outbound message is one of the fixed prompts below.
    for (const message of sms.sent) {
      assert.doesNotMatch(message.body, /\$\d/);
    }
    assert.equal(wf.collected.customerName, "How much will this cost? Can you give me a quote right now?");
  });
});

describe("SMS qualifier — hard cap on message count", () => {
  it("hands off to a human instead of looping forever on repeated invalid replies", async () => {
    const store = createMemoryStore();
    const sms = createMemorySmsPort();
    const client = {
      ...demoClientAccount(),
      timeouts: { customerCollectionMs: 2 * 60 * 60 * 1000, maxCustomerMessages: 3 },
    };
    await store.saveClient(client);
    const fixed = wednesdayBusinessHours();
    const engine = createMissedCallEngine({
      store,
      sms,
      clock: { now: () => fixed },
    });
    const fromE164 = "+15145551234";
    const toE164 = client.smsFromNumber;
    const start = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: fromE164,
      answered: false,
      abandoned: false,
      calledAt: fixed,
    });
    const workflowId = start.workflow!.id;

    // 3 messages consume the cap (language reply + 2 collection replies);
    // the 4th must be refused and handed off instead of processed.
    await engine.handleInboundSms({ fromE164, toE164, body: "EN" });
    await engine.handleInboundSms({ fromE164, toE164, body: "Marie Tremblay" });
    await engine.handleInboundSms({ fromE164, toE164, body: "123 Main St" });
    await engine.handleInboundSms({
      fromE164,
      toE164,
      body: "A fourth message that must not be collected as the description",
    });

    const wf = await store.getWorkflow(workflowId);
    assert.ok(wf);
    assert.equal(wf.humanReviewRequired, true);
    assert.equal(wf.status, "awaiting_human");
    assert.equal(wf.collected.issueDescription, undefined);

    const alert = sms.sent.find((m) => m.toE164 === client.humanReviewPhone);
    assert.ok(alert, "expected a human-review alert to be sent");
    assert.match(alert.body, /message_cap/i);
  });
});

describe("SMS qualifier — off-topic / spam-like replies", () => {
  it("keeps collecting instead of crashing on a clearly off-topic reply", async () => {
    const { store, workflowId, engine, toE164, fromE164 } =
      await startWorkflow();

    await engine.handleInboundSms({ fromE164, toE164, body: "EN" });
    await engine.handleInboundSms({
      fromE164,
      toE164,
      body: "Do you also sell gas stoves? Just asking about products, not related to my call.",
    });

    const wf = await store.getWorkflow(workflowId);
    assert.ok(wf);
    assert.equal(wf.status, "awaiting_customer");
    assert.equal(wf.currentStep, "address");
  });
});
