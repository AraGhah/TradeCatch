import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyManualCorrection,
  createLeadFromWorkflow,
  findOpenAlertForPhone,
} from "../../src/product/missed-call/crm";
import { createMissedCallEngine } from "../../src/product/missed-call/engine";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { validateCollectionAnswer } from "../../src/product/missed-call/messaging";
import { createMemoryStore } from "../../src/product/missed-call/store";
import {
  createDryRunSmsPort,
  createMemorySmsPort,
  createTwilioSmsPort,
} from "../../src/product/missed-call/twilio";
import { classifyUrgency } from "../../src/product/missed-call/urgency";
import { isAfterHours } from "../../src/product/missed-call/call-handling";
import {
  getEscalationChain,
  resolveOnCallTechnicianId,
} from "../../src/product/missed-call/technicians";
import type { MissedCallWorkflow, SmsPort } from "../../src/product/missed-call/types";

async function collectToTechAlert(input: {
  store: ReturnType<typeof createMemoryStore>;
  sms: ReturnType<typeof createMemorySmsPort>;
  client: ReturnType<typeof demoClientAccount>;
  caller: string;
  getNow: () => Date;
  issue?: string;
}) {
  const { store, sms, client, caller, getNow } = input;
  const engine = createMissedCallEngine({
    store,
    sms,
    clock: { now: getNow },
  });
  const start = await engine.handleCallEvent({
    clientAccountId: client.id,
    callerE164: caller,
    answered: false,
    abandoned: false,
    calledAt: getNow(),
    twilioCallSid: `CA_${caller.slice(-4)}_${getNow().getTime()}`,
  });
  const to = client.smsFromNumber;
  await engine.handleInboundSms({ fromE164: caller, toE164: to, body: "FR" });
  await engine.handleInboundSms({ fromE164: caller, toE164: to, body: "Pat" });
  await engine.handleInboundSms({
    fromE164: caller,
    toE164: to,
    body: "10 rue Test, Laval",
  });
  await engine.handleInboundSms({
    fromE164: caller,
    toE164: to,
    body: input.issue ?? "Fuite mineure sous évier",
  });
  await engine.handleInboundSms({ fromE164: caller, toE164: to, body: "NON" });
  return { engine, workflowId: start.workflow!.id };
}

describe("dangerous branch coverage", () => {
  it("rejects late primary reply after escalation to backup", async () => {
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
    const { engine, workflowId } = await collectToTechAlert({
      store,
      sms,
      client,
      caller: "+15145557001",
      getNow: () => now,
    });

    const beforeEscalation = await store.getWorkflow(workflowId);
    const primaryAlert = beforeEscalation!.technicianAlerts[0]!;
    assert.equal(primaryAlert.technicianId, "tech_marc");

    now = new Date(now.getTime() + 5_000);
    await engine.processEscalations();

    const after = await store.getWorkflow(workflowId);
    assert.ok(after!.technicianAlerts.some((a) => a.technicianId === "tech_sophie"));
    assert.ok(after!.technicianAlerts[0]!.respondedAt);

    const late = await engine.handleInboundSms({
      fromE164: primaryAlert.phone,
      toE164: client.smsFromNumber,
      body: `ACCEPTER ${primaryAlert.actionToken}`,
    });
    assert.equal(late.handled, true);
    const done = await store.getWorkflow(workflowId);
    assert.notEqual(done?.outcome, "technician_accepted");
    assert.notEqual(done?.assignedTechnicianId, "tech_marc");
  });

  it("routes technician replies to the matching open workflow among several", async () => {
    const store = createMemoryStore();
    const sms = createMemorySmsPort();
    const client = demoClientAccount({
      escalationPolicy: {
        primaryResponseMs: 60_000,
        backupResponseMs: 60_000,
        ownerResponseMs: 60_000,
      },
    });
    await store.saveClient(client);
    let now = new Date("2026-07-22T18:00:00.000Z");

    const a = await collectToTechAlert({
      store,
      sms,
      client,
      caller: "+15145557011",
      getNow: () => now,
    });
    now = new Date(now.getTime() + 1_000);
    const b = await collectToTechAlert({
      store,
      sms,
      client,
      caller: "+15145557012",
      getNow: () => now,
    });

    const wfB = await store.getWorkflow(b.workflowId);
    const alertB = wfB!.technicianAlerts.at(-1)!;
    await a.engine.handleInboundSms({
      fromE164: alertB.phone,
      toE164: client.smsFromNumber,
      body: `ACCEPTER ${alertB.actionToken}`,
    });

    const doneB = await store.getWorkflow(b.workflowId);
    const stillA = await store.getWorkflow(a.workflowId);
    assert.equal(doneB?.outcome, "technician_accepted");
    assert.equal(stillA?.status, "awaiting_technician");
  });

  it("rejects required photo skip with NON", async () => {
    const store = createMemoryStore();
    const sms = createMemorySmsPort();
    const base = demoClientAccount();
    const client = demoClientAccount({
      approvedQuestions: base.approvedQuestions.map((q) =>
        q.id === "photo" ? { ...q, required: true } : q,
      ),
    });
    await store.saveClient(client);
    const now = new Date("2026-07-22T18:00:00.000Z");
    const engine = createMissedCallEngine({
      store,
      sms,
      clock: { now: () => now },
    });
    const start = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145557021",
      answered: false,
      abandoned: false,
      calledAt: now,
    });
    const to = client.smsFromNumber;
    const from = "+15145557021";
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
    const wf = await store.getWorkflow(start.workflow!.id);
    assert.equal(wf?.currentStep, "photo");
    assert.equal(wf?.status, "awaiting_customer");
  });

  it("dedupes across fixed bucket boundaries via rolling window", async () => {
    const store = createMemoryStore();
    const sms = createMemorySmsPort();
    const client = demoClientAccount({ duplicateWindowMs: 30 * 60 * 1000 });
    await store.saveClient(client);
    // Two instants one second apart that fall in different 30-min buckets when
    // keyed by Math.floor(ms / window) alone.
    const t1 = new Date("2026-07-22T17:59:59.000Z");
    const t2 = new Date("2026-07-22T18:00:00.000Z");
    const engine = createMissedCallEngine({
      store,
      sms,
      clock: { now: () => t2 },
    });
    const first = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145557031",
      answered: false,
      abandoned: false,
      calledAt: t1,
      twilioCallSid: "CA_bucket_a",
    });
    const second = await engine.handleCallEvent({
      clientAccountId: client.id,
      callerE164: "+15145557031",
      answered: false,
      abandoned: false,
      calledAt: t2,
      twilioCallSid: "CA_bucket_b",
    });
    assert.equal(first.smsSent, true);
    assert.equal(second.smsSent, false);
    assert.ok(second.suppressedReason);
  });

  it("handles concurrent escalation ticks without duplicate backup alerts", async () => {
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
    const { engine, workflowId } = await collectToTechAlert({
      store,
      sms,
      client,
      caller: "+15145557041",
      getNow: () => now,
    });
    now = new Date(now.getTime() + 5_000);
    const [r1, r2] = await Promise.all([
      engine.processEscalations(),
      engine.processEscalations(),
    ]);
    assert.ok(r1.escalated.includes(workflowId) || r2.escalated.includes(workflowId));
    const wf = await store.getWorkflow(workflowId);
    const sophieAlerts = wf!.technicianAlerts.filter(
      (a) => a.technicianId === "tech_sophie",
    );
    assert.equal(sophieAlerts.length, 1);
  });

  it("classifies urgency plurals and spelling variants as critical", () => {
    const rubric = demoClientAccount().urgencyRubric;
    for (const issue of [
      "Des étincelles sortent du panneau électrique",
      "etincelle au panneau electrique",
      "odeur de gazs dans la cuisine",
      "fuite de gaz",
    ]) {
      const { classification } = classifyUrgency({
        issueDescription: issue,
        rubric,
      });
      assert.equal(
        classification.requiresHuman,
        true,
        `expected human review for: ${issue}`,
      );
    }
  });

  it("rejects corrupted manual correction types", () => {
    const fakeWorkflow = {
      id: "wf_x",
      clientAccountId: "c",
      callId: "call_x",
      callerE164: "+15145557051",
      status: "awaiting_technician",
      currentStep: "done",
      collected: { language: "fr", photoUrls: [] },
      escalationIndex: 0,
      escalationStage: "primary",
      technicianAlerts: [],
      outcome: "open",
      events: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dedupeKey: "d",
    } as MissedCallWorkflow;
    const lead = createLeadFromWorkflow(fakeWorkflow, "call_x", new Date());
    assert.equal(applyManualCorrection(lead, "finalValue", "not-a-number"), false);
    assert.equal(applyManualCorrection(lead, "becameBooking", "yes"), false);
    assert.equal(applyManualCorrection(lead, "outcome", "booked"), false);
    assert.equal(applyManualCorrection(lead, "finalValue", 1200), true);
    assert.equal(lead.finalValue, 1200);
  });

  it("prohibits production dry-run SMS mode from silently succeeding", async () => {
    const port = createTwilioSmsPort({
      NODE_ENV: "production",
      MISSED_CALL_SMS_MODE: "dry-run",
      TWILIO_ACCOUNT_SID: "",
      TWILIO_AUTH_TOKEN: "",
    });
    await assert.rejects(
      () =>
        port.send({
          toE164: "+15145559999",
          fromE164: "+15145550000",
          body: "hi",
        }),
      /not configured|Twilio/i,
    );
  });

  it("surfaces Twilio send failures to the caller", async () => {
    const failing: SmsPort = {
      async send() {
        throw new Error("Twilio SMS failed: 500 boom");
      },
    };
    const store = createMemoryStore();
    const client = demoClientAccount();
    await store.saveClient(client);
    const now = new Date("2026-07-22T18:00:00.000Z");
    const engine = createMissedCallEngine({
      store,
      sms: failing,
      clock: { now: () => now },
    });
    await assert.rejects(
      () =>
        engine.handleCallEvent({
          clientAccountId: client.id,
          callerE164: "+15145557061",
          answered: false,
          abandoned: false,
          calledAt: now,
        }),
      /Twilio SMS failed/,
    );
  });

  it("validateCollectionAnswer blocks empty required fields and required photo skip", () => {
    const q = {
      id: "name" as const,
      enabled: true,
      required: true,
      promptFr: "Nom?",
      promptEn: "Name?",
    };
    const empty = validateCollectionAnswer({
      step: "name",
      body: " ",
      mediaUrls: [],
      question: q,
      lang: "fr",
    });
    assert.equal(empty.ok, false);

    const photo = validateCollectionAnswer({
      step: "photo",
      body: "NON",
      mediaUrls: [],
      question: {
        id: "photo",
        enabled: true,
        required: true,
        promptFr: "Photo?",
        promptEn: "Photo?",
      },
      lang: "fr",
    });
    assert.equal(photo.ok, false);
  });

  it("covers overnight DST spring-forward morning in America/Toronto", () => {
    // 2026-03-09 was DST start in Toronto; 06:30 UTC = 02:30 EDT after spring forward.
    const client = demoClientAccount({
      timezone: "America/Toronto",
      onCallSchedule: [
        { day: 1, start: "22:00", end: "06:00", technicianId: "tech_sophie" },
      ],
      mainTechnicianId: "tech_marc",
    });
    // Monday 2026-03-09 22:30 EDT = Tuesday 02:30 UTC... use a clear overnight carryover:
    // Tuesday 2026-03-10 02:00 EDT = 2026-03-10T06:00:00.000Z
    const tue0200 = new Date("2026-03-10T06:00:00.000Z");
    assert.equal(resolveOnCallTechnicianId(client, tue0200), "tech_sophie");
    assert.ok(getEscalationChain(client, tue0200).length >= 1);

    // Overnight business hours carryover around DST morning.
    const overnightBiz = demoClientAccount({
      timezone: "America/Toronto",
      businessHours: { start: "22:00", end: "06:00", days: [1] },
    });
    assert.equal(isAfterHours(overnightBiz, tue0200), false);
  });

  it("findOpenAlertForPhone ignores timed-out alerts", () => {
    const wf = {
      technicianAlerts: [
        {
          technicianId: "tech_marc",
          phone: "+15145550199",
          stage: "primary",
          sentAt: "2026-07-22T18:00:00.000Z",
          actionToken: "AAAAAA",
          respondedAt: "2026-07-22T18:05:00.000Z",
          response: "timed_out",
        },
        {
          technicianId: "tech_sophie",
          phone: "+15145550288",
          stage: "backup",
          sentAt: "2026-07-22T18:05:00.000Z",
          actionToken: "BBBBBB",
        },
      ],
    } as MissedCallWorkflow;
    assert.equal(findOpenAlertForPhone(wf, "+15145550199", "AAAAAA"), null);
    assert.ok(findOpenAlertForPhone(wf, "+15145550288", "BBBBBB"));
  });

  it("dry-run port is available only as an explicit non-production adapter", async () => {
    const dry = createDryRunSmsPort();
    const result = await dry.send({
      toE164: "+15145559999",
      fromE164: "+15145550000",
      body: "test",
    });
    assert.match(result.sid, /^SM_dry_/);
  });
});
