import "../support/next-request-context";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { withRequest } from "../support/next-request-context";
import { PATCH } from "../../src/app/api/app/settings/route";
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
    name: "Settings fixture",
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
  url = "https://tradecatch.test/api/app/settings",
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

describe("PATCH /api/app/settings crmWebhookUrl plan gate", () => {
  const url = "https://hooks.example.test/crm";

  async function patch(cookie: string, body: unknown) {
    const req = request("PATCH", cookie, body);
    const response = await withRequest(req, () => PATCH(req));
    assert.ok(response);
    return response;
  }

  async function storedUrl(organizationId: string) {
    const { getGrowthStore } = await import("../../src/product/growth");
    return (await getGrowthStore().getOrgSettings(organizationId))
      .crmWebhookUrl;
  }

  it("rejects setting a webhook on Starter with a 402", async () => {
    const f = await fixture("starter");
    const response = await patch(f.cookie, { crmWebhookUrl: url });
    assert.equal(response.status, 402);
    const body = (await response.json()) as { feature: string };
    assert.equal(body.feature, "CRM_INTEGRATION_LIMITED");
    assert.equal(await storedUrl(f.organization.id), undefined);
  });

  it("still lets a Starter org save other settings", async () => {
    const f = await fixture("starter");
    const response = await patch(f.cookie, {
      notifyEmail: "owner@example.test",
      crmWebhookUrl: null,
    });
    assert.equal(response.status, 200);
  });

  for (const plan of ["growth", "receptionist"] as const) {
    it("allows setting a webhook on " + plan, async () => {
      const f = await fixture(plan);
      const response = await patch(f.cookie, { crmWebhookUrl: url });
      assert.equal(response.status, 200);
      assert.equal(await storedUrl(f.organization.id), url);
    });
  }

  it("lets a downgraded org clear an existing webhook", async () => {
    const f = await fixture("growth");
    assert.equal((await patch(f.cookie, { crmWebhookUrl: url })).status, 200);
    await store.updateOrganizationPlan(f.organization.id, "starter");
    const response = await patch(f.cookie, { crmWebhookUrl: null });
    assert.equal(response.status, 200);
    assert.equal(await storedUrl(f.organization.id), undefined);
  });
});
