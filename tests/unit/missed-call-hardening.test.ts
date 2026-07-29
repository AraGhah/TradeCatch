import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMissedCallEngine } from "../../src/product/missed-call/engine";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { createMemoryStore } from "../../src/product/missed-call/store";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import { classifyUrgency } from "../../src/product/missed-call/urgency";
import { isAfterHours } from "../../src/product/missed-call/call-handling";
import {
  isEligibleTechnician,
  resolveOnCallTechnicianId,
  getEscalationChain,
} from "../../src/product/missed-call/technicians";

describe("P0/P1 workflow hardening", () => {
  it("classifies electrical sparks as critical human review", () => {
    const { classification } = classifyUrgency({
      issueDescription: "Des étincelles sortent du panneau électrique",
      rubric: demoClientAccount().urgencyRubric,
    });
    assert.equal(classification.level, "critical");
    assert.equal(classification.requiresHuman, true);
  });

  it("remembers SMS opt-out across a later missed call", async () => {
    const store = createMemoryStore();
    const sms = createMemorySmsPort();
    const client = demoClientAccount();
    await store.saveClient(client);
    let now = new Date("2026-07-22T18:00:00.000Z");
    const engine = createMissedCallEngine({
      store,
      sms,
      clock: { now: () => now },
    });

    const caller = "+15145559876";
    await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: caller,
      answered: false,
      abandoned: false,
      calledAt: now,
    });
    await engine.handleInboundSms({
      fromE164: caller,
      toE164: client.smsFromNumber,
      body: "STOP",
    });
    assert.equal(await store.isSmsSuppressed(client.id, caller), true);

    const before = sms.sent.length;
    now = new Date(now.getTime() + 60_000);
    const second = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: caller,
      answered: false,
      abandoned: false,
      calledAt: now,
      twilioCallSid: "CA_second",
    });
    assert.equal(second.smsSent, false);
    assert.equal(second.suppressedReason, "opt_out");
    assert.equal(sms.sent.length, before);
  });

  it("rejects empty required name and stays on the same step", async () => {
    const store = createMemoryStore();
    const sms = createMemorySmsPort();
    const client = demoClientAccount();
    await store.saveClient(client);
    const now = new Date("2026-07-22T18:00:00.000Z");
    const engine = createMissedCallEngine({
      store,
      sms,
      clock: { now: () => now },
    });
    const start = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145551111",
      answered: false,
      abandoned: false,
      calledAt: now,
    });
    const to = client.smsFromNumber;
    const from = "+15145551111";
    await engine.handleInboundSms({ fromE164: from, toE164: to, body: "FR" });
    const bad = await engine.handleInboundSms({
      fromE164: from,
      toE164: to,
      body: " ",
    });
    assert.equal(bad.handled, true);
    const wf = await store.getWorkflow(start.workflow!.id);
    assert.equal(wf?.currentStep, "name");
    assert.equal(wf?.collected.customerName, undefined);
  });

  it("dedupes by Twilio CallSid", async () => {
    const store = createMemoryStore();
    const sms = createMemorySmsPort();
    const client = demoClientAccount();
    await store.saveClient(client);
    const now = new Date("2026-07-22T18:00:00.000Z");
    const engine = createMissedCallEngine({
      store,
      sms,
      clock: { now: () => now },
    });
    const first = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145552222",
      answered: false,
      abandoned: false,
      calledAt: now,
      twilioCallSid: "CA_same",
    });
    const second = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145552222",
      answered: false,
      abandoned: false,
      calledAt: now,
      twilioCallSid: "CA_same",
    });
    assert.equal(first.smsSent, true);
    assert.equal(second.smsSent, false);
    assert.equal(second.suppressedReason, "duplicate_call_sid");
  });

  it("escalates through every backup before owner", async () => {
    const store = createMemoryStore();
    const sms = createMemorySmsPort();
    const client = demoClientAccount({
      escalationPolicy: {
        primaryResponseMs: 1,
        backupResponseMs: 1,
        ownerResponseMs: 60_000,
      },
    });
    await store.saveClient(client);
    let now = new Date("2026-07-22T18:00:00.000Z");
    const engine = createMissedCallEngine({
      store,
      sms,
      clock: { now: () => now },
    });
    const start = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145553333",
      answered: false,
      abandoned: false,
      calledAt: now,
    });
    const to = client.smsFromNumber;
    const from = "+15145553333";
    await engine.handleInboundSms({ fromE164: from, toE164: to, body: "FR" });
    await engine.handleInboundSms({ fromE164: from, toE164: to, body: "Pat" });
    await engine.handleInboundSms({
      fromE164: from,
      toE164: to,
      body: "10 rue Test, Laval",
    });
    await engine.handleInboundSms({
      fromE164: from,
      toE164: to,
      body: "Fuite mineure",
    });
    await engine.handleInboundSms({ fromE164: from, toE164: to, body: "NON" });

    assert.ok(sms.sent.some((m) => m.toE164 === "+15145550199"));
    now = new Date(now.getTime() + 5_000);
    await engine.processEscalations();
    assert.ok(sms.sent.some((m) => m.toE164 === "+15145550288"));
    now = new Date(now.getTime() + 5_000);
    await engine.processEscalations();
    assert.ok(sms.sent.some((m) => m.toE164 === "+15145550299"));
    const wf = await store.getWorkflow(start.workflow!.id);
    assert.equal(wf?.assignedTechnicianId, "tech_backup_2");
  });

  it("skips inactive primary when resolving on-call", () => {
    const base = demoClientAccount();
    const client = demoClientAccount({
      technicianRoster: base.technicianRoster.map((t) =>
        t.id === "tech_marc" ? { ...t, active: false } : t,
      ),
      onCallTechnicians: base.onCallTechnicians.map((t) =>
        t.id === "tech_marc" ? { ...t, active: false } : t,
      ),
    });
    assert.equal(isEligibleTechnician(client, "tech_marc"), null);
    const id = resolveOnCallTechnicianId(
      client,
      new Date("2026-07-22T18:00:00.000Z"),
    );
    assert.notEqual(id, "tech_marc");
    assert.ok(
      getEscalationChain(client, new Date("2026-07-22T18:00:00.000Z")).length >=
        1,
    );
  });

  it("matches overnight on-call slots on the following morning", () => {
    const nightTech = "tech_night";
    const client = demoClientAccount({
      technicianRoster: [
        ...demoClientAccount().technicianRoster,
        {
          id: nightTech,
          name: "Night",
          phone: "+15145550999",
          role: "backup",
          active: true,
        },
      ],
      onCallSchedule: [
        { day: 1, start: "22:00", end: "06:00", technicianId: nightTech },
      ],
      mainTechnicianId: "tech_marc",
    });
    // Tuesday 2026-07-21 02:00 America/Toronto (EDT, UTC-4)
    const tue0200Toronto = new Date("2026-07-21T06:00:00.000Z");
    const id = resolveOnCallTechnicianId(client, tue0200Toronto);
    assert.equal(id, nightTech);
  });

  it("treats overnight business-hours carryover as in-hours", () => {
    const client = demoClientAccount({
      businessHours: { start: "22:00", end: "06:00", days: [1] },
    });
    // Monday 23:00 Toronto
    assert.equal(
      isAfterHours(client, new Date("2026-07-21T03:00:00.000Z")),
      false,
    );
    // Tuesday 02:00 Toronto (carryover from Monday overnight)
    assert.equal(
      isAfterHours(client, new Date("2026-07-21T06:00:00.000Z")),
      false,
    );
    // Tuesday 10:00 Toronto (outside overnight window)
    assert.equal(
      isAfterHours(client, new Date("2026-07-21T14:00:00.000Z")),
      true,
    );
  });
});
