import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { POST as requestLink } from "../../src/app/api/auth/magic-link/route";
import { POST as provisionOrganization } from "../../src/app/api/missed-call/ops/provision-organization/route";
import {
  getSaasStore,
  resetSaasRuntimeForTests,
} from "../../src/product/saas/runtime";

const originalEnv = {
  MISSED_CALL_OPS_SECRET: process.env.MISSED_CALL_OPS_SECRET,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NODE_ENV: process.env.NODE_ENV,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  SAAS_DEV_LOGIN: process.env.SAAS_DEV_LOGIN,
  TRADECATCH_E2E: process.env.TRADECATCH_E2E,
  VERCEL_ENV: process.env.VERCEL_ENV,
};

const provisionBody = {
  email: "pilot-owner@example.test",
  organizationName: "Founder Gated Plumbing",
  ownerName: "Pilot Owner",
  locale: "en" as const,
  plan: "starter" as const,
};

function postRequest(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("founder-gated organization provisioning", () => {
  before(() => {
    process.env.MISSED_CALL_OPS_SECRET = "unit-test-ops-secret";
    process.env.SAAS_DEV_LOGIN = "1";
    resetSaasRuntimeForTests();
  });

  after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetSaasRuntimeForTests();
  });

  it("requires both the ops bearer and an operator identity", async () => {
    const unauthenticated = await provisionOrganization(
      postRequest("/api/missed-call/ops/provision-organization", provisionBody),
    );
    assert.equal(unauthenticated.status, 401);

    const missingActor = await provisionOrganization(
      postRequest(
        "/api/missed-call/ops/provision-organization",
        provisionBody,
        { authorization: "Bearer unit-test-ops-secret" },
      ),
    );
    assert.equal(missingActor.status, 403);
  });

  it("creates one owner organization and returns it on duplicate requests", async () => {
    const headers = {
      authorization: "Bearer unit-test-ops-secret",
      "x-ops-actor": "unit-test-founder",
    };
    const first = await provisionOrganization(
      postRequest(
        "/api/missed-call/ops/provision-organization",
        provisionBody,
        headers,
      ),
    );
    assert.equal(first.status, 201);
    const firstBody = (await first.json()) as {
      created: boolean;
      owner: { id: string; email: string };
      organization: { id: string; name: string; plan: string };
    };
    assert.equal(firstBody.created, true);
    assert.equal(firstBody.owner.email, provisionBody.email);

    const duplicate = await provisionOrganization(
      postRequest(
        "/api/missed-call/ops/provision-organization",
        {
          ...provisionBody,
          email: provisionBody.email.toUpperCase(),
          organizationName: "Must Not Create Another Org",
          plan: "growth",
        },
        headers,
      ),
    );
    assert.equal(duplicate.status, 200);
    const duplicateBody = (await duplicate.json()) as {
      created: boolean;
      owner: { id: string };
      organization: { id: string; name: string; plan: string };
    };
    assert.equal(duplicateBody.created, false);
    assert.equal(duplicateBody.owner.id, firstBody.owner.id);
    assert.equal(duplicateBody.organization.id, firstBody.organization.id);
    assert.equal(duplicateBody.organization.name, firstBody.organization.name);
    assert.equal(duplicateBody.organization.plan, "starter");

    const memberships = await getSaasStore().listMembershipsForUser(
      firstBody.owner.id,
    );
    assert.equal(memberships.length, 1);
  });

  it("keeps unknown public sign-ins generic and refuses onboarding fields", async () => {
    const unknownEmail = "unknown-public-login@example.test";
    const unknown = await requestLink(
      postRequest("/api/auth/magic-link", {
        email: unknownEmail,
        locale: "en",
      }),
    );
    assert.equal(unknown.status, 200);
    assert.deepEqual(await unknown.json(), { ok: true });
    assert.equal(await getSaasStore().getUserByEmail(unknownEmail), null);

    const onboardingAttempt = await requestLink(
      postRequest("/api/auth/magic-link", {
        email: "another-unknown@example.test",
        locale: "en",
        companyName: "Attacker Controlled Org",
        plan: "growth",
      }),
    );
    assert.equal(onboardingAttempt.status, 400);
    assert.equal(
      await getSaasStore().getUserByEmail("another-unknown@example.test"),
      null,
    );
  });

  it("issues a development magic link only after ops provisioning", async () => {
    const response = await requestLink(
      postRequest("/api/auth/magic-link", {
        email: provisionBody.email,
        locale: "en",
      }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      ok: boolean;
      devToken?: string;
    };
    assert.equal(body.ok, true);
    assert.ok(body.devToken);
  });

  it("returns the same generic response without a token on real production origins", async () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.tradecatch.example";
    process.env.SAAS_DEV_LOGIN = "1";
    delete process.env.TRADECATCH_E2E;
    delete process.env.VERCEL_ENV;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;

    const known = await requestLink(
      postRequest("/api/auth/magic-link", {
        email: provisionBody.email,
        locale: "en",
      }),
    );
    const unknown = await requestLink(
      postRequest("/api/auth/magic-link", {
        email: "production-unknown@example.test",
        locale: "en",
      }),
    );

    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.deepEqual(await known.json(), { ok: true });
    assert.deepEqual(await unknown.json(), { ok: true });
    assert.equal(
      await getSaasStore().getUserByEmail("production-unknown@example.test"),
      null,
    );
  });
});
