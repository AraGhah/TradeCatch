import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertFeature,
  featuresForPlan,
  orgHasFeature,
} from "../../src/product/saas/entitlements";
import { computeStarterDashboardMetrics } from "../../src/product/saas/analytics";
import { createMemorySaasStore } from "../../src/product/saas/memory-store";
import {
  signSessionClaims,
  verifySessionClaims,
} from "../../src/product/saas/auth/session-token";
import type { LeadRecord } from "../../src/product/missed-call/types";
import { hashToken, randomToken } from "../../src/product/saas/ids";

describe("entitlements", () => {
  it("gives Starter recovery features without Growth-only booking", () => {
    const starter = featuresForPlan("starter");
    assert.equal(orgHasFeature("starter", "MISSED_CALL_RECOVERY"), true);
    assert.equal(orgHasFeature("starter", "BASIC_ANALYTICS"), true);
    assert.equal(orgHasFeature("starter", "HUMAN_TAKEOVER"), true);
    assert.equal(orgHasFeature("starter", "APPOINTMENT_BOOKING"), false);
    assert.equal(orgHasFeature("growth", "APPOINTMENT_BOOKING"), true);
    assert.ok(starter.every((f) => orgHasFeature("growth", f)));
    assert.equal(assertFeature("starter", "REVENUE_ATTRIBUTION").ok, false);
    assert.equal(assertFeature("growth", "REVENUE_ATTRIBUTION").ok, true);
  });
});

describe("starter dashboard metrics", () => {
  it("does not invent pipeline value when leads have none", () => {
    const leads: LeadRecord[] = [
      {
        id: "lead_1",
        clientAccountId: "c1",
        workflowId: "w1",
        callId: "call_1",
        callerE164: "+15145550101",
        photoUrls: [],
        serviceAreaFlagged: false,
        humanReviewRequired: true,
        conversation: [
          {
            at: new Date().toISOString(),
            direction: "inbound",
            fromE164: "+15145550101",
            toE164: "+15145550100",
            body: "Fuite",
            actor: "customer",
          },
        ],
        techniciansAlerted: [],
        manualCorrections: [],
        outcome: "human_review",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    const metrics = computeStarterDashboardMetrics(leads);
    assert.equal(metrics.leadsCaptured, 1);
    assert.equal(metrics.leadsReplied, 1);
    assert.equal(metrics.needsAttention, 1);
    assert.equal(metrics.estimatedPipelineValue, null);
  });

  it("sums real estimated values only", () => {
    const base = {
      clientAccountId: "c1",
      workflowId: "w1",
      callId: "call_1",
      callerE164: "+15145550101",
      photoUrls: [] as string[],
      serviceAreaFlagged: false,
      humanReviewRequired: false,
      conversation: [],
      techniciansAlerted: [],
      manualCorrections: [],
      outcome: "technician_accepted" as const,
      jobAccepted: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const metrics = computeStarterDashboardMetrics([
      { ...base, id: "a", estimatedValue: 1000 },
      { ...base, id: "b", finalValue: 500 },
    ]);
    assert.equal(metrics.estimatedPipelineValue, 1500);
    assert.equal(metrics.jobsAccepted, 2);
  });
});

describe("saas multi-tenant isolation (memory)", () => {
  it("keeps org A membership from accessing org B by id alone", async () => {
    const store = createMemorySaasStore();
    const a = await store.createOrganizationWithOwner({
      name: "Alpha Plumbing",
      ownerEmail: "owner-a@example.com",
      ownerName: "A",
    });
    const b = await store.createOrganizationWithOwner({
      name: "Beta HVAC",
      ownerEmail: "owner-b@example.com",
      ownerName: "B",
      missedCallClientId: "client_beta",
    });

    const membershipOnB = await store.getMembership(
      b.organization.id,
      a.user.id,
    );
    assert.equal(membershipOnB, null);

    const linked = await store.findOrganizationByMissedCallClientId(
      "client_beta",
    );
    assert.equal(linked?.id, b.organization.id);
    assert.notEqual(linked?.id, a.organization.id);
  });

  it("consumes magic links once", async () => {
    const store = createMemorySaasStore();
    await store.createOrganizationWithOwner({
      name: "Gamma",
      ownerEmail: "gamma@example.com",
      ownerName: "G",
    });
    const raw = randomToken();
    const hash = hashToken(raw);
    const now = new Date();
    await store.createMagicLink({
      id: "mlk_1",
      email: "gamma@example.com",
      tokenHash: hash,
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      createdAt: now.toISOString(),
    });
    const first = await store.consumeMagicLink(hash, now.toISOString());
    const second = await store.consumeMagicLink(hash, now.toISOString());
    assert.ok(first);
    assert.equal(second, null);
  });
});

describe("session token HMAC", () => {
  it("round-trips and rejects tampering / expiry", async () => {
    const secret = "test-auth-secret-at-least-32-chars!!";
    const token = await signSessionClaims(
      {
        sid: "ses_1",
        uid: "usr_1",
        oid: "org_1",
        plan: "starter",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      secret,
    );
    const claims = await verifySessionClaims(token, secret);
    assert.equal(claims?.oid, "org_1");
    assert.equal(claims?.plan, "starter");

    const bad = token.slice(0, -2) + "aa";
    assert.equal(await verifySessionClaims(bad, secret), null);

    const expired = await signSessionClaims(
      {
        sid: "ses_2",
        uid: "usr_1",
        oid: "org_1",
        plan: "growth",
        exp: Math.floor(Date.now() / 1000) - 10,
      },
      secret,
    );
    assert.equal(await verifySessionClaims(expired, secret), null);
  });
});
