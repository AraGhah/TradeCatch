import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import { createMemoryGrowthStore, createGrowthServices } from "../../src/product/growth";

describe("service contract renewal reminders", () => {
  it("sends a reminder once the contract enters the reminder window", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });

    const nextRenewalAt = new Date(
      Date.now() + 10 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await store.createServiceContract({
      organizationId: "org_g",
      customerId: "cust_1",
      customerPhoneE164: "+15145550200",
      customerName: "Pat",
      title: "Annual furnace maintenance",
      intervalDays: 365,
      nextRenewalAt,
      reminderDaysBefore: 14,
    });

    const result = await services.processContractRenewalReminders({
      businessNameForOrg: async () => "Nord HVAC",
      smsFromForOrg: async () => "+15145550999",
    });

    assert.equal(result.sent, 1);
    assert.equal(sms.sent.length, 1);
    assert.match(sms.sent[0]!.body, /Annual furnace maintenance/);
    const contracts = await store.listServiceContracts("org_g");
    assert.equal(contracts[0]!.reminderSentForCycle, true);
  });

  it("does not re-send once the reminder has already gone out for this cycle", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });

    const nextRenewalAt = new Date(
      Date.now() + 10 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const contract = await store.createServiceContract({
      organizationId: "org_g",
      customerId: "cust_1",
      customerPhoneE164: "+15145550200",
      title: "HVAC plan",
      intervalDays: 365,
      nextRenewalAt,
      reminderDaysBefore: 14,
    });
    await store.updateServiceContract(contract.id, "org_g", {
      reminderSentForCycle: true,
    });

    const result = await services.processContractRenewalReminders({
      businessNameForOrg: async () => "Nord HVAC",
      smsFromForOrg: async () => "+15145550999",
    });
    assert.equal(result.sent, 0);
    assert.equal(sms.sent.length, 0);
  });

  it("is not yet due outside the reminder window", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });

    const nextRenewalAt = new Date(
      Date.now() + 60 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await store.createServiceContract({
      organizationId: "org_g",
      customerId: "cust_1",
      customerPhoneE164: "+15145550200",
      title: "HVAC plan",
      intervalDays: 365,
      nextRenewalAt,
      reminderDaysBefore: 14,
    });

    const result = await services.processContractRenewalReminders({
      businessNameForOrg: async () => "Nord HVAC",
      smsFromForOrg: async () => "+15145550999",
    });
    assert.equal(result.sent, 0);
  });

  it("skips (without crashing) when the org has no resolvable SMS-from number", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });
    await store.createServiceContract({
      organizationId: "org_g",
      customerId: "cust_1",
      customerPhoneE164: "+15145550200",
      title: "HVAC plan",
      intervalDays: 365,
      nextRenewalAt: new Date().toISOString(),
      reminderDaysBefore: 14,
    });

    const result = await services.processContractRenewalReminders({
      businessNameForOrg: async () => "Nord HVAC",
      smsFromForOrg: async () => null,
    });
    assert.equal(result.sent, 0);
    assert.equal(result.skipped, 1);
  });

  it("does not flag a cancelled contract as due", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });
    const contract = await store.createServiceContract({
      organizationId: "org_g",
      customerId: "cust_1",
      customerPhoneE164: "+15145550200",
      title: "HVAC plan",
      intervalDays: 365,
      nextRenewalAt: new Date().toISOString(),
      reminderDaysBefore: 14,
    });
    await store.updateServiceContract(contract.id, "org_g", {
      status: "cancelled",
    });

    const result = await services.processContractRenewalReminders({
      businessNameForOrg: async () => "Nord HVAC",
      smsFromForOrg: async () => "+15145550999",
    });
    assert.equal(result.sent, 0);
    assert.equal(sms.sent.length, 0);
  });
});

describe("recordContractRenewal", () => {
  it("advances to the next cycle and re-arms the reminder", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });

    const contract = await store.createServiceContract({
      organizationId: "org_g",
      customerId: "cust_1",
      customerPhoneE164: "+15145550200",
      title: "HVAC plan",
      intervalDays: 30,
      nextRenewalAt: new Date().toISOString(),
      reminderDaysBefore: 14,
    });
    await store.updateServiceContract(contract.id, "org_g", {
      reminderSentForCycle: true,
    });

    const renewedAt = new Date("2026-06-01T00:00:00.000Z");
    const updated = await services.recordContractRenewal({
      organizationId: "org_g",
      contractId: contract.id,
      renewedAt,
    });

    assert.equal(updated?.reminderSentForCycle, false);
    assert.equal(updated?.status, "active");
    assert.equal(
      updated?.nextRenewalAt,
      new Date(renewedAt.getTime() + 30 * 86_400_000).toISOString(),
    );
  });

  it("returns null for an unknown contract", async () => {
    const store = createMemoryGrowthStore();
    const sms = createMemorySmsPort();
    const services = createGrowthServices({ store, sms });
    const updated = await services.recordContractRenewal({
      organizationId: "org_g",
      contractId: "contract_missing",
    });
    assert.equal(updated, null);
  });
});
