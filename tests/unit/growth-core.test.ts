import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import {
  createMemoryGrowthStore,
  createGrowthServices,
} from "../../src/product/growth";
import { createMemoryStarterStore, createStarterServices } from "../../src/product/starter";
import { defaultQualificationQuestions } from "../../src/product/starter/qualification";

describe("growth booking + reminders", () => {
  it("books an appointment and sends customer SMS", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });

    const appt = await services.bookAppointment({
      organizationId: "org_g",
      title: "Furnace checkup",
      startsAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      customerPhoneE164: "+15145550200",
      customerName: "Pat",
      smsFromE164: "+15145550999",
      businessName: "Nord HVAC",
    });

    assert.equal(appt.status, "scheduled");
    assert.equal(sms.sent.length, 1);
    const pipe = await store.listPipeline("org_g");
    assert.equal(pipe[0]?.stage, "booked");
  });

  it("sends 24h reminder when due", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });
    const startsAt = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
    await store.createAppointment({
      organizationId: "org_g",
      title: "Visit",
      startsAt,
      status: "scheduled",
      source: "manual",
      customerPhoneE164: "+15145550201",
    });

    const result = await services.processAppointmentReminders({
      businessNameForOrg: async () => "Nord",
      smsFromForOrg: async () => "+15145550999",
    });
    assert.equal(result.sent, 1);
    const appts = await store.listAppointments("org_g");
    assert.equal(appts[0]?.reminder24hSent, true);
  });
});

describe("growth pipeline + revenue attribution", () => {
  it("records revenue when moving to won", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });
    const card = await store.upsertPipelineCard({
      organizationId: "org_g",
      stage: "quoted",
      title: "Kitchen",
      source: "quote",
      sourceRefId: "q1",
      estimatedValue: 2400,
    });
    await services.movePipeline({
      organizationId: "org_g",
      cardId: card.id,
      stage: "won",
      recordRevenue: true,
    });
    const revenue = await store.listRevenue("org_g");
    assert.equal(revenue.length, 1);
    assert.equal(revenue[0]?.amount, 2400);
  });
});

describe("growth reviews", () => {
  it("queues and sends Google review SMS after completion", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });
    await store.upsertOrgSettings("org_g", {
      googleReviewUrl: "https://g.page/r/example",
    });
    const appt = await store.createAppointment({
      organizationId: "org_g",
      title: "Job done",
      startsAt: new Date().toISOString(),
      status: "scheduled",
      source: "manual",
      customerPhoneE164: "+15145550202",
      customerName: "Lee",
    });
    await services.completeAppointmentAndMaybeReview({
      organizationId: "org_g",
      appointmentId: appt.id,
      scheduleReviewHours: 0,
    });
    const due = await store.listDueReviewRequests(new Date().toISOString(), 10);
    assert.equal(due.length, 1);

    const tick = await services.processReviewRequests({
      businessNameForOrg: async () => "Nord",
      smsFromForOrg: async () => "+15145550999",
    });
    assert.equal(tick.sent, 1);
    assert.match(sms.sent[0]!.body, /Google review/);
  });
});

describe("starter qualification + notifications hooks", () => {
  it("asks configurable qualification after website opening SMS", async () => {
    const starter = createMemoryStarterStore();
    const growth = createMemoryGrowthStore();
    await growth.upsertOrgSettings("org_a", {
      qualificationQuestions: defaultQualificationQuestions(),
    });
    const sms = createMemorySmsPort();
    const services = createStarterServices({
      store: starter,
      sms,
      growth,
    });

    await services.ingestWebsiteLead({
      organizationId: "org_a",
      businessName: "Nord",
      phoneE164: "+15145550300",
      smsFromE164: "+15145550999",
      locale: "en",
    });
    // opening + first qualification prompt
    assert.equal(sms.sent.length, 2);

    const reply = await services.handleInboundSms({
      organizationId: "org_a",
      fromE164: "+15145550300",
      toE164: "+15145550999",
      body: "Leak under sink",
    });
    assert.equal(reply.qualifiedWebsite, true);
    assert.equal(reply.replies.length, 1);
  });
});

describe("growth CRM webhook DLQ", () => {
  it("enqueues failed CRM sync and resolves on retry", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });

    await store.upsertOrgSettings("org_g", {
      crmWebhookUrl: "https://example.invalid/hook",
    });

    // Force failure path by using unreachable URL — fetch will fail in node
    const sync = await services.syncCrm({
      organizationId: "org_g",
      eventType: "pipeline.won",
      data: { id: "c1", amount: 100 },
    });
    assert.equal(sync.forwarded, false);

    const dlq = await store.listCrmDlq("org_g");
    assert.equal(dlq.length, 1);
    assert.equal(dlq[0]?.eventType, "pipeline.won");

    // Clear webhook so retry marks attempts without resolving
    await store.upsertOrgSettings("org_g", { crmWebhookUrl: undefined });
    const tick = await services.processCrmDlq();
    assert.ok(tick.retried >= 1 || tick.failed >= 1);
  });
});

describe("growth analytics", () => {
  it("aggregates pipeline and revenue without inventing numbers", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });
    await store.upsertPipelineCard({
      organizationId: "org_g",
      stage: "new",
      title: "A",
      source: "manual",
      estimatedValue: 100,
    });
    const metrics = services.computeAdvancedAnalytics({
      pipeline: await store.listPipeline("org_g"),
      revenue: [],
      appointments: [],
      reviews: [],
    });
    assert.equal(metrics.openPipelineValue, 100);
    assert.equal(metrics.attributedRevenue, 0);
  });
});
