import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";

const managed = [
  "NODE_ENV",
  "TRADECATCH_ENV",
  "DATABASE_URL",
  "MISSED_CALL_DURABLE_STORE",
  "SAAS_DURABLE_STORE",
  "MISSED_CALL_OPS_SECRET",
  "CRON_SECRET",
];
const original = new Map(managed.map((key) => [key, process.env[key]]));

function resetGlobals() {
  const g = globalThis as unknown as {
    __tradecatchMissedCall?: unknown;
    __tradecatchMissedCallReadStore?: unknown;
    __tradecatchSaas?: unknown;
    __tradecatchGrowth?: unknown;
  };
  delete g.__tradecatchMissedCall;
  delete g.__tradecatchMissedCallReadStore;
  delete g.__tradecatchSaas;
  delete g.__tradecatchGrowth;
}

beforeEach(() => {
  managed.forEach((key) => delete process.env[key]);
  Object.assign(process.env, {
    NODE_ENV: "development",
    MISSED_CALL_OPS_SECRET: "test-ops-secret",
  });
  resetGlobals();
  mock.method(console, "warn", () => {});
  mock.method(console, "info", () => {});
  mock.method(console, "error", () => {});
});

afterEach(() => {
  mock.restoreAll();
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetGlobals();
});

function request(headers: Record<string, string> = {}) {
  return new NextRequest(
    "http://localhost/api/growth/contract-renewals/tick",
    { method: "POST", headers },
  );
}

const auth = {
  authorization: "Bearer test-ops-secret",
  "x-ops-actor": "ops-test",
};

describe("POST /api/growth/contract-renewals/tick", () => {
  it("refuses unauthenticated requests", async () => {
    const { POST } = await import(
      "../../src/app/api/growth/contract-renewals/tick/route"
    );
    assert.equal((await POST(request())).status, 401);
  });

  it("sends a reminder for a contract due within its window, resolving the org's SMS-from number", async () => {
    const { getSaasStore } = await import("../../src/product/saas/runtime");
    const { getMissedCallRuntime } = await import(
      "../../src/product/missed-call/runtime"
    );
    const { getGrowthStore } = await import("../../src/product/growth");
    const { demoClientAccount } = await import(
      "../../src/product/missed-call/fixtures"
    );

    const saas = getSaasStore();
    const { organization } = await saas.createOrganizationWithOwner({
      name: "Pro Plumbing",
      ownerEmail: "pro@example.com",
      ownerName: "Owner",
      phoneE164: "+14162010299",
    });
    await saas.updateOrganizationPlan(organization.id, "receptionist");

    const client = demoClientAccount({
      id: "client_contracts",
      smsFromNumber: "+14162010299",
    });
    const mcRuntime = getMissedCallRuntime();
    await mcRuntime.ready;
    await mcRuntime.store.saveClient(client);
    await saas.linkMissedCallClient(organization.id, client.id);

    await getGrowthStore().createServiceContract({
      organizationId: organization.id,
      customerId: "cust_1",
      customerPhoneE164: "+15145551234",
      customerName: "Bea",
      title: "Annual furnace maintenance",
      intervalDays: 365,
      nextRenewalAt: new Date(
        Date.now() + 10 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      reminderDaysBefore: 14,
    });

    const { POST } = await import(
      "../../src/app/api/growth/contract-renewals/tick/route"
    );
    const response = await POST(request(auth));
    const body = (await response.json()) as { ok: boolean; sent: number };
    assert.equal(response.status, 200);
    assert.equal(body.sent, 1);
  });
});
