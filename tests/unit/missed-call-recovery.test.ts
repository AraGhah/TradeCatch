import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyCall,
  isAfterHours,
  shouldStartRecovery,
} from "../../src/product/missed-call/call-handling";
import { createMissedCallEngine } from "../../src/product/missed-call/engine";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import {
  isOptOut,
  openingSms,
} from "../../src/product/missed-call/messaging";
import { createMemoryStore } from "../../src/product/missed-call/store";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";

function wednesdayBusinessHours(): Date {
  // 2026-07-22 14:00 America/Toronto = Wednesday afternoon
  return new Date("2026-07-22T18:00:00.000Z");
}

function wednesdayNight(): Date {
  // 2026-07-22 22:00 America/Toronto
  return new Date("2026-07-23T02:00:00.000Z");
}

describe("call handling", () => {
  const client = demoClientAccount();

  it("detects after-hours", () => {
    assert.equal(isAfterHours(client, wednesdayBusinessHours()), false);
    assert.equal(isAfterHours(client, wednesdayNight()), true);
  });

  it("classifies missed, answered, abandoned, after-hours", () => {
    assert.equal(
      classifyCall({
        client,
        calledAt: wednesdayBusinessHours(),
        answered: false,
        abandoned: false,
      }),
      "missed",
    );
    assert.equal(
      classifyCall({
        client,
        calledAt: wednesdayNight(),
        answered: false,
        abandoned: false,
      }),
      "after_hours_missed",
    );
    assert.equal(
      classifyCall({
        client,
        calledAt: wednesdayBusinessHours(),
        answered: true,
        abandoned: false,
      }),
      "answered",
    );
    assert.equal(
      classifyCall({
        client,
        calledAt: wednesdayBusinessHours(),
        answered: false,
        abandoned: true,
      }),
      "abandoned",
    );
  });

  it("only starts recovery for missed variants", () => {
    assert.equal(shouldStartRecovery("missed"), true);
    assert.equal(shouldStartRecovery("after_hours_missed"), true);
    assert.equal(shouldStartRecovery("answered"), false);
    assert.equal(shouldStartRecovery("abandoned"), false);
  });
});

describe("customer SMS messaging", () => {
  const client = demoClientAccount();

  it("opens in French, names contractor, offers English", () => {
    const open = openingSms(client);
    assert.match(open, /Nord Plomberie/);
    assert.match(open, /manqué votre appel/i);
    assert.match(open, /EN/);
  });

  it("detects opt-out keywords", () => {
    assert.equal(isOptOut("STOP", client), true);
    assert.equal(isOptOut("arrêt", client), true);
    assert.equal(isOptOut("Jean Tremblay", client), false);
  });
});

describe("Module A end-to-end workflow", () => {
  it("runs missed → SMS → collect → tech alert → accept → notify → outcome", async () => {
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

    const start = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145551234",
      answered: false,
      abandoned: false,
      calledAt: fixed,
    });

    assert.equal(start.smsSent, true);
    assert.ok(start.workflow);
    assert.equal(start.call.disposition, "missed");
    assert.equal(start.call.callerE164, "+15145551234");
    assert.equal(start.call.clientAccountId, client.id);
    assert.match(sms.sent[0].body, /Nord Plomberie/);

    const to = client.smsFromNumber;
    const from = "+15145551234";

    await engine.handleInboundSms({ fromE164: from, toE164: to, body: "FR" });
    await engine.handleInboundSms({
      fromE164: from,
      toE164: to,
      body: "Marie Tremblay",
    });
    await engine.handleInboundSms({
      fromE164: from,
      toE164: to,
      body: "123 rue Principale, Laval",
    });
    await engine.handleInboundSms({
      fromE164: from,
      toE164: to,
      body: "Fuite d'eau sous l'évier",
    });
    await engine.handleInboundSms({
      fromE164: from,
      toE164: to,
      body: "NON",
    });

    const wf = await store.getWorkflow(start.workflow!.id);
    assert.ok(wf);
    assert.equal(wf.status, "awaiting_technician");
    assert.equal(wf.collected.customerName, "Marie Tremblay");
    assert.equal(wf.collected.serviceAddress, "123 rue Principale, Laval");
    assert.equal(wf.collected.issueDescription, "Fuite d'eau sous l'évier");
    assert.equal(wf.assignedTechnicianId, "tech_marc");

    const techAlert = sms.sent.find((m) => m.toE164 === "+15145550199");
    assert.ok(techAlert);
    assert.match(techAlert.body, /FICHE JOB/);
    assert.match(techAlert.body, /ACCEPTER/);
    const codeMatch = techAlert.body.match(/Code:\s*([A-Z0-9]+)/i);
    assert.ok(codeMatch);
    const code = codeMatch[1];

    // Bare OUI without code must not complete the job.
    await engine.handleInboundSms({
      fromE164: "+15145550199",
      toE164: to,
      body: "OUI",
    });
    assert.equal(
      (await store.getWorkflow(start.workflow!.id))?.status,
      "awaiting_technician",
    );

    await engine.handleInboundSms({
      fromE164: "+15145550199",
      toE164: to,
      body: `OUI ${code}`,
    });

    const done = await store.getWorkflow(start.workflow!.id);
    assert.equal(done?.status, "completed");
    assert.equal(done?.outcome, "technician_accepted");
    assert.ok(done?.events.some((e) => e.type === "customer_notified"));
    assert.ok(done?.events.some((e) => e.type === "outcome_recorded"));

    const customerNotify = sms.sent.find(
      (m) =>
        m.toE164 === from &&
        /accepté votre demande/i.test(m.body),
    );
    assert.ok(customerNotify);
    assert.match(customerNotify.body, /Marc/);
  });

  it("suppresses duplicate workflows for repeat calls", async () => {
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

    const first = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145559999",
      answered: false,
      abandoned: false,
      calledAt: fixed,
    });
    const second = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145559999",
      answered: false,
      abandoned: false,
      calledAt: new Date(fixed.getTime() + 60_000),
    });

    assert.equal(first.smsSent, true);
    assert.equal(second.smsSent, false);
    assert.equal(second.suppressedReason, "duplicate_suppressed");
    assert.equal(second.workflow?.id, first.workflow?.id);
    assert.equal(sms.sent.filter((m) => m.toE164 === "+15145559999").length, 1);
  });

  it("does not SMS answered or abandoned calls", async () => {
    const store = createMemoryStore();
    const sms = createMemorySmsPort();
    await store.saveClient(demoClientAccount());
    const engine = createMissedCallEngine({ store, sms });

    const answered = await engine.handleCallEvent({
      clientAccountId: "client_demo",
      callerE164: "+15145550001",
      answered: true,
      abandoned: false,
    });
    const abandoned = await engine.handleCallEvent({
      clientAccountId: "client_demo",
      callerE164: "+15145550002",
      answered: false,
      abandoned: true,
    });

    assert.equal(answered.smsSent, false);
    assert.equal(abandoned.smsSent, false);
    assert.equal(sms.sent.length, 0);
  });

  it("stops on customer opt-out", async () => {
    const store = createMemoryStore();
    const sms = createMemorySmsPort();
    const client = demoClientAccount();
    await store.saveClient(client);
    const engine = createMissedCallEngine({ store, sms });

    const start = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145550003",
      answered: false,
      abandoned: false,
      calledAt: wednesdayBusinessHours(),
    });

    await engine.handleInboundSms({
      fromE164: "+15145550003",
      toE164: client.smsFromNumber,
      body: "STOP",
    });

    const wf = await store.getWorkflow(start.workflow!.id);
    assert.equal(wf?.status, "stopped");
    assert.equal(wf?.stopReason, "opt_out");
    assert.equal(wf?.outcome, "cancelled");
  });

  it("switches to English when customer replies EN", async () => {
    const store = createMemoryStore();
    const sms = createMemorySmsPort();
    const client = demoClientAccount();
    await store.saveClient(client);
    const engine = createMissedCallEngine({ store, sms });

    await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145550004",
      answered: false,
      abandoned: false,
      calledAt: wednesdayBusinessHours(),
    });

    await engine.handleInboundSms({
      fromE164: "+15145550004",
      toE164: client.smsFromNumber,
      body: "EN",
    });

    const namePrompt = sms.sent.at(-1);
    assert.match(namePrompt?.body ?? "", /full name/i);
  });

  it("accepts photo MMS URLs", async () => {
    const store = createMemoryStore();
    const sms = createMemorySmsPort();
    const client = demoClientAccount();
    await store.saveClient(client);
    const engine = createMissedCallEngine({ store, sms });
    const from = "+15145550005";
    const to = client.smsFromNumber;

    const start = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: from,
      answered: false,
      abandoned: false,
      calledAt: wednesdayBusinessHours(),
    });

    await engine.handleInboundSms({ fromE164: from, toE164: to, body: "FR" });
    await engine.handleInboundSms({ fromE164: from, toE164: to, body: "Alex" });
    await engine.handleInboundSms({
      fromE164: from,
      toE164: to,
      body: "10 rue Test, Laval",
    });
    await engine.handleInboundSms({
      fromE164: from,
      toE164: to,
      body: "Chaudière en panne",
    });
    await engine.handleInboundSms({
      fromE164: from,
      toE164: to,
      body: "",
      mediaUrls: ["https://example.com/photo.jpg"],
    });

    const wf = await store.getWorkflow(start.workflow!.id);
    assert.deepEqual(wf?.collected.photoUrls, [
      "https://example.com/photo.jpg",
    ]);
    assert.equal(wf?.status, "awaiting_technician");
  });
});
