import "../support/next-request-context";
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it, mock } from "node:test";
import { Pool } from "pg";
import { NextRequest } from "next/server";
import { withRequest } from "../support/next-request-context";
import { POST } from "../../src/app/api/billing/portal/route";
import { createMemorySaasStore } from "../../src/product/saas/memory-store";
import type { SaasStore } from "../../src/product/saas/store";
import { signSessionClaims } from "../../src/product/saas/auth/session-token";
import {
  requireTenantContext,
  requireBillingContext,
} from "../../src/product/saas/tenant";
import { closePgPool } from "../../src/product/missed-call/postgres-store";
import {
  canManageBilling,
  isStripePortalUrl,
} from "../../src/product/saas/billing-access";

const names = [
  "AUTH_SECRET",
  "DATABASE_URL",
  "SAAS_DURABLE_STORE",
  "MISSED_CALL_DURABLE_STORE",
  "STRIPE_TEST_SECRET_KEY",
  "STRIPE_SECRET_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "TRADECATCH_ADMIN_EMAILS",
  "STRIPE_BILLING_PORTAL_CONFIGURATION",
  "STRIPE_TEST_BILLING_PORTAL_CONFIGURATION",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
];
const saved = new Map(names.map((name) => [name, process.env[name]]));
const runtime = globalThis as typeof globalThis & {
  __tradecatchSaas?: { store: SaasStore; durable: boolean };
};
let store: SaasStore;
let binding: { customer_id: string; livemode: boolean } | undefined;
let sqlCalls: { sql: string; values?: unknown[] }[];
let requests: { input: string; init?: RequestInit }[];
let providerStatus: number;
let providerBody: Record<string, unknown>;
let sqlFailure: boolean;
let counts: Map<string, number>;
beforeEach(() => {
  names.forEach((name) => delete process.env[name]);
  Object.assign(process.env, {
    AUTH_SECRET: "tc010-unit-secret-not-for-production",
    DATABASE_URL:
      "postgresql://postgres:billing-test-only@127.0.0.1:1/tc010_unit",
    SAAS_DURABLE_STORE: "1",
    STRIPE_TEST_SECRET_KEY: "sk_test_fixture",
    NEXT_PUBLIC_SITE_URL: "https://tradecatch.test",
  });
  store = createMemorySaasStore();
  runtime.__tradecatchSaas = { store, durable: false };
  binding = { customer_id: "cus_fixture", livemode: false };
  sqlCalls = [];
  requests = [];
  counts = new Map();
  sqlFailure = false;
  providerStatus = 200;
  providerBody = {
    customer: "cus_fixture",
    livemode: false,
    url: "https://billing.stripe.com/p/session/test_fixture",
  };
  mock.method(
    Pool.prototype,
    "query",
    async (sql: string, values?: unknown[]) => {
      sqlCalls.push({ sql, values });
      if (sqlFailure) throw new Error("test database failure");
      if (sql.includes("SELECT customer_id,livemode"))
        return { rows: binding ? [binding] : [], rowCount: binding ? 1 : 0 };
      if (sql.includes("INSERT INTO tc_rate_limits")) {
        const key = String(values?.[0]);
        const count = (counts.get(key) || 0) + 1;
        counts.set(key, count);
        return {
          rows: [{ count, reset_ms: Date.now() + 600000 }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    },
  );
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ input: String(input), init });
      return Response.json(providerBody, { status: providerStatus });
    },
  );
  mock.method(console, "warn", () => {});
  mock.method(console, "error", () => {});
});
afterEach(() => {
  mock.restoreAll();
  delete runtime.__tradecatchSaas;
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
after(closePgPool);

async function fixture(
  role = "owner",
  status: "active" | "suspended" | "churned" = "active",
  accountType: "demo" | "production" = "demo",
) {
  const f = await store.createOrganizationWithOwner({
    name: "Billing fixture",
    ownerName: "Owner",
    ownerEmail: crypto.randomUUID() + "@example.test",
    accountType,
    status,
  });
  await store.setMembershipRole(
    f.organization.id,
    f.user.id,
    role as "owner" | "admin" | "member" | "viewer",
  );
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
      plan: "starter",
      exp: Math.floor(Date.now() / 1000) + 600,
    },
    process.env.AUTH_SECRET!,
  );
  return { ...f, session, cookie: "tc_session=" + cookie };
}
function request(
  cookie = "",
  body: unknown = { locale: "en" },
  headers: Record<string, string> = {},
) {
  return new NextRequest("https://tradecatch.test/api/billing/portal", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      cookie,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const call = (req: NextRequest) => withRequest(req, () => POST(req));
describe("customer-specific billing portal", () => {
  it("creates an owner session using only the persisted customer binding and a fixed return origin", async () => {
    const f = await fixture();
    const response = await call(request(f.cookie));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.equal(
      ((await response.json()) as { url: string }).url,
      providerBody.url,
    );
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].input,
      "https://api.stripe.com/v1/billing_portal/sessions",
    );
    const params = new URLSearchParams(String(requests[0].init?.body));
    assert.equal(params.get("customer"), "cus_fixture");
    assert.equal(params.get("return_url"), "https://tradecatch.test/billing");
    assert.equal(params.get("locale"), "en");
    assert.deepEqual(
      sqlCalls.find((c) => c.sql.includes("SELECT customer_id,livemode"))
        ?.values,
      [f.organization.id],
    );
    assert.ok(sqlCalls.some((c) => c.sql.includes("tc_audit_logs")));
  });
  it("uses only the mode-specific server portal configuration", async () => {
    const f = await fixture();
    process.env.STRIPE_BILLING_PORTAL_CONFIGURATION = "bpc_live_fixture";
    process.env.STRIPE_TEST_BILLING_PORTAL_CONFIGURATION = "bpc_test_fixture";
    assert.equal((await call(request(f.cookie))).status, 200);
    assert.equal(
      new URLSearchParams(String(requests[0].init?.body)).get("configuration"),
      "bpc_test_fixture",
    );
  });
  it("redirects ordinary form submissions with 303, and creates a French return URL", async () => {
    const f = await fixture("admin");
    const response = await call(
      request(f.cookie, "locale=fr", {
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      }),
    );
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), providerBody.url);
    assert.equal(
      new URLSearchParams(String(requests[0].init?.body)).get("return_url"),
      "https://tradecatch.test/fr/facturation",
    );
  });
  it("rejects anonymous, forged, expired, revoked and mismatched sessions before Stripe is called", async () => {
    assert.equal((await call(request())).status, 401);
    assert.equal((await call(request("tc_session=forged"))).status, 401);
    const f = await fixture();
    await store.revokeSession(f.session.id, new Date().toISOString());
    assert.equal((await call(request(f.cookie))).status, 401);
    const expired = await fixture();
    await store.createSession({
      ...expired.session,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    assert.equal((await call(request(expired.cookie))).status, 401);
    const mismatch = await fixture();
    await store.createSession({ ...mismatch.session, userId: "someone_else" });
    assert.equal((await call(request(mismatch.cookie))).status, 401);
    assert.equal(requests.length, 0);
  });
  it("denies members and viewers even when they can read the workspace", async () => {
    for (const role of ["member", "viewer"]) {
      const f = await fixture(role);
      assert.equal((await call(request(f.cookie))).status, 403);
    }
    assert.equal(requests.length, 0);
  });
  it("rejects customer, organization, mode and return URL overrides", async () => {
    const f = await fixture();
    for (const extra of [
      { customer: "cus_other" },
      { organizationId: "org_other" },
      { livemode: true },
      { return_url: "https://evil.test" },
    ]) {
      assert.equal(
        (await call(request(f.cookie, { locale: "en", ...extra }))).status,
        400,
      );
    }
    assert.equal(requests.length, 0);
  });
  it("blocks cross-site writes and bounded invalid request bodies", async () => {
    const f = await fixture();
    assert.equal(
      (
        await call(
          request(
            f.cookie,
            {},
            { "sec-fetch-site": "cross-site", origin: "https://evil.test" },
          ),
        )
      ).status,
      403,
    );
    assert.equal((await call(request(f.cookie, "x".repeat(2049)))).status, 413);
    assert.equal((await call(request(f.cookie, "{"))).status, 400);
    assert.equal(requests.length, 0);
  });
  it("returns a clear missing-binding error without creating a Stripe customer by email", async () => {
    const f = await fixture();
    binding = undefined;
    const response = await call(request(f.cookie));
    assert.equal(response.status, 409);
    assert.equal(
      ((await response.json()) as { code: string }).code,
      "not_linked",
    );
    assert.equal(requests.length, 0);
  });
  it("fails closed for database, provider, mode, key and response URL failures", async () => {
    for (const mode of [
      "database",
      "provider",
      "key",
      "mode",
      "customer",
      "redirect",
      "response-mode",
    ]) {
      const f = await fixture();
      binding = { customer_id: "cus_fixture", livemode: false };
      sqlFailure = mode === "database";
      providerStatus = mode === "provider" ? 500 : 200;
      process.env.STRIPE_TEST_SECRET_KEY =
        mode === "key" ? "sk_live_fixture" : "sk_test_fixture";
      providerBody = {
        customer: mode === "customer" ? "cus_other" : "cus_fixture",
        livemode: mode === "response-mode",
        url:
          mode === "redirect"
            ? "https://evil.test"
            : "https://billing.stripe.com/p/session/test_fixture",
      };
      if (mode === "mode") binding.livemode = true;
      assert.equal((await call(request(f.cookie))).status, 503, mode);
    }
  });
  it("allows billing recovery for inactive owners/admins without enabling app features", async () => {
    for (const role of ["owner", "admin"])
      for (const status of ["suspended", "churned"] as const) {
        const f = await fixture(role, status);
        const req = request(f.cookie);
        const app = await withRequest(req, requireTenantContext);
        assert.equal(app.ok, false);
        const billing = await withRequest(req, requireBillingContext);
        assert.equal(billing.ok, true);
        if (billing.ok) assert.deepEqual(billing.ctx.features, []);
        assert.equal((await call(request(f.cookie))).status, 200);
      }
  });
  it("rate limits repeated session creation per organization and user", async () => {
    const f = await fixture();
    for (let i = 0; i < 5; i++)
      assert.equal((await call(request(f.cookie))).status, 200);
    const response = await call(request(f.cookie));
    assert.equal(response.status, 429);
    assert.ok(response.headers.get("retry-after"));
    assert.equal(requests.length, 5);
  });
});
describe("billing URL and role restrictions", () => {
  it("accepts only Stripe session URLs and organization billing roles", () => {
    assert.equal(canManageBilling("owner"), true);
    assert.equal(canManageBilling("admin"), true);
    for (const role of ["member", "viewer", "platform_admin", ""])
      assert.equal(canManageBilling(role), false);
    assert.ok(
      isStripePortalUrl("https://billing.stripe.com/p/session/test_123"),
    );
    assert.ok(
      isStripePortalUrl(
        "https://billing.stripe.com/p/session?secret=test_example",
      ),
    );
    for (const value of [
      "javascript:alert(1)",
      "http://billing.stripe.com/p/session/x",
      "https://billing.stripe.com.evil.test/p/session/x",
      "https://evil.test",
      "https://user@billing.stripe.com/p/session/x",
      "https://billing.stripe.com:444/p/session/x",
      "https://billing.stripe.com/other",
      null,
    ])
      assert.equal(isStripePortalUrl(value), false, String(value));
  });
});
