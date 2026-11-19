import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  BUSINESS_AUDIT_FIELDS,
  createBusiness,
  createBusinessSchema,
  getBusinessDetail,
  listBusinesses,
  updateBusiness,
  updateBusinessSchema,
  type BusinessDeps,
  type DetailProbes,
} from "../../src/product/admin-console/businesses";
import { summarizeChanges } from "../../src/product/security/audit-changes";
import { PLAN_FEATURES } from "../../src/product/saas/entitlements";
import { createMemorySaasStore } from "../../src/product/saas/memory-store";
import type { SaasStore } from "../../src/product/saas/store";

type Seed = { name: string; email: string; plan?: "essential" | "professional"; city?: string };

async function seed(store: SaasStore, ...rows: Seed[]) {
  const out = [];
  for (const row of rows) {
    const created = await store.createOrganizationWithOwner({
      name: row.name,
      ownerEmail: row.email,
      ownerName: row.name + " Owner",
      locale: "en",
      plan: row.plan ?? "essential",
      city: row.city ?? null,
      accountType: "production",
    });
    out.push(created.organization);
  }
  return out;
}

const query = (over: Record<string, unknown> = {}) => ({ page: 1, pageSize: 25, ...over });

describe("listing businesses", () => {
  let store: SaasStore;
  let deps: BusinessDeps;
  beforeEach(async () => {
    store = createMemorySaasStore();
    deps = { store, subscriptions: async () => [] };
    await seed(
      store,
      { name: "Acme Plumbing", email: "owner@acme.ca", city: "Montreal" },
      { name: "Beta Electric", email: "boss@beta.ca", plan: "professional", city: "Laval" },
      { name: "Gamma HVAC", email: "hi@gamma.ca" },
    );
  });

  it("shows name, owner contact, plan, status and creation date for each business", async () => {
    const { rows, total } = await listBusinesses(query(), deps);
    assert.equal(total, 3);
    const beta = rows.find((r) => r.name === "Beta Electric")!;
    assert.equal(beta.plan, "professional");
    assert.equal(beta.status, "active");
    assert.equal(beta.owner?.email, "boss@beta.ca");
    assert.ok(beta.createdAt.startsWith("20"));
    assert.equal(beta.monthlyCad, 349.99);
  });

  it("searches name, city and owner email", async () => {
    assert.deepEqual((await listBusinesses(query({ q: "acme" }), deps)).rows.map((r) => r.name), ["Acme Plumbing"]);
    assert.deepEqual((await listBusinesses(query({ q: "laval" }), deps)).rows.map((r) => r.name), ["Beta Electric"]);
    assert.deepEqual((await listBusinesses(query({ q: "hi@gamma.ca" }), deps)).rows.map((r) => r.name), ["Gamma HVAC"]);
    assert.equal((await listBusinesses(query({ q: "nobody" }), deps)).total, 0);
  });

  it("filters by plan and status, and counts a deactivated business as no revenue", async () => {
    assert.equal((await listBusinesses(query({ plan: "professional" }), deps)).total, 1);
    const [acme] = (await store.listOrganizations()).filter((o) => o.name === "Acme Plumbing");
    await store.updateOrganization(acme.id, { status: "churned" });
    const churned = await listBusinesses(query({ status: "churned" }), deps);
    assert.deepEqual(churned.rows.map((r) => [r.name, r.status, r.monthlyCad]), [["Acme Plumbing", "churned", 0]]);
    assert.equal((await listBusinesses(query({ status: "active" }), deps)).total, 2);
  });

  it("filters by creation date", async () => {
    const today = new Date().toISOString().slice(0, 10);
    assert.equal((await listBusinesses(query({ from: today, to: today }), deps)).total, 3);
    assert.equal((await listBusinesses(query({ from: "2999-01-01" }), deps)).total, 0);
    assert.equal((await listBusinesses(query({ to: "2000-01-01" }), deps)).total, 0);
  });

  it("pages, and clamps a page past the end to the last one", async () => {
    const first = await listBusinesses(query({ pageSize: 2 }), deps);
    assert.equal(first.rows.length, 2);
    assert.equal(first.pages, 2);
    const last = await listBusinesses(query({ pageSize: 2, page: 99 }), deps);
    assert.equal(last.page, 2);
    assert.equal(last.rows.length, 1);
    const ids = new Set([...first.rows, ...last.rows].map((r) => r.id));
    assert.equal(ids.size, 3);
  });

  it("shows the synchronized subscription state when there is one", async () => {
    const [acme] = (await store.listOrganizations()).filter((o) => o.name === "Acme Plumbing");
    const withSub: BusinessDeps = {
      store,
      subscriptions: async () => [
        {
          subscriptionId: "sub_1", organizationId: acme.id, customerId: "cus_1", livemode: false,
          status: "past_due", plan: "essential", cancelAtPeriodEnd: true,
          currentPeriodEnd: "2026-12-01T00:00:00.000Z", latestInvoiceId: null, syncedAt: "2026-11-01T00:00:00.000Z",
        },
      ],
    };
    const { rows } = await listBusinesses(query(), withSub);
    assert.deepEqual(rows.find((r) => r.id === acme.id)?.subscription, {
      status: "past_due", cancelAtPeriodEnd: true, currentPeriodEnd: "2026-12-01T00:00:00.000Z",
    });
    assert.equal(rows.filter((r) => r.subscription).length, 1);
  });
});

describe("business detail", () => {
  const probes = (over: Partial<DetailProbes> = {}): DetailProbes => ({
    receptionist: async () => ({ linked: true, activated: true, phoneNumber: "+15145550100" }),
    calendar: async () => ({ connected: true, detail: "connected" }),
    gmail: async () => ({ connected: false, detail: null }),
    ...over,
  });

  it("shows members, what the plan includes, the receptionist and each integration", async () => {
    const store = createMemorySaasStore();
    const [org] = await seed(store, { name: "Acme Plumbing", email: "o@acme.ca", plan: "professional" });
    const deps: BusinessDeps = {
      store,
      subscriptions: async () => [
        {
          subscriptionId: "sub_1", organizationId: org.id, customerId: "cus_1", livemode: false,
          status: "active", plan: "professional", cancelAtPeriodEnd: false, currentPeriodEnd: null,
          latestInvoiceId: null, syncedAt: "2026-11-01T00:00:00.000Z",
        },
      ],
    };
    const detail = await getBusinessDetail(org.id, deps, probes());
    assert.ok(detail);
    assert.deepEqual(detail.members.map((m) => [m.email, m.role]), [["o@acme.ca", "owner"]]);
    assert.deepEqual(detail.receptionist, { linked: true, activated: true, phoneNumber: "+15145550100" });
    const states = Object.fromEntries(detail.integrations.map((i) => [i.key, i.state]));
    assert.deepEqual(states, {
      phone_line: "connected",
      voice_receptionist: "connected",
      calendar: "connected",
      gmail: "not_connected",
      billing: "connected",
    });
    // Services reflect the plan's entitlements.
    const included = detail.services.filter((s) => s.included).map((s) => s.feature).sort();
    assert.deepEqual(included, [...PLAN_FEATURES.professional].sort());
  });

  it("shows different entitlements for different plans", async () => {
    const store = createMemorySaasStore();
    const [essential, professional] = await seed(
      store,
      { name: "Small Co", email: "s@small.ca", plan: "essential" },
      { name: "Big Co", email: "b@big.ca", plan: "professional" },
    );
    const deps: BusinessDeps = { store, subscriptions: async () => [] };
    const a = await getBusinessDetail(essential.id, deps, probes());
    const b = await getBusinessDetail(professional.id, deps, probes());
    const only = PLAN_FEATURES.professional.filter((f) => !PLAN_FEATURES.essential.includes(f));
    assert.ok(only.length > 0, "the plans must differ for this test to mean anything");
    for (const feature of only) {
      assert.equal(a!.services.find((s) => s.feature === feature)?.included, false);
      assert.equal(b!.services.find((s) => s.feature === feature)?.included, true);
    }
  });

  it("says unavailable, not not-connected, when an integration cannot be checked", async () => {
    const store = createMemorySaasStore();
    const [org] = await seed(store, { name: "Acme", email: "o@acme.ca" });
    const detail = await getBusinessDetail(
      org.id,
      { store, subscriptions: async () => [] },
      probes({ calendar: async () => null, gmail: async () => null }),
    );
    const states = Object.fromEntries(detail!.integrations.map((i) => [i.key, i.state]));
    assert.equal(states.calendar, "unavailable");
    assert.equal(states.gmail, "unavailable");
    assert.equal(states.billing, "not_connected");
  });

  it("returns null for a business that does not exist", async () => {
    const store = createMemorySaasStore();
    assert.equal(await getBusinessDetail("org_missing", { store, subscriptions: async () => [] }, probes()), null);
  });
});

describe("creating a customer account", () => {
  const valid = {
    organizationName: "Delta Roofing",
    ownerName: "Dee Delta",
    ownerEmail: "Dee@Delta.ca",
    plan: "essential" as const,
    locale: "en" as const,
    sendInvite: true,
    accountType: "production" as const,
  };

  const lockless = async <T>(_key: string, work: () => Promise<T>) => work();

  it("creates the business and owner on a public plan and emails an invitation", async () => {
    const store = createMemorySaasStore();
    const invites: string[] = [];
    const result = await createBusiness(createBusinessSchema.parse(valid), {
      store,
      lock: lockless,
      sendInvite: async ({ email }) => {
        invites.push(email);
        return { ok: true };
      },
    });
    assert.ok(result.ok);
    assert.equal(result.organization.name, "Delta Roofing");
    assert.equal(result.organization.plan, "essential");
    assert.equal(result.organization.accountType, "production");
    assert.equal(result.owner.email, "dee@delta.ca");
    assert.deepEqual(result.invite, { requested: true, sent: true });
    assert.deepEqual(invites, ["dee@delta.ca"]);
    const members = await store.listMembershipsForOrganization(result.organization.id);
    assert.deepEqual(members.map((m) => m.role), ["owner"]);
  });

  it("does not pretend the invite went out when sending fails, and the account still exists", async () => {
    const store = createMemorySaasStore();
    const result = await createBusiness(createBusinessSchema.parse(valid), {
      store,
      lock: lockless,
      sendInvite: async () => {
        throw new Error("mail down");
      },
    });
    assert.ok(result.ok);
    assert.deepEqual(result.invite, { requested: true, sent: false });
  });

  it("can create without sending an invitation", async () => {
    const store = createMemorySaasStore();
    let called = false;
    const result = await createBusiness(createBusinessSchema.parse({ ...valid, sendInvite: false }), {
      store,
      lock: lockless,
      sendInvite: async () => {
        called = true;
        return { ok: true };
      },
    });
    assert.ok(result.ok);
    assert.deepEqual(result.invite, { requested: false, sent: false });
    assert.equal(called, false);
  });

  it("refuses an owner email that already belongs to a business", async () => {
    const store = createMemorySaasStore();
    const deps = { store, lock: lockless, sendInvite: async () => ({ ok: true }) };
    assert.ok((await createBusiness(createBusinessSchema.parse(valid), deps)).ok);
    const again = await createBusiness(
      createBusinessSchema.parse({ ...valid, organizationName: "Second Business", ownerEmail: "DEE@delta.ca" }),
      deps,
    );
    assert.deepEqual(again, { ok: false, error: "email_exists" });
    assert.equal((await store.listOrganizations()).length, 1);
  });

  it("a double click (two submissions at once) creates one account, not two", async () => {
    const store = createMemorySaasStore();
    let invites = 0;
    const deps = {
      store,
      lock: lockless,
      sendInvite: async () => {
        invites += 1;
        return { ok: true };
      },
    };
    const input = createBusinessSchema.parse(valid);
    const results = await Promise.all([createBusiness(input, deps), createBusiness(input, deps), createBusiness(input, deps)]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => !r.ok && r.error === "email_exists").length, 2);
    assert.equal((await store.listOrganizations()).length, 1);
    assert.equal(invites, 1);
  });

  it("takes the cross-instance lock for the owner's email, and releases it even when creation fails", async () => {
    const store = createMemorySaasStore();
    const keys: string[] = [];
    let open = 0;
    const lock = async <T>(key: string, work: () => Promise<T>) => {
      keys.push(key);
      open += 1;
      try {
        return await work();
      } finally {
        open -= 1;
      }
    };
    const broken = { ...store, createOrganizationWithOwner: async () => { throw new Error("db"); } } as unknown as SaasStore;
    const result = await createBusiness(createBusinessSchema.parse(valid), {
      store: broken,
      lock,
      sendInvite: async () => ({ ok: true }),
    });
    assert.deepEqual(result, { ok: false, error: "failed" });
    assert.deepEqual(keys, ["tc-admin-create:dee@delta.ca"]);
    assert.equal(open, 0);
  });

  describe("validation", () => {
    it("accepts only the plans sold today", () => {
      assert.ok(createBusinessSchema.safeParse(valid).success);
      assert.ok(createBusinessSchema.safeParse({ ...valid, plan: "professional" }).success);
      for (const legacy of ["starter", "growth", "receptionist", "enterprise", ""]) {
        assert.equal(createBusinessSchema.safeParse({ ...valid, plan: legacy }).success, false, legacy);
      }
    });

    it("refuses bad emails, names and phones, and unknown fields (no password, status or role can be injected)", () => {
      for (const bad of [
        { ownerEmail: "not-an-email" },
        { ownerEmail: "" },
        { organizationName: "A" },
        { ownerName: "" },
        { phone: "abc" },
        { password: "hunter2" },
        { status: "active" },
        { role: "admin" },
        { organizationId: "org_x" },
      ]) {
        assert.equal(createBusinessSchema.safeParse({ ...valid, ...bad }).success, false, JSON.stringify(bad));
      }
    });

    it("normalizes the phone number to E.164", () => {
      const parsed = createBusinessSchema.parse({ ...valid, phone: "514-555-0100" });
      assert.match(parsed.phone ?? "", /^\+1514555/);
    });
  });
});

describe("updating business information", () => {
  it("applies and persists only what changed, and returns before and after for the audit record", async () => {
    const store = createMemorySaasStore();
    const [org] = await seed(store, { name: "Acme Plumbing", email: "o@acme.ca", city: "Montreal" });
    const result = await updateBusiness(
      org.id,
      updateBusinessSchema.parse({ name: "Acme Plumbing & Heating", city: "Montreal", phone: "514-555-0100", timezone: "America/Halifax" }),
      store,
    );
    assert.ok(result.ok);
    assert.equal(result.before.name, "Acme Plumbing");
    assert.equal(result.after.name, "Acme Plumbing & Heating");
    // Reading it back from the store proves it persisted.
    const reloaded = await store.getOrganization(org.id);
    assert.equal(reloaded?.name, "Acme Plumbing & Heating");
    assert.match(reloaded?.phoneE164 ?? "", /^\+1514555/);
    assert.equal(reloaded?.timezone, "America/Halifax");
    assert.equal(reloaded?.city, "Montreal");

    const changes = summarizeChanges(
      result.before as unknown as Record<string, unknown>,
      result.after as unknown as Record<string, unknown>,
      BUSINESS_AUDIT_FIELDS,
    );
    const fields = changes.map((c) => c.field).sort();
    // city did not change, so it is not in the record.
    assert.deepEqual(fields, ["name", "phoneE164", "timezone"]);
    // The phone number is masked in the audit trail.
    const phone = changes.find((c) => c.field === "phoneE164");
    assert.doesNotMatch(JSON.stringify(phone), /5145550100/);
  });

  it("reports no_change for an identical update and not_found for an unknown business", async () => {
    const store = createMemorySaasStore();
    const [org] = await seed(store, { name: "Acme Plumbing", email: "o@acme.ca" });
    assert.deepEqual(await updateBusiness(org.id, { name: "Acme Plumbing" }, store), { ok: false, error: "no_change" });
    assert.deepEqual(await updateBusiness("org_missing", { name: "Whatever" }, store), { ok: false, error: "not_found" });
  });

  it("clears optional fields when given null or an empty string", async () => {
    const store = createMemorySaasStore();
    const [org] = await seed(store, { name: "Acme Plumbing", email: "o@acme.ca", city: "Montreal" });
    const result = await updateBusiness(org.id, updateBusinessSchema.parse({ city: "", industry: null }), store);
    assert.ok(result.ok);
    assert.equal(result.after.city, null);
  });

  it("cannot change plan, status, owner or account type through this route", () => {
    for (const forbidden of [{ plan: "professional" }, { status: "active" }, { accountType: "demo" }, { ownerEmail: "x@y.ca" }, { id: "org_2" }]) {
      assert.equal(updateBusinessSchema.safeParse({ name: "Valid Name", ...forbidden }).success, false, JSON.stringify(forbidden));
    }
    assert.equal(updateBusinessSchema.safeParse({}).success, false);
  });

  it("refuses an unknown timezone and a bad phone number", () => {
    assert.equal(updateBusinessSchema.safeParse({ timezone: "Mars/Olympus" }).success, false);
    assert.equal(updateBusinessSchema.safeParse({ phone: "12" }).success, false);
    assert.ok(updateBusinessSchema.safeParse({ timezone: "America/Vancouver" }).success);
  });
});
