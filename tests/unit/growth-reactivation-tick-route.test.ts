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
    __tradecatchCrm?: unknown;
  };
  delete g.__tradecatchMissedCall;
  delete g.__tradecatchMissedCallReadStore;
  delete g.__tradecatchSaas;
  delete g.__tradecatchCrm;
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
    "http://localhost/api/growth/reactivation/tick",
    { method: "POST", headers },
  );
}

const auth = {
  authorization: "Bearer test-ops-secret",
  "x-ops-actor": "ops-test",
};

describe("POST /api/growth/reactivation/tick", () => {
  it("refuses unauthenticated requests", async () => {
    const { POST } = await import(
      "../../src/app/api/growth/reactivation/tick/route"
    );
    assert.equal((await POST(request())).status, 401);
  });

  it("sends nothing when no organization has the CUSTOMER_REACTIVATION feature", async () => {
    const { getSaasStore } = await import("../../src/product/saas/runtime");
    const saas = getSaasStore();
    await saas.createOrganizationWithOwner({
      name: "Starter Co",
      ownerEmail: "starter@example.com",
      ownerName: "Owner",
      phoneE164: "+14162010199",
    });

    const { POST } = await import(
      "../../src/app/api/growth/reactivation/tick/route"
    );
    const response = await POST(request(auth));
    const body = (await response.json()) as {
      ok: boolean;
      organizationsProcessed: number;
      sent: number;
    };
    assert.equal(response.status, 200);
    assert.equal(body.organizationsProcessed, 0);
    assert.equal(body.sent, 0);
  });

  it("sends a reactivation text to a dormant customer of a Receptionist-tier org", async () => {
    const { getSaasStore } = await import("../../src/product/saas/runtime");
    const { getMissedCallRuntime } = await import(
      "../../src/product/missed-call/runtime"
    );
    const { getCrmRuntime } = await import("../../src/product/crm/runtime");
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
      id: "client_reactivation",
      smsFromNumber: "+14162010299",
    });
    const mcRuntime = getMissedCallRuntime();
    await mcRuntime.ready;
    await mcRuntime.store.saveClient(client);
    await saas.linkMissedCallClient(organization.id, client.id);

    const crmStore = getCrmRuntime().store;
    await crmStore.upsertCustomer({
      organizationId: organization.id,
      phoneE164: "+15145551234",
      preferredLanguage: "en",
      firstContactAt: "2025-01-01T00:00:00.000Z",
      lastContactAt: "2025-01-01T00:00:00.000Z",
    });

    const { POST } = await import(
      "../../src/app/api/growth/reactivation/tick/route"
    );
    const response = await POST(request(auth));
    const body = (await response.json()) as {
      ok: boolean;
      organizationsProcessed: number;
      sent: number;
    };
    assert.equal(response.status, 200);
    assert.equal(body.organizationsProcessed, 1);
    assert.equal(body.sent, 1);
  });
});
