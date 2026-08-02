import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMissedCallEngine } from "../../src/product/missed-call/engine";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { createMemoryStore } from "../../src/product/missed-call/store";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";

function wednesday(): Date {
  return new Date("2026-07-22T18:00:00.000Z");
}

describe("P0 engine regressions", () => {
  it("does not re-alert human review after escalation exhaustion", async () => {
    const store = createMemoryStore();
    const client = demoClientAccount({
      escalationPolicy: {
        primaryResponseMs: 1,
        backupResponseMs: 1,
        ownerResponseMs: 1,
      },
    });
    await store.saveClient(client);
    const sms = createMemorySmsPort();
    let now = wednesday();
    const engine = createMissedCallEngine({
      store,
      sms,
      clock: { now: () => now },
    });

    await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145557701",
      answered: false,
      abandoned: false,
      calledAt: now,
    });
    const to = client.smsFromNumber;
    const from = "+15145557701";
    for (const body of ["FR", "Pat", "10 rue Test, Laval", "Fuite", "NON"]) {
      await engine.handleInboundSms({ fromE164: from, toE164: to, body });
    }

    // Advance past every escalation stage.
    for (let i = 0; i < 8; i += 1) {
      now = new Date(now.getTime() + 60_000);
      await engine.processEscalations();
    }

    const before = sms.sent.filter((m) =>
      m.body.toLowerCase().includes("revue") ||
      m.body.toLowerCase().includes("review") ||
      m.toE164 === client.humanReviewPhone,
    ).length;

    now = new Date(now.getTime() + 60_000);
    await engine.processEscalations();
    now = new Date(now.getTime() + 60_000);
    await engine.processEscalations();

    const after = sms.sent.filter((m) =>
      m.body.toLowerCase().includes("revue") ||
      m.body.toLowerCase().includes("review") ||
      m.toE164 === client.humanReviewPhone,
    ).length;

    assert.equal(after, before, "human-review SMS must not grow after exhaustion");
    const wf = (await store.listLeads(client.id))[0];
    assert.ok(wf);
    const workflows = await store.listWorkflowsAwaitingTechnician();
    assert.equal(workflows.length, 0);
  });

  it("reuses deterministic outbox id for opening SMS retries", async () => {
    const store = createMemoryStore();
    const client = demoClientAccount();
    await store.saveClient(client);
    let failOnce = true;
    const sms = {
      async send() {
        if (failOnce) {
          failOnce = false;
          throw new Error("twilio down");
        }
        return { sid: "SM_ok" };
      },
    };
    const now = wednesday();
    const engine = createMissedCallEngine({
      store,
      sms,
      clock: { now: () => now },
    });

    await assert.rejects(() =>
      engine.handleCallEvent({
        clientAccountId: client.id,
        callerE164: "+15145557702",
        answered: false,
        abandoned: false,
        calledAt: now,
        twilioCallSid: "CA_retry_open",
      }),
    );

    const retry = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145557702",
      answered: false,
      abandoned: false,
      calledAt: now,
      twilioCallSid: "CA_retry_open",
    });
    assert.equal(retry.smsSent, true);

    const stats = await store.getOutboundQueueStats();
    assert.equal(stats.queued, 0);
    assert.equal(stats.retry, 0);
  });

  it("returns technician APPELER guidance containing the caller number", async () => {
    const store = createMemoryStore();
    const client = demoClientAccount();
    await store.saveClient(client);
    const sms = createMemorySmsPort();
    const now = wednesday();
    const engine = createMissedCallEngine({
      store,
      sms,
      clock: { now: () => now },
    });
    await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145557703",
      answered: false,
      abandoned: false,
      calledAt: now,
    });
    const to = client.smsFromNumber;
    for (const body of ["FR", "Pat", "10 rue Test, Laval", "Fuite", "NON"]) {
      await engine.handleInboundSms({
        fromE164: "+15145557703",
        toE164: to,
        body,
      });
    }
    const wf = (await store.listWorkflowsAwaitingTechnician())[0]!;
    const token = wf.technicianAlerts[0]!.actionToken;
    const primary = client.technicianRoster.find((t) => t.role === "primary")!;
    const result = await engine.handleInboundSms({
      fromE164: primary.phone,
      toE164: to,
      body: `APPELER ${token}`,
    });
    assert.match(result.replies.join(" "), /\+15145557703/);
  });
});
