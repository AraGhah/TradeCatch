import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";

function setNodeEnv(value: string) {
  (process.env as { NODE_ENV?: string }).NODE_ENV = value;
}

const managed = [
  "NODE_ENV",
  "TRADECATCH_ENV",
  "DATABASE_URL",
  "MISSED_CALL_DURABLE_STORE",
  "SAAS_DURABLE_STORE",
  "MISSED_CALL_OPS_SECRET",
  "CRON_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "MISSED_CALL_PUBLIC_WEBHOOK_BASE",
];
const original = new Map(managed.map((key) => [key, process.env[key]]));

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
  Object.assign(process.env, {
    NODE_ENV: "development",
    MISSED_CALL_OPS_SECRET: "test-ops-secret",
    TWILIO_ACCOUNT_SID: "AC_test",
    TWILIO_AUTH_TOKEN: "token_test",
    MISSED_CALL_PUBLIC_WEBHOOK_BASE: "https://tradecatch.ca",
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

function request(headers: Record<string, string> = {}, body?: unknown) {
  return new NextRequest(
    "http://localhost/api/missed-call/ops/provision-number",
    {
      method: "POST",
      headers: {
        ...headers,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
  );
}

const auth = {
  authorization: "Bearer test-ops-secret",
  "x-ops-actor": "ops-test",
};

describe("POST /api/missed-call/ops/provision-number", () => {
  it("refuses unauthenticated requests", async () => {
    const { POST } = await import(
      "../../src/app/api/missed-call/ops/provision-number/route"
    );
    assert.equal((await POST(request())).status, 401);
  });

  it("requires an attributable operator in production", async () => {
    setNodeEnv("production");
    const { POST } = await import(
      "../../src/app/api/missed-call/ops/provision-number/route"
    );
    assert.equal(
      (await POST(request({ authorization: auth.authorization }))).status,
      403,
    );
  });

  it("404s for an unknown organization", async () => {
    const { POST } = await import(
      "../../src/app/api/missed-call/ops/provision-number/route"
    );
    const response = await POST(
      request(auth, { organizationId: "org_missing" }),
    );
    assert.equal(response.status, 404);
  });

  it("provisions a real number end to end and links the organization", async () => {
    mock.method(
      globalThis,
      "fetch",
      async (url: unknown, init?: RequestInit) => {
        const path = String(url);
        if (path.includes("AvailablePhoneNumbers")) {
          return Response.json({
            available_phone_numbers: [
              { phone_number: "+15142010188", friendly_name: "(514) 201-0188" },
            ],
          });
        }
        if (path.includes("IncomingPhoneNumbers") && init?.method !== "DELETE") {
          return Response.json({ sid: "PN123", phone_number: "+15142010188" });
        }
        throw new Error(`Unexpected fetch: ${path}`);
      },
    );

    const { getSaasStore } = await import("../../src/product/saas/runtime");
    const { organization } = await getSaasStore().createOrganizationWithOwner({
      name: "Bea's Plumbing",
      ownerEmail: "bea@example.com",
      ownerName: "Bea",
      phoneE164: "+14162010199",
      timezone: "America/Toronto",
    });

    const { POST } = await import(
      "../../src/app/api/missed-call/ops/provision-number/route"
    );
    const response = await POST(
      request(auth, { organizationId: organization.id }),
    );
    const payload = (await response.json()) as {
      ok: boolean;
      smsFromNumber: string;
      clientAccountId: string;
    };
    assert.equal(response.status, 200);
    assert.equal(payload.smsFromNumber, "+15142010188");

    const relinked = await getSaasStore().getOrganization(organization.id);
    assert.equal(relinked?.missedCallClientId, payload.clientAccountId);
  });

  it("returns 409 and never spends anything when the organization is already linked", async () => {
    const fetchSpy = mock.method(globalThis, "fetch", async () => {
      throw new Error("must not call Twilio");
    });
    const { getSaasStore } = await import("../../src/product/saas/runtime");
    const saas = getSaasStore();
    const { organization } = await saas.createOrganizationWithOwner({
      name: "Already Linked Co",
      ownerEmail: "linked@example.com",
      ownerName: "Owner",
      phoneE164: "+14162010199",
    });
    await saas.linkMissedCallClient(organization.id, "client_existing");

    const { POST } = await import(
      "../../src/app/api/missed-call/ops/provision-number/route"
    );
    const response = await POST(
      request(auth, { organizationId: organization.id }),
    );
    assert.equal(response.status, 409);
    assert.equal(fetchSpy.mock.callCount(), 0);
  });
});
