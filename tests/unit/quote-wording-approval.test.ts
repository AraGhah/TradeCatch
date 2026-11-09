import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryGrowthStore } from "../../src/product/growth/memory-store";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import {
  createMemoryStarterStore,
  createStarterServices,
  DEFAULT_QUOTE_STEPS_MS,
} from "../../src/product/starter";
import { orgSettingsSchema } from "../../src/product/starter/qualification";

async function dueQuote(
  services: ReturnType<typeof createStarterServices>,
  store: ReturnType<typeof createMemoryStarterStore>,
  org = "org_a",
) {
  const thread = await services.ingestQuote({
    organizationId: org,
    customerPhoneE164: "+15145550111",
    customerName: "Sam",
    locale: "en",
    quoteSentAt: new Date(
      Date.now() - DEFAULT_QUOTE_STEPS_MS[0]! - 1000,
    ).toISOString(),
  });
  await store.updateQuoteThread(thread.id, org, {
    nextRunAt: new Date(Date.now() - 1000).toISOString(),
    nextStepIndex: 0,
  });
  return thread;
}

const tickInput = {
  businessNameForOrg: async () => "Nord Plumbing",
  smsFromForOrg: async () => "+15145550999",
};

describe("quote follow-up wording approval", () => {
  it("sends nothing until the owner approves, then sends on the next tick", async () => {
    const store = createMemoryStarterStore();
    const sms = createMemorySmsPort();
    const growth = createMemoryGrowthStore();
    const services = createStarterServices({ store, sms, growth });
    const thread = await dueQuote(services, store);

    const held = await services.processDueQuotes(tickInput);
    assert.equal(held.sent, 0);
    assert.equal(held.awaitingApproval, 1);
    assert.equal(sms.sent.length, 0);
    assert.equal((await store.getQuoteThread(thread.id, "org_a"))?.status, "active");

    await growth.upsertOrgSettings("org_a", {
      quoteFollowUpApprovedAt: new Date().toISOString(),
    });
    const released = await services.processDueQuotes(tickInput);
    assert.equal(released.sent, 1);
    assert.equal(released.awaitingApproval, 0);
    assert.equal(sms.sent.length, 1);
  });

  it("fails closed with no growth store and no approval callback", async () => {
    const store = createMemoryStarterStore();
    const sms = createMemorySmsPort();
    const services = createStarterServices({ store, sms });
    await dueQuote(services, store);
    const result = await services.processDueQuotes(tickInput);
    assert.equal(result.sent, 0);
    assert.equal(result.awaitingApproval, 1);
  });

  it("fails closed when the approval lookup throws", async () => {
    const store = createMemoryStarterStore();
    const sms = createMemorySmsPort();
    const services = createStarterServices({ store, sms });
    await dueQuote(services, store);
    const result = await services.processDueQuotes({
      ...tickInput,
      wordingApprovedForOrg: async () => {
        throw new Error("db down");
      },
    });
    assert.equal(result.sent, 0);
    assert.equal(sms.sent.length, 0);
  });

  it("approval is per organization", async () => {
    const store = createMemoryStarterStore();
    const sms = createMemorySmsPort();
    const growth = createMemoryGrowthStore();
    const services = createStarterServices({ store, sms, growth });
    await dueQuote(services, store, "org_a");
    await dueQuote(services, store, "org_b");
    await growth.upsertOrgSettings("org_a", {
      quoteFollowUpApprovedAt: new Date().toISOString(),
    });
    const result = await services.processDueQuotes(tickInput);
    assert.equal(result.sent, 1);
    assert.equal(result.awaitingApproval, 1);
  });

  it("threads waiting for approval never hide an approved organization's due follow-up", async () => {
    const store = createMemoryStarterStore();
    const sms = createMemorySmsPort();
    const growth = createMemoryGrowthStore();
    const services = createStarterServices({ store, sms, growth });
    // More held threads than one tick looks at, all due earlier than org_a's.
    for (let i = 0; i < 60; i += 1) {
      const held = await dueQuote(services, store, `org_held_${i}`);
      await store.updateQuoteThread(held.id, `org_held_${i}`, {
        nextRunAt: new Date(Date.now() - 3_600_000 - i * 1000).toISOString(),
      });
    }
    await dueQuote(services, store, "org_a");
    await growth.upsertOrgSettings("org_a", {
      quoteFollowUpApprovedAt: new Date().toISOString(),
    });
    const result = await services.processDueQuotes(tickInput);
    assert.equal(result.sent, 1, "the approved organization's follow-up was starved");
    assert.equal(sms.sent.length, 1);
    assert.ok(result.awaitingApproval >= 60);
  });

  it("still sends at most 50 follow-ups in one tick", async () => {
    const store = createMemoryStarterStore();
    const sms = createMemorySmsPort();
    const growth = createMemoryGrowthStore();
    const services = createStarterServices({ store, sms, growth });
    for (let i = 0; i < 55; i += 1) {
      await dueQuote(services, store, `org_ok_${i}`);
      await growth.upsertOrgSettings(`org_ok_${i}`, {
        quoteFollowUpApprovedAt: new Date().toISOString(),
      });
    }
    const first = await services.processDueQuotes(tickInput);
    assert.equal(first.sent, 50);
    const second = await services.processDueQuotes(tickInput);
    assert.equal(second.sent, 5);
  });

  it("withdrawing approval stops further sends", async () => {
    const store = createMemoryStarterStore();
    const sms = createMemorySmsPort();
    const growth = createMemoryGrowthStore();
    const services = createStarterServices({ store, sms, growth });
    await dueQuote(services, store);
    await growth.upsertOrgSettings("org_a", {
      quoteFollowUpApprovedAt: new Date().toISOString(),
    });
    await growth.upsertOrgSettings("org_a", {
      quoteFollowUpApprovedAt: undefined,
    });
    const result = await services.processDueQuotes(tickInput);
    assert.equal(result.sent, 0);
  });

  it("the settings schema accepts the approval flag", () => {
    assert.equal(
      orgSettingsSchema.safeParse({ quoteFollowUpApproved: true }).success,
      true,
    );
    assert.equal(
      orgSettingsSchema.safeParse({ quoteFollowUpApproved: "yes" }).success,
      false,
    );
  });
});
