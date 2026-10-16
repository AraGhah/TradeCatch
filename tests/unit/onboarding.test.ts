import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  getSaasStore,
  resetSaasRuntimeForTests,
} from "../../src/product/saas/runtime";
import { createMemoryOnboardingStore } from "../../src/product/onboarding/memory-store";
import { createOnboardingService } from "../../src/product/onboarding/onboardingService";
import { requirementsForPlan } from "../../src/product/onboarding/requirements";
import {
  resetOnboardingRuntimeForTests,
  setOnboardingRuntimeForTests,
} from "../../src/product/onboarding/runtime";
import { resetBillingRuntimeForTests } from "../../src/product/billing/runtime";

describe("onboarding requirements by plan", () => {
  it("requires AI step only for ai_receptionist plan", () => {
    const starter = requirementsForPlan("starter");
    const ai = requirementsForPlan("ai_receptionist");
    assert.equal(
      starter.find((s) => s.stepId === "ai_receptionist")?.required,
      false,
    );
    assert.equal(
      ai.find((s) => s.stepId === "ai_receptionist")?.required,
      true,
    );
    assert.equal(starter.find((s) => s.stepId === "calendar")?.required, false);
    assert.equal(starter.find((s) => s.stepId === "phone")?.required, true);
  });
});

describe("onboarding progress persistence", () => {
  const envKeys = [
    "DATABASE_URL",
    "MISSED_CALL_DURABLE_STORE",
    "SAAS_DURABLE_STORE",
  ] as const;
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of envKeys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    resetSaasRuntimeForTests();
    resetOnboardingRuntimeForTests();
    resetBillingRuntimeForTests();
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    resetSaasRuntimeForTests();
    resetOnboardingRuntimeForTests();
    resetBillingRuntimeForTests();
  });

  it("saves business step and resumes current step", async () => {
    const created = await getSaasStore().createOrganizationWithOwner({
      name: "Montreal Plumbing Pro",
      ownerEmail: "owner@example.com",
      ownerName: "Owner",
      plan: "growth",
    });
    const store = createMemoryOnboardingStore();
    setOnboardingRuntimeForTests(store);
    const service = createOnboardingService({ store });

    const org = created.organization;
    const snap1 = await service.getSnapshot(org);
    assert.equal(snap1.session.status, "not_started");
    assert.equal(snap1.steps.length, 7);

    const saved = await service.saveStep({
      organization: org,
      stepId: "account",
      payload: { plan: "growth", termsAccepted: true },
      actorUserId: created.user.id,
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    const savedBiz = await service.saveStep({
      organization: org,
      stepId: "business",
      payload: {
        businessName: "Montreal Plumbing Pro",
        industry: "plumbing",
        city: "Montréal",
        serviceAreas: ["Montréal", "Laval"],
        services: ["Drain cleaning", "pipe repair"],
        timezone: "America/Toronto",
        emergencyService: true,
        language: "fr",
      },
      actorUserId: created.user.id,
    });
    assert.equal(savedBiz.ok, true);

    const resumed = await service.getSnapshot(org);
    assert.ok(
      resumed.session.status === "in_progress" ||
        resumed.session.status === "needs_action" ||
        resumed.session.status === "ready",
    );
    assert.equal(resumed.session.currentStep, "ai_receptionist");
    const businessStep = resumed.steps.find((s) => s.stepId === "business");
    assert.equal(businessStep?.status, "completed");
  });

  it("blocks activation when phone is not verified", async () => {
    const created = await getSaasStore().createOrganizationWithOwner({
      name: "Test Co",
      ownerEmail: "a@example.com",
      ownerName: "A",
      plan: "starter",
    });
    const store = createMemoryOnboardingStore();
    const service = createOnboardingService({ store });
    await service.saveStep({
      organization: created.organization,
      stepId: "account",
      payload: { plan: "starter", termsAccepted: true },
    });
    await service.saveStep({
      organization: created.organization,
      stepId: "business",
      payload: {
        businessName: "Test Co",
        city: "Montréal",
        serviceAreas: ["Montréal"],
        services: ["Repair"],
        timezone: "America/Toronto",
      },
    });

    const readiness = await service.computeReadiness(created.organization);
    assert.equal(readiness.canActivate, false);
    assert.ok(
      readiness.checks.some((c) => c.checkId === "phone_number" && !c.passed),
    );

    const activated = await service.activate({
      organization: created.organization,
    });
    assert.equal(activated.ok, false);
  });

  it("keeps onboarding records isolated per business", async () => {
    const a = await getSaasStore().createOrganizationWithOwner({
      name: "Alpha",
      ownerEmail: "alpha@example.com",
      ownerName: "A",
      plan: "starter",
    });
    const b = await getSaasStore().createOrganizationWithOwner({
      name: "Beta",
      ownerEmail: "beta@example.com",
      ownerName: "B",
      plan: "growth",
    });
    const store = createMemoryOnboardingStore();
    const service = createOnboardingService({ store });
    await service.saveStep({
      organization: a.organization,
      stepId: "account",
      payload: { plan: "starter", termsAccepted: true },
    });
    const snapA = await service.getSnapshot(a.organization);
    const snapB = await service.getSnapshot(b.organization);
    assert.equal(snapA.session.businessId, a.organization.id);
    assert.equal(snapB.session.businessId, b.organization.id);
    assert.notEqual(snapA.session.id, snapB.session.id);
    assert.equal(
      snapA.steps.find((s) => s.stepId === "account")?.status,
      "completed",
    );
    assert.equal(
      snapB.steps.find((s) => s.stepId === "account")?.status,
      "not_started",
    );
  });

  it("skips optional AI step on Starter without enabling AI", async () => {
    const created = await getSaasStore().createOrganizationWithOwner({
      name: "Starter Co",
      ownerEmail: "s@example.com",
      ownerName: "S",
      plan: "starter",
    });
    const store = createMemoryOnboardingStore();
    const service = createOnboardingService({ store });
    const skipped = await service.saveStep({
      organization: created.organization,
      stepId: "ai_receptionist",
      payload: {},
      skip: true,
    });
    assert.equal(skipped.ok, true);
    const step = (await service.getSnapshot(created.organization)).steps.find(
      (s) => s.stepId === "ai_receptionist",
    );
    assert.equal(step?.status, "skipped");
  });
});
