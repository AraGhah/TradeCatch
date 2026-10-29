import "../support/next-request-context";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { withRequest } from "../support/next-request-context";
import { GET } from "../../src/app/api/app/analytics/route";
import { createMemorySaasStore } from "../../src/product/saas/memory-store";
import type { SaasStore } from "../../src/product/saas/store";
import { signSessionClaims } from "../../src/product/saas/auth/session-token";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import type { LeadRecord, TechnicianAlertRecord } from "../../src/product/missed-call/types";

const names = ["AUTH_SECRET", "NODE_ENV", "TRADECATCH_ENV"];
const saved = new Map(names.map((name) => [name, process.env[name]]));
const runtime = globalThis as typeof globalThis & {
  __tradecatchSaas?: { store: SaasStore; durable: boolean };
  __tradecatchMissedCall?: unknown;
  __tradecatchMissedCallReadStore?: unknown;
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
  delete runtime.__tradecatchMissedCall;
  delete runtime.__tradecatchMissedCallReadStore;
  mock.method(console, "warn", () => {});
});

afterEach(() => {
  mock.restoreAll();
  delete runtime.__tradecatchSaas;
  delete runtime.__tradecatchMissedCall;
  delete runtime.__tradecatchMissedCallReadStore;
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function fixture(plan: "starter" | "growth" | "receptionist") {
  const f = await store.createOrganizationWithOwner({
    name: "Analytics fixture",
    ownerName: "Owner",
    ownerEmail: crypto.randomUUID() + "@example.test",
  });
  await store.updateOrganizationPlan(f.organization.id, plan);
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

function request(cookie: string) {
  return new NextRequest("https://tradecatch.test/api/app/analytics", {
    method: "GET",
    headers: { cookie },
  });
}

const call = (req: NextRequest) => withRequest(req, () => GET(req));

function alert(
  technicianId: string,
  response: TechnicianAlertRecord["response"],
): TechnicianAlertRecord {
  return {
    technicianId,
    phone: "+15145550000",
    sentAt: "2026-01-01T00:00:00.000Z",
    stage: "primary",
    actionToken: "AB12",
    response,
  };
}

describe("GET /api/app/analytics — advanced revenue analytics", () => {
  it("omits advancedRevenue for a plan without ADVANCED_REVENUE_ANALYTICS", async () => {
    const f = await fixture("growth");
    const response = await call(request(f.cookie));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { advancedRevenue?: unknown };
    assert.equal(body.advancedRevenue, undefined);
  });

  it("omits advancedRevenue for a Receptionist-tier org with no linked SMS client", async () => {
    const f = await fixture("receptionist");
    const response = await call(request(f.cookie));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { advancedRevenue?: unknown };
    assert.equal(body.advancedRevenue, undefined);
  });

  it("includes per-technician revenue attribution for a linked Receptionist-tier org", async () => {
    const f = await fixture("receptionist");
    const { getMissedCallRuntime } = await import(
      "../../src/product/missed-call/runtime"
    );
    const client = demoClientAccount({ id: "client_analytics" });
    const mcRuntime = getMissedCallRuntime();
    await mcRuntime.ready;
    await mcRuntime.store.saveClient(client);
    const lead: LeadRecord = {
      id: "lead_1",
      clientAccountId: client.id,
      workflowId: "wf_1",
      callId: "call_1",
      callerE164: "+15145559999",
      photoUrls: [],
      serviceAreaFlagged: false,
      humanReviewRequired: false,
      conversation: [],
      techniciansAlerted: [alert("tech_marc", "accepted")],
      manualCorrections: [],
      outcome: "resolved",
      becameBooking: true,
      finalValue: 500,
      createdAt: "2026-01-10T00:00:00.000Z",
      updatedAt: "2026-01-10T00:00:00.000Z",
    };
    await mcRuntime.store.saveLead(lead);
    await store.linkMissedCallClient(f.organization.id, client.id);

    const response = await call(request(f.cookie));
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      advancedRevenue: {
        totalRevenue: number;
        technicianRevenue: { technicianId: string; revenue: number }[];
      };
    };
    assert.equal(body.advancedRevenue.totalRevenue, 500);
    const marc = body.advancedRevenue.technicianRevenue.find(
      (t) => t.technicianId === "tech_marc",
    );
    assert.equal(marc?.revenue, 500);
  });
});
