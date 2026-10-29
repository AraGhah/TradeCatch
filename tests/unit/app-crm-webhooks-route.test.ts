import "../support/next-request-context";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { withRequest } from "../support/next-request-context";
import { GET, POST } from "../../src/app/api/app/crm-webhooks/route";
import { PATCH, DELETE } from "../../src/app/api/app/crm-webhooks/[id]/route";
import { createMemorySaasStore } from "../../src/product/saas/memory-store";
import type { SaasStore } from "../../src/product/saas/store";
import { signSessionClaims } from "../../src/product/saas/auth/session-token";

const names = ["AUTH_SECRET", "NODE_ENV"];
const saved = new Map(names.map((name) => [name, process.env[name]]));
const runtime = globalThis as typeof globalThis & {
  __tradecatchSaas?: { store: SaasStore; durable: boolean };
  __tradecatchGrowth?: unknown;
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
  mock.method(console, "warn", () => {});
});

afterEach(() => {
  mock.restoreAll();
  delete runtime.__tradecatchSaas;
  delete runtime.__tradecatchGrowth;
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
    name: "Webhooks fixture",
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
  url = "https://tradecatch.test/api/app/crm-webhooks",
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

describe("GET/POST /api/app/crm-webhooks", () => {
  it("rejects a plan without CRM_INTEGRATION_ADVANCED", async () => {
    const f = await fixture("growth");
    const response = await withRequest(request("GET", f.cookie), () => GET());
    assert.ok(response);
    assert.equal(response.status, 402);
  });

  it("creates an endpoint for a Receptionist-tier org", async () => {
    const f = await fixture("receptionist");
    const req = request("POST", f.cookie, {
      url: "https://hooks.example.test/crm",
      label: "Main CRM",
      eventTypes: ["pipeline.won"],
    });
    const response = await withRequest(req, () => POST(req));
    assert.ok(response);
    assert.equal(response.status, 201);
    const body = (await response.json()) as { endpoint: { id: string } };
    assert.ok(body.endpoint.id);

    const listReq = request("GET", f.cookie);
    const listResponse = await withRequest(listReq, () => GET());
    assert.ok(listResponse);
    const listBody = (await listResponse.json()) as { endpoints: unknown[] };
    assert.equal(listBody.endpoints.length, 1);
  });

  it("rejects a non-https or private-looking url", async () => {
    const f = await fixture("receptionist");
    for (const url of [
      "http://hooks.example.test/crm",
      "https://127.0.0.1/crm",
      "not-a-url",
    ]) {
      const req = request("POST", f.cookie, { url, label: "Bad" });
      const response = await withRequest(req, () => POST(req));
      assert.ok(response);
      assert.equal(response.status, 400, url);
    }
  });

  it("denies members and viewers from creating endpoints", async () => {
    for (const role of ["member", "viewer"] as const) {
      const f = await fixture("receptionist", role);
      const req = request("POST", f.cookie, {
        url: "https://hooks.example.test/crm",
        label: "Main CRM",
      });
      const response = await withRequest(req, () => POST(req));
      assert.ok(response);
      assert.equal(response.status, 403);
    }
  });

  it("caps the number of endpoints per organization", async () => {
    const f = await fixture("receptionist");
    const { getGrowthStore } = await import("../../src/product/growth");
    for (let i = 0; i < 10; i++) {
      await getGrowthStore().createCrmWebhookEndpoint({
        organizationId: f.organization.id,
        url: `https://hooks.example.test/${i}`,
        label: `Hook ${i}`,
        eventTypes: [],
      });
    }
    const req = request("POST", f.cookie, {
      url: "https://hooks.example.test/overflow",
      label: "Overflow",
    });
    const response = await withRequest(req, () => POST(req));
    assert.ok(response);
    assert.equal(response.status, 400);
  });
});

describe("PATCH/DELETE /api/app/crm-webhooks/[id]", () => {
  it("toggles active and updates eventTypes", async () => {
    const f = await fixture("receptionist");
    const { getGrowthStore } = await import("../../src/product/growth");
    const endpoint = await getGrowthStore().createCrmWebhookEndpoint({
      organizationId: f.organization.id,
      url: "https://hooks.example.test/crm",
      label: "Main",
      eventTypes: [],
    });

    const req = request(
      "PATCH",
      f.cookie,
      { active: false, eventTypes: ["pipeline.won"] },
      `https://tradecatch.test/api/app/crm-webhooks/${endpoint.id}`,
    );
    const response = await withRequest(req, () =>
      PATCH(req, { params: Promise.resolve({ id: endpoint.id }) }),
    );
    assert.ok(response);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      endpoint: { active: boolean; eventTypes: string[] };
    };
    assert.equal(body.endpoint.active, false);
    assert.deepEqual(body.endpoint.eventTypes, ["pipeline.won"]);
  });

  it("404s for an endpoint belonging to a different organization", async () => {
    const f = await fixture("receptionist");
    const other = await fixture("receptionist");
    const { getGrowthStore } = await import("../../src/product/growth");
    const endpoint = await getGrowthStore().createCrmWebhookEndpoint({
      organizationId: other.organization.id,
      url: "https://hooks.example.test/crm",
      label: "Main",
      eventTypes: [],
    });

    const req = request(
      "PATCH",
      f.cookie,
      { active: false },
      `https://tradecatch.test/api/app/crm-webhooks/${endpoint.id}`,
    );
    const response = await withRequest(req, () =>
      PATCH(req, { params: Promise.resolve({ id: endpoint.id }) }),
    );
    assert.ok(response);
    assert.equal(response.status, 404);
  });

  it("deletes an endpoint", async () => {
    const f = await fixture("receptionist");
    const { getGrowthStore } = await import("../../src/product/growth");
    const endpoint = await getGrowthStore().createCrmWebhookEndpoint({
      organizationId: f.organization.id,
      url: "https://hooks.example.test/crm",
      label: "Main",
      eventTypes: [],
    });

    const req = request(
      "DELETE",
      f.cookie,
      undefined,
      `https://tradecatch.test/api/app/crm-webhooks/${endpoint.id}`,
    );
    const response = await withRequest(req, () =>
      DELETE(req, { params: Promise.resolve({ id: endpoint.id }) }),
    );
    assert.ok(response);
    assert.equal(response.status, 200);
    assert.equal(
      await getGrowthStore().getCrmWebhookEndpoint(
        endpoint.id,
        f.organization.id,
      ),
      null,
    );
  });
});
