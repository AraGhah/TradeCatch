import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  createDemoBusiness,
  deleteDemoBusiness,
  listDemoBusinesses,
  resetDemoBusiness,
  seedDemoBusiness,
} from "../../src/product/demo/business-service";
import { resetSaasRuntimeForTests } from "../../src/product/saas/runtime";
import { getSaasStore } from "../../src/product/saas/runtime";
import { resetStarterRuntimeForTests } from "../../src/product/starter/runtime";
import { resetGrowthRuntimeForTests } from "../../src/product/growth/runtime";
import { isPlatformAdminUser } from "../../src/product/saas/platform-admin";

const KEYS = [
  "NODE_ENV",
  "TRADECATCH_ENV",
  "TRADECATCH_ADMIN_EMAILS",
  "MISSED_CALL_DURABLE_STORE",
  "DATABASE_URL",
  "MISSED_CALL_ALLOW_DEMO",
  "AUTH_SECRET",
] as const;

const original = new Map(KEYS.map((key) => [key, process.env[key]]));

function setNodeEnv(value: string | undefined) {
  const env = process.env as { NODE_ENV?: string };
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

beforeEach(() => {
  setNodeEnv("development");
  process.env.TRADECATCH_ENV = "staging";
  process.env.MISSED_CALL_ALLOW_DEMO = "1";
  process.env.TRADECATCH_ADMIN_EMAILS = "admin@tradecatch.test";
  delete process.env.MISSED_CALL_DURABLE_STORE;
  delete process.env.DATABASE_URL;
  resetSaasRuntimeForTests();
  resetStarterRuntimeForTests();
  resetGrowthRuntimeForTests();
  const g = globalThis as unknown as { __tradecatchMissedCall?: unknown };
  delete g.__tradecatchMissedCall;
});

afterEach(() => {
  for (const key of KEYS) {
    const value = original.get(key);
    if (key === "NODE_ENV") {
      setNodeEnv(value);
      continue;
    }
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetSaasRuntimeForTests();
  resetStarterRuntimeForTests();
  resetGrowthRuntimeForTests();
});

describe("demo contractor account system", () => {
  it("creates an isolated demo business with owner membership", async () => {
    const result = await createDemoBusiness({
      businessName: "Montreal Plumbing Pro",
      industry: "plumbing",
      ownerEmail: "owner1@example.demo",
      ownerName: "Ara Demo",
      language: "fr",
      city: "Montréal",
      serviceArea: "Montréal, Laval",
      subscriptionPlan: "growth",
      idempotencyKey: "idem-create-1",
    });

    assert.equal(result.created, true);
    assert.equal(result.organization.accountType, "demo");
    assert.equal(result.organization.plan, "growth");
    assert.ok(result.organization.missedCallClientId);
    assert.equal(result.profile.name, "Montreal Plumbing Pro");

    const saas = getSaasStore();
    const membership = await saas.getMembership(
      result.organization.id,
      result.user.id,
    );
    assert.equal(membership?.role, "owner");
  });

  it("is idempotent when the same Idempotency-Key is reused", async () => {
    const first = await createDemoBusiness({
      businessName: "HVAC Demo Co",
      industry: "hvac",
      ownerEmail: "owner2@example.demo",
      language: "en",
      idempotencyKey: "idem-same-key",
    });
    const second = await createDemoBusiness({
      businessName: "HVAC Demo Co",
      industry: "hvac",
      ownerEmail: "owner2@example.demo",
      language: "en",
      idempotencyKey: "idem-same-key",
    });
    assert.equal(second.created, false);
    assert.equal(second.organization.id, first.organization.id);
  });

  it("keeps two demo businesses isolated from each other", async () => {
    const a = await createDemoBusiness({
      businessName: "Alpha Plumbing",
      industry: "plumbing",
      ownerEmail: "alpha@example.demo",
      language: "en",
      idempotencyKey: "idem-alpha",
    });
    const b = await createDemoBusiness({
      businessName: "Beta Electrical",
      industry: "electrical",
      ownerEmail: "beta@example.demo",
      language: "en",
      idempotencyKey: "idem-beta",
    });

    const saas = getSaasStore();
    const cross = await saas.getMembership(b.organization.id, a.user.id);
    assert.equal(cross, null);

    await seedDemoBusiness(a.organization.id);
    const listed = await listDemoBusinesses();
    assert.ok(listed.some((biz) => biz.id === a.organization.id));
    assert.ok(listed.some((biz) => biz.id === b.organization.id));
  });

  it("seeds and resets demo data without deleting the owner", async () => {
    const created = await createDemoBusiness({
      businessName: "Roofing Demo",
      industry: "roofing",
      ownerEmail: "roof@example.demo",
      language: "fr",
      idempotencyKey: "idem-roof",
    });

    const summary = await seedDemoBusiness(created.organization.id);
    assert.equal(summary.customers, 10);
    assert.equal(summary.appointments, 4);

    const reset = await resetDemoBusiness(created.organization.id, {
      reseed: false,
    });
    assert.equal(reset.ok, true);

    const saas = getSaasStore();
    const org = await saas.getOrganization(created.organization.id);
    assert.ok(org);
    assert.equal(org?.accountType, "demo");
    const membership = await saas.getMembership(
      created.organization.id,
      created.user.id,
    );
    assert.equal(membership?.role, "owner");
  });

  it("deletes one demo business without removing another", async () => {
    const keep = await createDemoBusiness({
      businessName: "Keep Me",
      industry: "general",
      ownerEmail: "keep@example.demo",
      language: "en",
      idempotencyKey: "idem-keep",
    });
    const drop = await createDemoBusiness({
      businessName: "Drop Me",
      industry: "general",
      ownerEmail: "drop@example.demo",
      language: "en",
      idempotencyKey: "idem-drop",
    });

    await deleteDemoBusiness(drop.organization.id);
    const saas = getSaasStore();
    assert.equal(await saas.getOrganization(drop.organization.id), null);
    assert.ok(await saas.getOrganization(keep.organization.id));
  });

  it("recognizes platform admins from TRADECATCH_ADMIN_EMAILS", () => {
    assert.equal(
      isPlatformAdminUser(
        { email: "admin@tradecatch.test", platformRole: "none" },
        { TRADECATCH_ADMIN_EMAILS: "admin@tradecatch.test" },
      ),
      true,
    );
    assert.equal(
      isPlatformAdminUser(
        { email: "other@example.com", platformRole: "none" },
        { TRADECATCH_ADMIN_EMAILS: "admin@tradecatch.test" },
      ),
      false,
    );
    assert.equal(
      isPlatformAdminUser(
        { email: "other@example.com", platformRole: "admin" },
        {},
      ),
      true,
    );
  });
});
