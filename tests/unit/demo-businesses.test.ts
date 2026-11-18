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
import {
  getSchedulingService,
  resetSchedulingRuntimeForTests,
} from "../../src/product/scheduling/runtime";

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
  resetSchedulingRuntimeForTests();
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

  it("CAL-01 the demo's sample visits are on the calendar, inside the business's hours, and a reset clears them", async () => {
    const created = await createDemoBusiness({
      businessName: "Calendar Demo",
      industry: "hvac",
      ownerEmail: "calendar@example.demo",
      language: "en",
      idempotencyKey: "idem-calendar-demo",
    });
    const id = created.organization.id;
    await seedDemoBusiness(id);

    const scheduling = getSchedulingService();
    const visits = await scheduling.list(id);
    // They used to be saved in a table the calendar never reads.
    assert.equal(visits.length, 4);
    assert.ok(visits.every((row) => row.simulated && row.status === "confirmed"));
    assert.equal(new Set(visits.map((row) => row.startAt.slice(0, 10))).size, 4, "on four different days");
    const rules = await scheduling.getRules(id);
    for (const row of visits) {
      const local = new Intl.DateTimeFormat("en-CA", {
        timeZone: rules.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(row.startAt));
      assert.ok(local >= "08:00" && local < "17:00", `${row.startAt} is ${local} in ${rules.timezone}`);
    }

    await resetDemoBusiness(id, { reseed: false });
    assert.deepEqual(await scheduling.list(id), []);
  });

  // The seed used to take the first 48 open times (two and a half days) and
  // then the last one left on a day that was already half over, so the answer
  // depended on when it ran: late in the afternoon it gave three visits, one
  // of them at closing time.
  for (const [label, now] of [
    ["early on a weekday morning", "2026-11-18T13:00:00Z"],
    ["in the middle of a weekday afternoon", "2026-11-18T18:46:00Z"],
    ["after closing on a Friday", "2026-11-20T23:30:00Z"],
    ["on a Saturday", "2026-11-21T17:00:00Z"],
    ["at the end of the year, across a month and year change", "2026-12-29T20:00:00Z"],
  ] as const) {
    it(`CAL-01 the sample visits are four mid-morning visits whenever the demo is seeded: ${label}`, async (t) => {
      t.mock.timers.enable({ apis: ["Date"], now: Date.parse(now) });
      const created = await createDemoBusiness({
        businessName: "Clock Demo",
        industry: "hvac",
        ownerEmail: "clock@example.demo",
        language: "en",
        idempotencyKey: "idem-clock-demo",
      });
      const id = created.organization.id;
      await seedDemoBusiness(id);

      const scheduling = getSchedulingService();
      const visits = await scheduling.list(id);
      const rules = await scheduling.getRules(id);
      assert.equal(visits.length, 4);
      const local = (startAt: string) =>
        new Intl.DateTimeFormat("en-CA", {
          timeZone: rules.timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        })
          .formatToParts(new Date(startAt))
          .reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {});
      const days = new Set<string>();
      for (const row of visits) {
        assert.ok(Date.parse(row.startAt) > Date.parse(now), `${row.startAt} is in the future`);
        const parts = local(row.startAt);
        const time = `${parts.hour}:${parts.minute}`;
        assert.ok(time >= "09:00" && time < "12:00", `${row.startAt} is ${time}, not mid-morning`);
        days.add(`${parts.year}-${parts.month}-${parts.day}`);
      }
      assert.equal(days.size, 4, "on four different days of the business");
    });
  }

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
