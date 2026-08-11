import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import {
  createMemoryStarterStore,
  createStarterServices,
  DEFAULT_QUOTE_STEPS_MS,
} from "../../src/product/starter";

describe("starter website leads", () => {
  it("is idempotent on the same key and does not double-SMS", async () => {
    const store = createMemoryStarterStore();
    const sms = createMemorySmsPort();
    const services = createStarterServices({ store, sms });

    const first = await services.ingestWebsiteLead({
      organizationId: "org_a",
      businessName: "Nord Plumbing",
      phoneE164: "+15145550101",
      name: "Alex",
      idempotencyKey: "form_abc",
      smsFromE164: "+15145550999",
      sendOpeningSms: true,
    });
    assert.equal(first.smsSent, true);
    assert.equal(first.duplicate, false);

    const second = await services.ingestWebsiteLead({
      organizationId: "org_a",
      businessName: "Nord Plumbing",
      phoneE164: "+15145550101",
      name: "Alex",
      idempotencyKey: "form_abc",
      smsFromE164: "+15145550999",
      sendOpeningSms: true,
    });
    assert.equal(second.duplicate, true);
    assert.equal(second.lead.id, first.lead.id);
    assert.equal(sms.sent.length, 1);

    const otherOrg = await services.ingestWebsiteLead({
      organizationId: "org_b",
      businessName: "Other Co",
      phoneE164: "+15145550101",
      idempotencyKey: "form_abc",
      smsFromE164: "+15145550888",
      sendOpeningSms: true,
    });
    assert.notEqual(otherOrg.lead.id, first.lead.id);
    assert.equal(
      (await store.listWebsiteLeads("org_a")).length,
      1,
    );
    assert.equal(
      (await store.listWebsiteLeads("org_b")).length,
      1,
    );
  });
});

describe("starter quote follow-up", () => {
  it("stops the sequence on customer reply and opens inbox", async () => {
    const store = createMemoryStarterStore();
    const sms = createMemorySmsPort();
    const services = createStarterServices({ store, sms });

    const thread = await services.ingestQuote({
      organizationId: "org_a",
      customerPhoneE164: "+15145550111",
      customerName: "Sam",
      quoteRef: "Q-42",
      locale: "en",
      quoteSentAt: new Date(
        Date.now() - DEFAULT_QUOTE_STEPS_MS[0]! - 1000,
      ).toISOString(),
    });
    assert.equal(thread.status, "active");

    // Force due for first step
    await store.updateQuoteThread(thread.id, "org_a", {
      nextRunAt: new Date(Date.now() - 1000).toISOString(),
      nextStepIndex: 0,
    });

    const tick = await services.processDueQuotes({
      businessNameForOrg: async () => "Nord Plumbing",
      smsFromForOrg: async () => "+15145550999",
    });
    assert.equal(tick.sent, 1);
    assert.equal(sms.sent.length, 1);

    const reply = await services.handleInboundSms({
      organizationId: "org_a",
      fromE164: "+15145550111",
      toE164: "+15145550999",
      body: "Can we talk tomorrow?",
    });
    assert.equal(reply.stoppedQuote, true);

    const after = await store.getQuoteThread(thread.id, "org_a");
    assert.equal(after?.status, "stopped");
    assert.equal(after?.stopReason, "customer_reply");

    const inbox = await store.listInbox("org_a");
    assert.ok(inbox.some((i) => i.kind === "quote" && i.refId === thread.id));

    // Further ticks must not spam
    await store.updateQuoteThread(thread.id, "org_a", {
      status: "stopped",
      nextRunAt: new Date(Date.now() - 1000).toISOString(),
    });
    const tick2 = await services.processDueQuotes({
      businessNameForOrg: async () => "Nord Plumbing",
      smsFromForOrg: async () => "+15145550999",
    });
    assert.equal(tick2.sent, 0);
  });

  it("stops on opt-out keywords", async () => {
    const store = createMemoryStarterStore();
    const sms = createMemorySmsPort();
    const services = createStarterServices({ store, sms });

    const thread = await services.ingestQuote({
      organizationId: "org_a",
      customerPhoneE164: "+15145550112",
    });

    const result = await services.handleInboundSms({
      organizationId: "org_a",
      fromE164: "+15145550112",
      toE164: "+15145550999",
      body: "STOP",
    });
    assert.equal(result.stoppedQuote, true);
    const after = await store.getQuoteThread(thread.id, "org_a");
    assert.equal(after?.stopReason, "opt_out");
  });

  it("isolates quote threads by organization", async () => {
    const store = createMemoryStarterStore();
    const sms = createMemorySmsPort();
    const services = createStarterServices({ store, sms });

    await services.ingestQuote({
      organizationId: "org_a",
      customerPhoneE164: "+15145550113",
    });
    await services.ingestQuote({
      organizationId: "org_b",
      customerPhoneE164: "+15145550113",
    });

    assert.equal((await store.listQuoteThreads("org_a")).length, 1);
    assert.equal((await store.listQuoteThreads("org_b")).length, 1);

    await services.handleInboundSms({
      organizationId: "org_a",
      fromE164: "+15145550113",
      toE164: "+1",
      body: "thanks",
    });

    const a = (await store.listQuoteThreads("org_a"))[0]!;
    const b = (await store.listQuoteThreads("org_b"))[0]!;
    assert.equal(a.status, "stopped");
    assert.equal(b.status, "active");
  });
});

describe("starter human takeover inbox", () => {
  it("pauses quote automation on takeover", async () => {
    const store = createMemoryStarterStore();
    const sms = createMemorySmsPort();
    const services = createStarterServices({ store, sms });

    const thread = await services.ingestQuote({
      organizationId: "org_a",
      customerPhoneE164: "+15145550114",
    });

    await services.setHumanTakeover({
      organizationId: "org_a",
      kind: "quote",
      refId: thread.id,
      title: "Sam",
      reason: "Owner calling",
    });

    const after = await store.getQuoteThread(thread.id, "org_a");
    assert.equal(after?.conversationMode, "human");
    assert.equal(after?.status, "paused");
    assert.equal(after?.nextRunAt, undefined);

    const inbox = await store.listInbox("org_a");
    assert.equal(inbox[0]?.status, "claimed");
  });

  it("keeps inbox items tenant-isolated", async () => {
    const store = createMemoryStarterStore();
    await store.upsertInboxItem({
      organizationId: "org_a",
      kind: "website_lead",
      refId: "w1",
      title: "A",
      reason: "new",
    });
    await store.upsertInboxItem({
      organizationId: "org_b",
      kind: "website_lead",
      refId: "w2",
      title: "B",
      reason: "new",
    });
    assert.equal((await store.listInbox("org_a")).length, 1);
    assert.equal((await store.listInbox("org_a"))[0]?.title, "A");
    assert.equal((await store.getInboxItem(
      (await store.listInbox("org_b"))[0]!.id,
      "org_a",
    )), null);
  });
});
