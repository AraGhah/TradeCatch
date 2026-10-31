import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";

const managed = ["NODE_ENV", "TRADECATCH_ENV"];
const original = new Map(managed.map((key) => [key, process.env[key]]));
const mainTechnicianOnCallAllWeek = Array.from({ length: 7 }, (_, day) => ({
  day,
  start: "00:00",
  end: "23:59",
  technicianId: "tech_marc",
}));

function setNodeEnv(value: string) {
  (process.env as { NODE_ENV?: string }).NODE_ENV = value;
}

function resetGlobals() {
  const g = globalThis as unknown as {
    __tradecatchMissedCall?: unknown;
    __tradecatchMissedCallReadStore?: unknown;
    __tradecatchSaas?: unknown;
  };
  delete g.__tradecatchMissedCall;
  delete g.__tradecatchMissedCallReadStore;
  delete g.__tradecatchSaas;
}

beforeEach(() => {
  managed.forEach((key) => delete process.env[key]);
  setNodeEnv("development");
  resetGlobals();
  mock.method(console, "warn", () => {});
  mock.method(console, "info", () => {});
});

afterEach(() => {
  mock.restoreAll();
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetGlobals();
});

function voiceRequest(params: Record<string, string>) {
  const body = new URLSearchParams(params).toString();
  return new NextRequest("http://localhost/api/twilio/voice/inbound", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

describe("POST /api/twilio/voice/inbound — advanced call routing", () => {
  it("dials only the on-call technician for a plan without ADVANCED_CALL_ROUTING", async () => {
    const { getMissedCallRuntime } = await import(
      "../../src/product/missed-call/runtime"
    );
    const { getSaasStore } = await import("../../src/product/saas/runtime");

    const client = demoClientAccount({
      id: "client_growth_org",
      smsFromNumber: "+14162010199",
    });
    const runtime = getMissedCallRuntime();
    await runtime.ready;
    await runtime.store.saveClient(client);

    const saas = getSaasStore();
    const { organization } = await saas.createOrganizationWithOwner({
      name: "Growth Plumbing",
      ownerEmail: "growth@example.com",
      ownerName: "Owner",
      phoneE164: "+14162010199",
    });
    await saas.updateOrganizationPlan(organization.id, "growth");
    await saas.linkMissedCallClient(organization.id, client.id);

    const { POST } = await import(
      "../../src/app/api/twilio/voice/inbound/route"
    );
    const response = await POST(
      voiceRequest({ From: "+15145551234", To: "+14162010199" }),
    );
    const text = await response.text();
    assert.equal(response.status, 200);
    const numberCount = (text.match(/<Number>/g) ?? []).length;
    assert.equal(numberCount, 1);
  });

  it("dials the full escalation chain simultaneously for a Receptionist-tier org", async () => {
    const { getMissedCallRuntime } = await import(
      "../../src/product/missed-call/runtime"
    );
    const { getSaasStore } = await import("../../src/product/saas/runtime");

    const client = demoClientAccount({
      id: "client_pro_org",
      smsFromNumber: "+14162010299",
      onCallSchedule: mainTechnicianOnCallAllWeek,
    });
    const runtime = getMissedCallRuntime();
    await runtime.ready;
    await runtime.store.saveClient(client);

    const saas = getSaasStore();
    const { organization } = await saas.createOrganizationWithOwner({
      name: "Pro Plumbing",
      ownerEmail: "pro@example.com",
      ownerName: "Owner",
      phoneE164: "+14162010299",
    });
    await saas.updateOrganizationPlan(organization.id, "receptionist");
    await saas.linkMissedCallClient(organization.id, client.id);

    const { POST } = await import(
      "../../src/app/api/twilio/voice/inbound/route"
    );
    const response = await POST(
      voiceRequest({ From: "+15145551234", To: "+14162010299" }),
    );
    const text = await response.text();
    assert.equal(response.status, 200);
    const numberCount = (text.match(/<Number>/g) ?? []).length;
    assert.equal(numberCount, 4);
    for (const tech of client.technicianRoster) {
      assert.ok(text.includes(tech.phone));
    }
  });

  it("falls back to single-number dial when no organization claims the number", async () => {
    const { getMissedCallRuntime } = await import(
      "../../src/product/missed-call/runtime"
    );
    const client = demoClientAccount({
      id: "client_unlinked",
      smsFromNumber: "+14162010399",
    });
    const runtime = getMissedCallRuntime();
    await runtime.ready;
    await runtime.store.saveClient(client);

    const { POST } = await import(
      "../../src/app/api/twilio/voice/inbound/route"
    );
    const response = await POST(
      voiceRequest({ From: "+15145551234", To: "+14162010399" }),
    );
    const text = await response.text();
    assert.equal(response.status, 200);
    const numberCount = (text.match(/<Number>/g) ?? []).length;
    assert.equal(numberCount, 1);
  });
});
