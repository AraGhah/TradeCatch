import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import { createAutomationService, nextDeliveryStatus } from "../../src/product/sms-automation/service";
import { createMemoryAutomationStore } from "../../src/product/sms-automation/store";
import { renderTemplate, validateTemplate } from "../../src/product/sms-automation/templates";
import type { OrgSnapshot } from "../../src/product/sms-automation/service";
import { isInsideSendingWindow, nextWindowStart, zonedParts } from "../../src/product/sms-automation/window";

const org: OrgSnapshot = {
  id: "org_demo",
  name: "Montreal Plumbing Pro",
  status: "active",
  timezone: "America/Toronto",
  localeDefault: "en",
  phoneE164: "+15145551000",
  accountType: "live",
};

function harness(options?: { fail?: "timeout" | "retry" | "none"; orgStatus?: string }) {
  const sms = createMemorySmsPort();
  let sends = 0;
  let now = new Date("2026-01-21T15:00:00.000Z"); // Wednesday 10:00 EST
  const service = createAutomationService({
    store: createMemoryAutomationStore(),
    sms: {
      async send(message) {
        sends += 1;
        if (options?.fail === "timeout") {
          throw new Error("The operation was aborted due to timeout");
        }
        if (options?.fail === "retry" && sends === 1) {
          throw new Error("Twilio SMS failed: 503 upstream");
        }
        return sms.send(message);
      },
    },
    now: () => now,
    smsMode: "dry-run",
    async loadOrg() {
      return { ...org, status: options?.orgStatus ?? org.status };
    },
    async smsFrom() {
      return "+15145550000";
    },
  });
  return {
    service,
    sms,
    sends: () => sends,
    setNow(value: Date) {
      now = value;
    },
  };
}

describe("sms automation templates and windows", () => {
  it("rejects a template that drops the business name or STOP line", () => {
    assert.ok(validateTemplate("Hello there", "en").includes("missing_business_identification"));
    assert.ok(
      validateTemplate("Hi, this is {{business_name}}.", "en").includes("missing_opt_out"),
    );
    assert.deepEqual(
      validateTemplate(
        "Hi, this is {{business_name}}. Reply STOP to opt out.",
        "en",
      ),
      [],
    );
  });

  it("renders variables and keeps the business identity", () => {
    const rendered = renderTemplate({
      body: "Hi {{customer_name}}, this is {{business_name}}. We're following up regarding your {{service_name}} request. Reply STOP to opt out.",
      locale: "en",
      vars: {
        customer_name: "John",
        service_name: "water heater repair",
      },
      businessName: "Montreal Plumbing Pro",
    });
    assert.match(rendered.body, /Montreal Plumbing Pro/);
    assert.match(rendered.body, /John/);
    assert.match(rendered.body, /water heater repair/);
    assert.equal(rendered.missing.length, 0);
  });

  it("respects the contractor timezone across daylight saving", () => {
    const config = { windowStartHour: 8, windowEndHour: 20, weekendSending: true };
    const before = new Date("2026-03-08T06:30:00.000Z");
    assert.equal(isInsideSendingWindow(before, "America/Toronto", config), false);
    const open = nextWindowStart(before, "America/Toronto", config);
    const parts = zonedParts(open, "America/Toronto");
    assert.ok(parts.hour >= 8 && parts.hour < 20);
    assert.equal(parts.weekday, 0);
  });
});

describe("missed-call recovery automation", () => {
  it("does not take over while the automation is disabled", async () => {
    const { service } = harness();
    await service.ensureDefaults(org.id);
    const result = await service.scheduleMissedCall({
      organizationId: org.id,
      callId: "call_1",
      callerE164: "+15145550100",
      disposition: "missed",
    });
    assert.equal(result.deferred, false);
    assert.equal(result.scheduled, false);
  });

  it("schedules one simulated recovery and never calls the SMS provider", async () => {
    const { service, sends } = harness();
    const [automation] = await service.ensureDefaults(org.id);
    const missed = (await service.list(org.id)).find((row) => row.type === "missed_call_recovery")!;
    await service.activate(org.id, missed.id);
    const first = await service.simulateMissedCall({
      organizationId: org.id,
      phoneE164: "+15145550100",
      customerName: "Alex Martin",
      language: "en",
    });
    assert.equal(first.scheduled, true);
    assert.equal(first.job?.simulated, true);
    const duplicate = await service.scheduleMissedCall({
      organizationId: org.id,
      callId: first.job?.payload.callId || "missing",
      callerE164: "+15145550100",
      disposition: "missed",
      simulated: true,
    });
    assert.equal(duplicate.reason, "duplicate");
    const ran = await service.runNextSimulated(org.id);
    assert.equal(ran.job?.status, "submitted");
    assert.match(ran.job?.payload.renderedBody || "", /Montreal Plumbing Pro/);
    assert.match(ran.job?.providerMessageSid || "", /^SIM_/);
    assert.equal(sends(), 0);
    assert.equal(automation?.type, "missed_call_recovery");
  });

  it("does not schedule recovery for an answered call", async () => {
    const { service } = harness();
    const missed = (await service.list(org.id)).find((row) => row.type === "missed_call_recovery")!;
    await service.activate(org.id, missed.id);
    const result = await service.scheduleMissedCall({
      organizationId: org.id,
      callId: "call_answered",
      callerE164: "+15145550100",
      disposition: "answered",
    });
    assert.equal(result.scheduled, false);
    assert.equal(result.reason, "call_handled");
  });

  it("cancels a pending recovery when the automation is disabled", async () => {
    const { service, sends } = harness();
    const missed = (await service.list(org.id)).find((row) => row.type === "missed_call_recovery")!;
    await service.activate(org.id, missed.id);
    await service.simulateMissedCall({
      organizationId: org.id,
      phoneE164: "+15145550101",
      customerName: "Sam",
    });
    const stopped = await service.deactivate(org.id, missed.id);
    assert.ok(stopped.canceled >= 1);
    const ran = await service.processDue({ organizationId: org.id });
    assert.equal(ran.processed, 0);
    assert.equal(sends(), 0);
  });

  it("records STOP and blocks the next message", async () => {
    const { service, sends } = harness();
    const missed = (await service.list(org.id)).find((row) => row.type === "missed_call_recovery")!;
    await service.activate(org.id, missed.id);
    await service.simulateMissedCall({
      organizationId: org.id,
      phoneE164: "+15145550102",
      customerName: "Riley",
    });
    await service.runNextSimulated(org.id);
    const reply = await service.applyInbound({
      organizationId: org.id,
      fromE164: "+15145550102",
      body: "STOP",
      messageSid: "SM_stop_1",
      simulated: true,
    });
    assert.equal(reply.optedOut, true);
    const again = await service.applyInbound({
      organizationId: org.id,
      fromE164: "+15145550102",
      body: "STOP",
      messageSid: "SM_stop_1",
      simulated: true,
    });
    assert.equal(again.duplicate, true);
    const next = await service.scheduleMissedCall({
      organizationId: org.id,
      callId: "call_after_stop",
      callerE164: "+15145550102",
      disposition: "missed",
      simulated: true,
    });
    assert.equal(next.scheduled, false);
    assert.equal(next.reason, "ineligible");
    assert.equal(sends(), 0);
  });
});

describe("quote follow-up automation", () => {
  it("cancels the next reminder when the quote is accepted", async () => {
    const { service, sends } = harness();
    const quote = (await service.list(org.id)).find((row) => row.type === "quote_followup")!;
    await service.activate(org.id, quote.id);
    const created = await service.simulateQuote({
      organizationId: org.id,
      phoneE164: "+15145550103",
      customerName: "John Smith",
      quoteRef: "Q-1200",
      locale: "en",
      serviceName: "water heater repair",
    });
    assert.equal(created.jobs.length, 2);
    const threadId = created.jobs[0]!.payload.quoteThreadId!;
    await service.runNextSimulated(org.id);
    await service.setQuoteOutcome(org.id, threadId, "accepted");
    const second = await service.runNextSimulated(org.id);
    assert.equal(second.job, null);
    const history = await service.history(org.id);
    assert.equal(history.some((row) => row.cancelReason === "quote_accepted"), true);
    assert.equal(sends(), 0);
  });

  it("pauses remaining reminders when the customer replies, without accepting the quote", async () => {
    const { service } = harness();
    const quote = (await service.list(org.id)).find((row) => row.type === "quote_followup")!;
    await service.activate(org.id, quote.id);
    await service.simulateQuote({
      organizationId: org.id,
      phoneE164: "+15145550104",
      customerName: "John Smith",
      locale: "en",
    });
    await service.runNextSimulated(org.id);
    const reply = await service.applyInbound({
      organizationId: org.id,
      fromE164: "+15145550104",
      body: "Thanks, I've decided to proceed.",
      messageSid: "SM_reply_1",
      simulated: true,
    });
    assert.equal(reply.optedOut, false);
    assert.ok(reply.paused >= 1);
    const next = await service.runNextSimulated(org.id);
    assert.equal(next.job, null);
    const history = await service.history(org.id);
    assert.equal(history.some((row) => row.status === "submitted"), true);
    assert.equal(history.some((row) => row.responseStatus === "replied"), true);
    assert.equal(history.some((row) => row.cancelReason === "quote_accepted"), false);
  });
});

describe("delivery and retries", () => {
  it("ignores an older sent callback after delivered", () => {
    assert.equal(nextDeliveryStatus("delivered", "sent"), null);
    assert.equal(nextDeliveryStatus("submitted", "delivered"), "delivered");
    assert.equal(nextDeliveryStatus("sent", "undelivered"), "undelivered");
  });

  it("does not retry an uncertain provider timeout", async () => {
    const { service, sends } = harness({ fail: "timeout" });
    const missed = (await service.list(org.id)).find((row) => row.type === "missed_call_recovery")!;
    await service.update(org.id, missed.id, { initialDelayMinutes: 0 });
    await service.activate(org.id, missed.id);
    await service.scheduleMissedCall({
      organizationId: org.id,
      callId: "call_timeout",
      callerE164: "+15145550105",
      disposition: "missed",
      simulated: false,
    });
    const first = await service.processDue({ organizationId: org.id });
    assert.equal(first.jobs[0]?.status, "uncertain");
    const second = await service.processDue({ organizationId: org.id });
    assert.equal(second.processed, 0);
    assert.equal(sends(), 1);
  });

  it("retries a temporary provider failure once, then sends", async () => {
    const { service, sends, setNow } = harness({ fail: "retry" });
    const missed = (await service.list(org.id)).find((row) => row.type === "missed_call_recovery")!;
    await service.update(org.id, missed.id, { initialDelayMinutes: 0 });
    await service.activate(org.id, missed.id);
    await service.scheduleMissedCall({
      organizationId: org.id,
      callId: "call_retry",
      callerE164: "+15145550106",
      disposition: "missed",
      simulated: false,
    });
    const first = await service.processDue({ organizationId: org.id });
    assert.equal(first.jobs[0]?.status, "pending");
    setNow(new Date("2026-01-21T15:10:00.000Z"));
    const second = await service.processDue({ organizationId: org.id });
    assert.equal(second.jobs[0]?.status, "submitted");
    assert.equal(sends(), 2);
    const listed = await service.listJobs("org_other");
    assert.equal(listed.length, 0);
  });
});
