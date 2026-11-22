/**
 * Characterization test for the tenant + plan-feature gate on /api/app routes
 * (KAN-30). Every handler below must answer, before doing anything else:
 *   - no session            -> 401 { error: "Not authenticated." }
 *   - organization inactive -> 401 { error: "Organization is not active." }
 *   - plan lacks the feature -> 402 { error, feature, upgrade }
 * The order (401 before 402) and the bodies are an API contract the dashboard
 * relies on, so they are pinned route by route.
 */
// Must load first: installs Next's AsyncLocalStorage baseline before next/server.
import "../support/next-request-context";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { withRequest } from "../support/next-request-context";
import { createMemorySaasStore } from "../../src/product/saas/memory-store";
import type { SaasStore } from "../../src/product/saas/store";
import { signSessionClaims } from "../../src/product/saas/auth/session-token";
import {
  PLAN_IDS,
  orgHasFeature,
  soldPlanWith,
  type FeatureId,
  type PlanId,
} from "../../src/product/saas/entitlements";

const SECRET = "tenant-feature-gate-unit-secret-not-for-production";
const names = ["AUTH_SECRET", "NODE_ENV"];
const saved = new Map(names.map((name) => [name, process.env[name]]));
const runtime = globalThis as typeof globalThis & {
  __tradecatchSaas?: { store: SaasStore; durable: boolean };
};
let store: SaasStore;

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET;
  (process.env as { NODE_ENV?: string }).NODE_ENV = "development";
  store = createMemorySaasStore();
  runtime.__tradecatchSaas = { store, durable: false };
  mock.method(console, "warn", () => {});
  mock.method(console, "error", () => {});
  mock.method(console, "info", () => {});
});

afterEach(() => {
  mock.restoreAll();
  delete runtime.__tradecatchSaas;
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function tenant(plan: PlanId, status: "active" | "suspended" = "active") {
  const f = await store.createOrganizationWithOwner({
    name: "Gate fixture",
    ownerName: "Owner",
    ownerEmail: `${crypto.randomUUID()}@example.test`,
  });
  await store.updateOrganizationPlan(f.organization.id, plan);
  if (status !== "active") await store.updateOrganization(f.organization.id, { status });
  const session = {
    id: crypto.randomUUID(),
    organizationId: f.organization.id,
    userId: f.user.id,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    createdAt: new Date().toISOString(),
  };
  await store.createSession(session);
  const cookie = await signSessionClaims(
    { sid: session.id, uid: f.user.id, oid: f.organization.id, plan, exp: Math.floor(Date.now() / 1000) + 600 },
    SECRET,
  );
  return `tc_session=${cookie}`;
}

type Handler = (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** Route module -> the feature its gate checks first. */
const ROUTES: { path: string; feature: FeatureId; load: () => Promise<Record<string, unknown>> }[] = [
  { path: "analytics", feature: "ADVANCED_ANALYTICS", load: () => import("../../src/app/api/app/analytics/route") },
  { path: "api-keys", feature: "WEBSITE_LEAD_CAPTURE", load: () => import("../../src/app/api/app/api-keys/route") },
  { path: "bookings", feature: "APPOINTMENT_BOOKING", load: () => import("../../src/app/api/app/bookings/route") },
  { path: "contracts", feature: "CONTRACT_RENEWAL_AUTOMATION", load: () => import("../../src/app/api/app/contracts/route") },
  { path: "contracts/[id]", feature: "CONTRACT_RENEWAL_AUTOMATION", load: () => import("../../src/app/api/app/contracts/[id]/route") },
  { path: "crm-webhooks", feature: "CRM_INTEGRATION_ADVANCED", load: () => import("../../src/app/api/app/crm-webhooks/route") },
  { path: "crm-webhooks/[id]", feature: "CRM_INTEGRATION_ADVANCED", load: () => import("../../src/app/api/app/crm-webhooks/[id]/route") },
  { path: "dashboard", feature: "BASIC_ANALYTICS", load: () => import("../../src/app/api/app/dashboard/route") },
  { path: "email-automation", feature: "EMAIL_AUTOMATION", load: () => import("../../src/app/api/app/email-automation/route") },
  { path: "inbox", feature: "HUMAN_TAKEOVER", load: () => import("../../src/app/api/app/inbox/route") },
  { path: "leads", feature: "MISSED_CALL_RECOVERY", load: () => import("../../src/app/api/app/leads/route") },
  { path: "pipeline", feature: "ADVANCED_PIPELINE", load: () => import("../../src/app/api/app/pipeline/route") },
  { path: "quotes", feature: "QUOTE_FOLLOW_UP", load: () => import("../../src/app/api/app/quotes/route") },
  { path: "receptionist", feature: "MISSED_CALL_RECOVERY", load: () => import("../../src/app/api/app/receptionist/route") },
  { path: "reviews", feature: "REVIEW_AUTOMATION", load: () => import("../../src/app/api/app/reviews/route") },
  { path: "sms-receptionist", feature: "MISSED_CALL_RECOVERY", load: () => import("../../src/app/api/app/sms-receptionist/route") },
  { path: "team/technicians", feature: "MULTI_CREW_CALENDARS", load: () => import("../../src/app/api/app/team/technicians/route") },
  { path: "website-leads", feature: "WEBSITE_LEAD_CAPTURE", load: () => import("../../src/app/api/app/website-leads/route") },
];

function call(handler: Handler, path: string, method: string, cookie?: string) {
  const url = `https://tradecatch.test/api/app/${path.replace("[id]", "gate_fixture_id")}`;
  const request = new NextRequest(url, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      "content-type": "application/json",
      origin: "https://tradecatch.test",
    },
    ...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }),
  });
  return withRequest(request, () =>
    handler(request, { params: Promise.resolve({ id: "gate_fixture_id" }) }),
  ) as Promise<Response>;
}

describe("tenant + plan-feature gate on /api/app routes", () => {
  it("covers a realistic number of handlers", async () => {
    let count = 0;
    for (const route of ROUTES) {
      const mod = await route.load();
      count += METHODS.filter((m) => typeof mod[m] === "function").length;
    }
    assert.ok(count >= 25, `found ${count} handlers`);
  });

  for (const route of ROUTES) {
    describe(`/api/app/${route.path}`, () => {
      it("answers 401 Not authenticated without a session", async () => {
        const mod = await route.load();
        for (const method of METHODS) {
          const handler = mod[method] as Handler | undefined;
          if (!handler) continue;
          const res = await call(handler, route.path, method);
          assert.equal(res.status, 401, `${method} status`);
          assert.deepEqual(await res.json(), { error: "Not authenticated." }, `${method} body`);
        }
      });

      it("answers 401 for an inactive organization", async () => {
        const mod = await route.load();
        const cookie = await tenant("professional", "suspended");
        for (const method of METHODS) {
          const handler = mod[method] as Handler | undefined;
          if (!handler) continue;
          const res = await call(handler, route.path, method, cookie);
          assert.equal(res.status, 401, `${method} status`);
          assert.deepEqual(await res.json(), { error: "Organization is not active." }, `${method} body`);
        }
      });

      const lacking = PLAN_IDS.find((plan) => !orgHasFeature(plan, route.feature));
      it(
        `answers 402 ${route.feature} for a plan without it`,
        { skip: lacking ? false : "every plan includes this feature" },
        async () => {
          const mod = await route.load();
          const cookie = await tenant(lacking!);
          for (const method of METHODS) {
            const handler = mod[method] as Handler | undefined;
            if (!handler) continue;
            const res = await call(handler, route.path, method, cookie);
            assert.equal(res.status, 402, `${method} on ${lacking}`);
            assert.deepEqual(
              await res.json(),
              {
                error: "Feature not included in your plan.",
                feature: route.feature,
                upgrade: soldPlanWith(route.feature),
              },
              `${method} body`,
            );
          }
        },
      );
    });
  }
});
