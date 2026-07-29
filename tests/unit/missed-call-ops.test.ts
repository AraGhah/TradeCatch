import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyManualCorrection } from "../../src/product/missed-call/crm";
import { createMissedCallEngine } from "../../src/product/missed-call/engine";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { checkServiceArea } from "../../src/product/missed-call/service-area";
import { createMemoryStore } from "../../src/product/missed-call/store";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import { classifyUrgency } from "../../src/product/missed-call/urgency";
import type { LeadRecord } from "../../src/product/missed-call/types";

describe("service-area checking", () => {
  const client = demoClientAccount();

  it("marks approved cities as inside", () => {
    const r = checkServiceArea("123 rue Principale, Laval", client.approvedServiceAreas);
    assert.equal(r.verdict, "inside");
    assert.equal(r.sendToHuman, false);
  });

  it("flags uncertain addresses for human review without auto-reject", () => {
    const r = checkServiceArea("chez moi", client.approvedServiceAreas);
    assert.equal(r.verdict, "uncertain");
    assert.equal(r.sendToHuman, true);
  });

  it("flags likely outside addresses for human review", () => {
    const r = checkServiceArea(
      "500 rue King, Toronto ON",
      client.approvedServiceAreas,
    );
    assert.equal(r.verdict, "outside");
    assert.equal(r.sendToHuman, true);
  });
});

describe("urgency handling", () => {
  const client = demoClientAccount();

  it("requires human for hard-coded gas trigger", () => {
    const { classification, log } = classifyUrgency({
      issueDescription: "Forte odeur de gaz dans la cuisine",
      rubric: client.urgencyRubric,
    });
    assert.equal(classification.level, "critical");
    assert.equal(classification.requiresHuman, true);
    assert.equal(classification.source, "critical_gas");
    assert.match(log.textSample, /gaz/i);
  });

  it("uses contractor rubric for priority leaks", () => {
    const { classification } = classifyUrgency({
      issueDescription: "Fuite d'eau importante au sous-sol",
      rubric: client.urgencyRubric,
    });
    assert.equal(classification.level, "priority");
    assert.equal(classification.escalated, false);
  });

  it("escalates uncertain short descriptions to human", () => {
    const { classification } = classifyUrgency({
      issueDescription: "fuite",
      rubric: client.urgencyRubric,
    });
    assert.equal(classification.requiresHuman, true);
    assert.equal(classification.source, "uncertain:short_description");
  });
});

describe("technician escalation + CRM", () => {
  it("escalates to backup when primary timer expires", async () => {
    const store = createMemoryStore();
    const sms = createMemorySmsPort();
    const client = demoClientAccount({
      escalationPolicy: {
        primaryResponseMs: 1,
        backupResponseMs: 60_000,
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
      callerE164: "+15145551001",
      answered: false,
      abandoned: false,
      calledAt: now,
    });

    const to = client.smsFromNumber;
    const from = "+15145551001";
    await engine.handleInboundSms({ fromE164: from, toE164: to, body: "FR" });
    await engine.handleInboundSms({ fromE164: from, toE164: to, body: "Test User" });
    await engine.handleInboundSms({
      fromE164: from,
      toE164: to,
      body: "10 rue Principale, Laval",
    });
    await engine.handleInboundSms({
      fromE164: from,
      toE164: to,
      body: "Robinet qui goutte",
    });
    await engine.handleInboundSms({ fromE164: from, toE164: to, body: "NON" });

    assert.ok(sms.sent.some((m) => m.toE164 === "+15145550199"));

    now = new Date(now.getTime() + 5_000);
    const tick = await engine.processEscalations();
    assert.equal(tick.escalated.length, 1);
    assert.ok(sms.sent.some((m) => m.toE164 === "+15145550288"));

    const lead = await store.getLeadByWorkflowId(start.workflow!.id);
    assert.ok(lead);
    assert.ok(lead.techniciansAlerted.length >= 2);
    assert.ok(lead.conversation.length > 0);

    // Primary (Marc) must not be able to accept after escalation to Sophie.
    const marcStale = await engine.handleInboundSms({
      fromE164: "+15145550199",
      toE164: to,
      body: "OUI",
    });
    assert.equal(marcStale.handled, true);
    assert.match(marcStale.replies.join(" "), /plus active/i);

    const stillOpen = await store.getWorkflow(start.workflow!.id);
    assert.equal(stillOpen?.status, "awaiting_technician");
    assert.equal(stillOpen?.assignedTechnicianId, "tech_sophie");
    assert.notEqual(stillOpen?.outcome, "technician_accepted");

    const sophieCard = [...sms.sent]
      .reverse()
      .find((m) => m.toE164 === "+15145550288" && /Code:/i.test(m.body));
    assert.ok(sophieCard);
    const code = sophieCard.body.match(/Code:\s*([A-Z0-9]+)/i)?.[1];
    assert.ok(code);

    await engine.handleInboundSms({
      fromE164: "+15145550288",
      toE164: to,
      body: `ACCEPTER ${code}`,
    });
    const done = await store.getWorkflow(start.workflow!.id);
    assert.equal(done?.outcome, "technician_accepted");
    assert.equal(done?.assignedTechnicianId, "tech_sophie");
    const notify = sms.sent.find(
      (m) =>
        m.toE164 === "+15145551001" && /Sophie|accepté votre demande/i.test(m.body),
    );
    assert.ok(notify);
    assert.match(notify.body, /Sophie/);
  });

  it("supports manual CRM corrections", () => {
    const lead: LeadRecord = {
      id: "lead_test",
      clientAccountId: "client_demo",
      workflowId: "wf_test",
      callId: "call_test",
      callerE164: "+1",
      photoUrls: [],
      serviceAreaFlagged: false,
      humanReviewRequired: false,
      conversation: [],
      techniciansAlerted: [],
      manualCorrections: [],
      outcome: "open" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    applyManualCorrection(lead, "becameBooking", true, "Booked by dispatcher");
    applyManualCorrection(lead, "finalValue", 850, "Invoice entered");
    assert.equal(lead.becameBooking, true);
    assert.equal(lead.finalValue, 850);
    assert.equal(lead.manualCorrections.length, 2);
  });
});
