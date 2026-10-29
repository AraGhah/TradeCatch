import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  buildReactivationMessage,
  findDormantCustomers,
  isDormantCustomer,
} from "../../src/product/crm/reactivation";
import { runCustomerReactivationCampaign } from "../../src/product/crm/reactivation-service";
import { createMemoryCrmStore } from "../../src/product/crm/memory-store";
import type { Customer } from "../../src/product/crm/types";

const NOW = new Date("2026-06-01T00:00:00.000Z");

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cust_1",
    organizationId: "org_1",
    phoneE164: "+15145551111",
    preferredLanguage: "en",
    allowSms: true,
    allowEmail: true,
    firstContactAt: "2025-01-01T00:00:00.000Z",
    lastContactAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isDormantCustomer / findDormantCustomers", () => {
  it("is dormant once lastContactAt is older than the threshold", () => {
    const dormant = customer({ lastContactAt: "2026-01-01T00:00:00.000Z" }); // ~151 days
    assert.equal(isDormantCustomer(dormant, NOW, 120), true);
  });

  it("is not dormant inside the threshold", () => {
    const fresh = customer({ lastContactAt: "2026-05-20T00:00:00.000Z" });
    assert.equal(isDormantCustomer(fresh, NOW, 120), false);
  });

  it("never flags an opted-out or phoneless customer as dormant", () => {
    const optedOut = customer({ allowSms: false });
    assert.equal(isDormantCustomer(optedOut, NOW, 120), false);
    const noPhone = customer({ phoneE164: "" });
    assert.equal(isDormantCustomer(noPhone, NOW, 120), false);
  });

  it("sorts the most dormant customers first", () => {
    const a = customer({ id: "a", lastContactAt: "2025-10-01T00:00:00.000Z" });
    const b = customer({ id: "b", lastContactAt: "2025-06-01T00:00:00.000Z" });
    const result = findDormantCustomers([a, b], NOW, 120);
    assert.deepEqual(result.map((c) => c.id), ["b", "a"]);
  });
});

describe("buildReactivationMessage", () => {
  it("renders in French for fr-preferring customers, with an opt-out mention", () => {
    const c = customer({ preferredLanguage: "fr", firstName: "Bea" });
    const msg = buildReactivationMessage("Plomberie Nord", c);
    assert.match(msg, /Bonjour Bea/);
    assert.match(msg, /STOP/);
  });

  it("renders in English by default, with an opt-out mention", () => {
    const c = customer({ firstName: "Bea" });
    const msg = buildReactivationMessage("Nord Plumbing", c);
    assert.match(msg, /Hi Bea/);
    assert.match(msg, /STOP/);
  });
});

describe("runCustomerReactivationCampaign", () => {
  it("sends to dormant opted-in customers and marks them contacted", async () => {
    const crmStore = createMemoryCrmStore();
    const dormant = await crmStore.upsertCustomer({
      organizationId: "org_1",
      phoneE164: "+15145551111",
      preferredLanguage: "en",
      firstContactAt: "2025-01-01T00:00:00.000Z",
      lastContactAt: "2026-01-01T00:00:00.000Z",
    });
    const fresh = await crmStore.upsertCustomer({
      organizationId: "org_1",
      phoneE164: "+15145552222",
      preferredLanguage: "en",
      firstContactAt: "2026-05-01T00:00:00.000Z",
      lastContactAt: "2026-05-28T00:00:00.000Z",
    });

    const sent: unknown[] = [];
    const sms = { send: mock.fn(async (m: unknown) => (sent.push(m), { sid: "SM1" })) };

    const result = await runCustomerReactivationCampaign(
      { crmStore, sms: sms as never },
      {
        organizationId: "org_1",
        businessName: "Nord Plumbing",
        fromE164: "+15145559999",
        now: NOW,
        dormantAfterDays: 120,
      },
    );

    assert.equal(result.sent, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.candidates, 1);
    assert.equal(sent.length, 1);
    assert.equal((sent[0] as { toE164: string }).toE164, dormant.phoneE164);

    const updated = await crmStore.getCustomer("org_1", dormant.id);
    assert.equal(updated?.lastContactAt, NOW.toISOString());

    const untouched = await crmStore.getCustomer("org_1", fresh.id);
    assert.equal(untouched?.lastContactAt, "2026-05-28T00:00:00.000Z");
  });

  it("skips customers suppressed at the SMS-provider/cross-module level", async () => {
    const crmStore = createMemoryCrmStore();
    await crmStore.upsertCustomer({
      organizationId: "org_1",
      phoneE164: "+15145551111",
      preferredLanguage: "en",
      firstContactAt: "2025-01-01T00:00:00.000Z",
      lastContactAt: "2026-01-01T00:00:00.000Z",
    });
    const sms = { send: mock.fn(async () => ({ sid: "SM1" })) };

    const result = await runCustomerReactivationCampaign(
      {
        crmStore,
        sms: sms as never,
        isSuppressed: async () => true,
      },
      {
        organizationId: "org_1",
        businessName: "Nord Plumbing",
        fromE164: "+15145559999",
        now: NOW,
        dormantAfterDays: 120,
      },
    );

    assert.equal(result.sent, 0);
    assert.equal(result.skippedSuppressed, 1);
    assert.equal(sms.send.mock.callCount(), 0);
  });

  it("counts a send failure without throwing, leaving lastContactAt unchanged", async () => {
    const crmStore = createMemoryCrmStore();
    const c = await crmStore.upsertCustomer({
      organizationId: "org_1",
      phoneE164: "+15145551111",
      preferredLanguage: "en",
      firstContactAt: "2025-01-01T00:00:00.000Z",
      lastContactAt: "2026-01-01T00:00:00.000Z",
    });
    const sms = {
      send: mock.fn(async () => {
        throw new Error("Twilio down");
      }),
    };

    const result = await runCustomerReactivationCampaign(
      { crmStore, sms: sms as never },
      {
        organizationId: "org_1",
        businessName: "Nord Plumbing",
        fromE164: "+15145559999",
        now: NOW,
        dormantAfterDays: 120,
      },
    );

    assert.equal(result.sent, 0);
    assert.equal(result.failed, 1);
    const unchanged = await crmStore.getCustomer("org_1", c.id);
    assert.equal(unchanged?.lastContactAt, "2026-01-01T00:00:00.000Z");
  });

  it("caps sends per run at maxPerRun", async () => {
    const crmStore = createMemoryCrmStore();
    for (let i = 0; i < 5; i++) {
      await crmStore.upsertCustomer({
        organizationId: "org_1",
        phoneE164: `+1514555${1000 + i}`,
        preferredLanguage: "en",
        firstContactAt: "2025-01-01T00:00:00.000Z",
        lastContactAt: "2026-01-01T00:00:00.000Z",
      });
    }
    const sms = { send: mock.fn(async () => ({ sid: "SM1" })) };
    const result = await runCustomerReactivationCampaign(
      { crmStore, sms: sms as never },
      {
        organizationId: "org_1",
        businessName: "Nord Plumbing",
        fromE164: "+15145559999",
        now: NOW,
        dormantAfterDays: 120,
        maxPerRun: 2,
      },
    );
    assert.equal(result.candidates, 5);
    assert.equal(result.sent, 2);
  });
});
