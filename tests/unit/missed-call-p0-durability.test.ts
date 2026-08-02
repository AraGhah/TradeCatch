import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMissedCallEngine } from "../../src/product/missed-call/engine";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { createMemoryStore } from "../../src/product/missed-call/store";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";

/** Wednesday 14:00 America/Toronto — Marc (primary) is on-call, not weekend Sophie. */
function wednesdayBusinessHours(): Date {
  return new Date("2026-07-22T18:00:00.000Z");
}

describe("P0 durability fixes", () => {
  it("releases inbound MessageSid after handler failure so Twilio can retry", async () => {
    const store = createMemoryStore();
    const client = demoClientAccount();
    await store.saveClient(client);
    const now = wednesdayBusinessHours();

    let calls = 0;
    const sms = {
      async send() {
        calls += 1;
        // Opening SMS succeeds; first customer prompt fails once.
        if (calls === 2) {
          throw new Error("twilio down");
        }
        return { sid: `SM_${calls}` };
      },
    };

    const engine = createMissedCallEngine({
      store,
      sms,
      clock: { now: () => now },
    });
    await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145551111",
      answered: false,
      abandoned: false,
      calledAt: now,
    });

    await assert.rejects(() =>
      engine.handleInboundSms({
        fromE164: "+15145551111",
        toE164: client.smsFromNumber,
        body: "FR",
        messageSid: "SM_retry_me",
      }),
    );

    const again = await engine.handleInboundSms({
      fromE164: "+15145551111",
      toE164: client.smsFromNumber,
      body: "FR",
      messageSid: "SM_retry_me",
    });
    assert.equal(again.handled, true);
    assert.ok(again.replies.length > 0);
  });

  it("reclaims stale sending outbox rows", async () => {
    const store = createMemoryStore();
    const now = new Date().toISOString();
    await store.enqueueOutbound({
      id: "sms_stuck",
      clientAccountId: "c1",
      toE164: "+15145550000",
      fromE164: "+15145550001",
      body: "hello",
      status: "sending",
      attempts: 0,
      createdAt: now,
      updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    const claimed = await store.claimOutboundForSend(10, 5 * 60 * 1000);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0]?.id, "sms_stuck");
    assert.equal(claimed[0]?.status, "sending");
  });

  it("registers technician action token before SMS send so outbox retry stays actionable", async () => {
    const store = createMemoryStore();
    const client = demoClientAccount();
    await store.saveClient(client);
    const now = wednesdayBusinessHours();
    let failJobCard = true;
    const primary = client.technicianRoster.find((t) => t.role === "primary");
    assert.ok(primary);
    const sms = {
      async send(input: { toE164: string; body: string }) {
        if (input.toE164 === primary.phone && failJobCard) {
          failJobCard = false;
          throw new Error("job card failed");
        }
        return { sid: "SM_ok" };
      },
    };
    const engine = createMissedCallEngine({
      store,
      sms,
      clock: { now: () => now },
    });
    await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145553301",
      answered: false,
      abandoned: false,
      calledAt: now,
    });
    const to = client.smsFromNumber;
    const from = "+15145553301";
    for (const body of ["FR", "Pat", "10 rue Test, Laval", "Fuite", "NON"]) {
      try {
        await engine.handleInboundSms({ fromE164: from, toE164: to, body });
      } catch {
        // expected on first job card send
      }
    }

    const wfBefore = (await store.listWorkflowsAwaitingTechnician())[0];
    assert.ok(wfBefore);
    assert.ok(wfBefore.technicianAlerts[0]?.actionToken);

    await engine.processEscalations();
    const token = wfBefore.technicianAlerts[0]!.actionToken;
    const accept = await engine.handleInboundSms({
      fromE164: primary.phone,
      toE164: to,
      body: `ACCEPTER ${token}`,
    });
    assert.equal(accept.handled, true);
    assert.match(accept.replies.join(" "), /acceptée|accept/i);
  });

  it("keeps technician alert open when customer notify fails", async () => {
    const store = createMemoryStore();
    const client = demoClientAccount();
    await store.saveClient(client);
    const now = wednesdayBusinessHours();
    const sms = createMemorySmsPort();
    const engine = createMissedCallEngine({
      store,
      sms,
      clock: { now: () => now },
    });
    await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145553302",
      answered: false,
      abandoned: false,
      calledAt: now,
    });
    const to = client.smsFromNumber;
    const from = "+15145553302";
    for (const body of ["FR", "Pat", "10 rue Test, Laval", "Fuite", "NON"]) {
      await engine.handleInboundSms({ fromE164: from, toE164: to, body });
    }
    await store.addSmsSuppression({
      clientAccountId: client.id,
      phoneE164: from,
      channel: "sms",
      source: "manual",
      at: now.toISOString(),
      providerStatus: "local_only",
    });
    const wf = (await store.listWorkflowsAwaitingTechnician())[0];
    assert.ok(wf);
    const token = wf.technicianAlerts[0]!.actionToken;
    const primary = client.technicianRoster.find((t) => t.role === "primary")!;
    const accept = await engine.handleInboundSms({
      fromE164: primary.phone,
      toE164: to,
      body: `ACCEPTER ${token}`,
    });
    assert.equal(accept.handled, true);
    const after = await store.getWorkflow(wf.id);
    assert.equal(after?.acceptNotifyPending, true);
    assert.ok(after?.technicianAlerts.some((a) => !a.respondedAt));
  });

  it("recreates workflow when call exists without workflow on Twilio retry", async () => {
    const store = createMemoryStore();
    const client = demoClientAccount();
    await store.saveClient(client);
    const now = wednesdayBusinessHours();
    const sms = createMemorySmsPort();
    const engine = createMissedCallEngine({
      store,
      sms,
      clock: { now: () => now },
    });

    const first = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145554444",
      answered: false,
      abandoned: false,
      twilioCallSid: "CA_orphan",
      calledAt: now,
    });
    assert.ok(first.workflow);
    const call = first.call;

    const store2 = createMemoryStore();
    await store2.saveClient(client);
    await store2.saveCall(call);

    const engine2 = createMissedCallEngine({
      store: store2,
      sms,
      clock: { now: () => now },
    });
    const retry = await engine2.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145554444",
      answered: false,
      abandoned: false,
      twilioCallSid: "CA_orphan",
      calledAt: now,
    });
    assert.ok(retry.workflow);
    assert.equal(retry.workflow?.callId, call.id);
    assert.notEqual(retry.suppressedReason, "duplicate_call_sid");
  });

  it("only one concurrent escalation claim wins", async () => {
    const store = createMemoryStore();
    const client = demoClientAccount();
    await store.saveClient(client);
    const now = wednesdayBusinessHours();
    const sms = createMemorySmsPort();
    const engine = createMissedCallEngine({
      store,
      sms,
      clock: { now: () => now },
    });
    await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145555555",
      answered: false,
      abandoned: false,
      calledAt: now,
    });
    const to = client.smsFromNumber;
    const from = "+15145555555";
    for (const body of ["FR", "Pat", "10 rue Test, Laval", "Fuite", "NON"]) {
      await engine.handleInboundSms({ fromE164: from, toE164: to, body });
    }
    const wf = (await store.listWorkflowsAwaitingTechnician())[0]!;
    const first = await store.claimWorkflowEscalation(wf.id, 60_000, now);
    const second = await store.claimWorkflowEscalation(wf.id, 60_000, now);
    assert.ok(first);
    assert.equal(second, null);
  });
});
