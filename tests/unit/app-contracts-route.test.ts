import "../support/next-request-context";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { withRequest } from "../support/next-request-context";
import { GET, POST } from "../../src/app/api/app/contracts/route";
import { PATCH } from "../../src/app/api/app/contracts/[id]/route";
import { createMemorySaasStore } from "../../src/product/saas/memory-store";
import type { SaasStore } from "../../src/product/saas/store";
import { signSessionClaims } from "../../src/product/saas/auth/session-token";

const names = ["AUTH_SECRET", "NODE_ENV"];
const saved = new Map(names.map((name) => [name, process.env[name]]));
const runtime = globalThis as typeof globalThis & {
  __tradecatchSaas?: { store: SaasStore; durable: boolean };
  __tradecatchGrowth?: unknown;
  __tradecatchCrm?: unknown;
};
let store: SaasStore;

beforeEach(() => {
  names.forEach((name) => delete process.env[name]);
  Object.assign(process.env, {
    AUTH_SECRET: "tc010-unit-secret-not-for-production",
  });
  (process.env as { NODE_ENV?: string }).NODE_ENV = "development";
  store = createMemorySaasStore();
  runtime.__tradecatchSaas = { store, durable: false };
  delete runtime.__tradecatchGrowth;
  delete runtime.__tradecatchCrm;
  mock.method(console, "warn", () => {});
});

afterEach(() => {
  mock.restoreAll();
  delete runtime.__tradecatchSaas;
  delete runtime.__tradecatchGrowth;
  delete runtime.__tradecatchCrm;
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function fixture(
  plan: "starter" | "growth" | "receptionist",
  role: "owner" | "admin" | "member" | "viewer" = "owner",
) {
  const f = await store.createOrganizationWithOwner({
    name: "Contracts fixture",
    ownerName: "Owner",
    ownerEmail: crypto.randomUUID() + "@example.test",
  });
  await store.updateOrganizationPlan(f.organization.id, plan);
  await store.setMembershipRole(f.organization.id, f.user.id, role);
  const session = {
    id: crypto.randomUUID(),
    organizationId: f.organization.id,
    userId: f.user.id,
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    createdAt: new Date().toISOString(),
  };
  await store.createSession(session);
  const cookie = await signSessionClaims(
    {
      sid: session.id,
      uid: f.user.id,
      oid: f.organization.id,
      plan,
      exp: Math.floor(Date.now() / 1000) + 600,
    },
    process.env.AUTH_SECRET!,
  );
  return { ...f, session, cookie: "tc_session=" + cookie };
}

function request(
  method: string,
  cookie: string,
  body?: unknown,
  url = "https://tradecatch.test/api/app/contracts",
) {
  return new NextRequest(url, {
    method,
    headers: {
      cookie,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("GET/POST /api/app/contracts", () => {
  it("rejects a plan without CONTRACT_RENEWAL_AUTOMATION", async () => {
    const f = await fixture("growth");
    const response = await withRequest(request("GET", f.cookie), () => GET());
    assert.ok(response);
    assert.equal(response.status, 402);
  });

  it("creates a contract for a known CRM customer on a Receptionist-tier org", async () => {
    const f = await fixture("receptionist");
    const { getCrmRuntime } = await import("../../src/product/crm/runtime");
    const customer = await getCrmRuntime().store.upsertCustomer({
      organizationId: f.organization.id,
      phoneE164: "+15145551111",
      preferredLanguage: "en",
      firstContactAt: new Date().toISOString(),
      lastContactAt: new Date().toISOString(),
    });

    const postReq = request("POST", f.cookie, {
      customerId: customer.id,
      title: "Annual furnace maintenance",
      intervalDays: 365,
      nextRenewalAt: new Date(
        Date.now() + 300 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    });
    const response = await withRequest(postReq, () => POST(postReq));
    assert.ok(response);
    assert.equal(response.status, 201);
    const body = (await response.json()) as { contract: { id: string } };
    assert.ok(body.contract.id);

    const listResponse = await withRequest(request("GET", f.cookie), () =>
      GET(),
    );
    assert.ok(listResponse);
    const listBody = (await listResponse.json()) as { contracts: unknown[] };
    assert.equal(listBody.contracts.length, 1);
  });

  it("404s when the customer does not belong to this organization", async () => {
    const f = await fixture("receptionist");
    const req = request("POST", f.cookie, {
      customerId: "cust_missing",
      title: "HVAC plan",
      intervalDays: 365,
      nextRenewalAt: new Date().toISOString(),
    });
    const response = await withRequest(req, () => POST(req));
    assert.ok(response);
    assert.equal(response.status, 404);
  });

  it("denies members and viewers from creating contracts", async () => {
    for (const role of ["member", "viewer"] as const) {
      const f = await fixture("receptionist", role);
      const req = request("POST", f.cookie, {
        customerId: "cust_x",
        title: "HVAC plan",
        intervalDays: 365,
        nextRenewalAt: new Date().toISOString(),
      });
      const response = await withRequest(req, () => POST(req));
      assert.ok(response);
      assert.equal(response.status, 403);
    }
  });

  it("rejects an invalid intervalDays or nextRenewalAt", async () => {
    const f = await fixture("receptionist");
    const { getCrmRuntime } = await import("../../src/product/crm/runtime");
    const customer = await getCrmRuntime().store.upsertCustomer({
      organizationId: f.organization.id,
      phoneE164: "+15145551111",
      preferredLanguage: "en",
      firstContactAt: new Date().toISOString(),
      lastContactAt: new Date().toISOString(),
    });
    const req1 = request("POST", f.cookie, {
      customerId: customer.id,
      title: "HVAC plan",
      intervalDays: -5,
      nextRenewalAt: new Date().toISOString(),
    });
    const bad1 = await withRequest(req1, () => POST(req1));
    assert.ok(bad1);
    assert.equal(bad1.status, 400);
    const req2 = request("POST", f.cookie, {
      customerId: customer.id,
      title: "HVAC plan",
      intervalDays: 30,
      nextRenewalAt: "not-a-date",
    });
    const bad2 = await withRequest(req2, () => POST(req2));
    assert.ok(bad2);
    assert.equal(bad2.status, 400);
  });
});

describe("PATCH /api/app/contracts/[id]", () => {
  async function patch(
    cookie: string,
    id: string,
    body: unknown,
  ) {
    const req = request(
      "PATCH",
      cookie,
      body,
      `https://tradecatch.test/api/app/contracts/${id}`,
    );
    return withRequest(req, () =>
      PATCH(req, { params: Promise.resolve({ id }) }),
    );
  }

  it("advances the cycle on renew", async () => {
    const f = await fixture("receptionist");
    const { getGrowthStore } = await import("../../src/product/growth");
    const contract = await getGrowthStore().createServiceContract({
      organizationId: f.organization.id,
      customerId: "cust_1",
      customerPhoneE164: "+15145551111",
      title: "HVAC plan",
      intervalDays: 30,
      nextRenewalAt: new Date().toISOString(),
      reminderDaysBefore: 14,
    });

    const response = await patch(f.cookie, contract.id, { action: "renew" });
    assert.ok(response);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      contract: { reminderSentForCycle: boolean; status: string };
    };
    assert.equal(body.contract.reminderSentForCycle, false);
    assert.equal(body.contract.status, "active");
  });

  it("cancels a contract", async () => {
    const f = await fixture("receptionist");
    const { getGrowthStore } = await import("../../src/product/growth");
    const contract = await getGrowthStore().createServiceContract({
      organizationId: f.organization.id,
      customerId: "cust_1",
      customerPhoneE164: "+15145551111",
      title: "HVAC plan",
      intervalDays: 30,
      nextRenewalAt: new Date().toISOString(),
      reminderDaysBefore: 14,
    });

    const response = await patch(f.cookie, contract.id, { action: "cancel" });
    assert.ok(response);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { contract: { status: string } };
    assert.equal(body.contract.status, "cancelled");
  });

  it("404s for a contract belonging to a different organization", async () => {
    const f = await fixture("receptionist");
    const other = await fixture("receptionist");
    const { getGrowthStore } = await import("../../src/product/growth");
    const contract = await getGrowthStore().createServiceContract({
      organizationId: other.organization.id,
      customerId: "cust_1",
      customerPhoneE164: "+15145551111",
      title: "HVAC plan",
      intervalDays: 30,
      nextRenewalAt: new Date().toISOString(),
      reminderDaysBefore: 14,
    });

    const response = await patch(f.cookie, contract.id, { action: "renew" });
    assert.ok(response);
    assert.equal(response.status, 404);
  });

  it("rejects an unknown action", async () => {
    const f = await fixture("receptionist");
    const { getGrowthStore } = await import("../../src/product/growth");
    const contract = await getGrowthStore().createServiceContract({
      organizationId: f.organization.id,
      customerId: "cust_1",
      customerPhoneE164: "+15145551111",
      title: "HVAC plan",
      intervalDays: 30,
      nextRenewalAt: new Date().toISOString(),
      reminderDaysBefore: 14,
    });
    const response = await patch(f.cookie, contract.id, { action: "nope" });
    assert.ok(response);
    assert.equal(response.status, 400);
  });
});
