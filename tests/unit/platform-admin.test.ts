import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideRoleChange, decideStatusChange } from "../../src/product/admin/account-actions";
import { buildPlatformStats, filterPlatformRows, type PlatformOrg } from "../../src/product/admin/platform-stats";
import { isPlatformAdminUser } from "../../src/product/saas/platform-admin";

function org(patch: Partial<PlatformOrg> & Pick<PlatformOrg, "id" | "name">): PlatformOrg {
  return {
    slug: patch.id,
    plan: "starter",
    status: "active",
    accountType: "live",
    city: "Laval",
    industry: "plumbing",
    createdAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-02T12:00:00.000Z",
    missedCallClientId: patch.id,
    ...patch,
  };
}

describe("platform admin access", () => {
  it("rejects a contractor who is not on the administrator list", () => {
    assert.equal(
      isPlatformAdminUser(
        { email: "owner@northplumbing.ca", platformRole: "none" },
        { TRADECATCH_ADMIN_EMAILS: "founder@tradecatch.ca" },
      ),
      false,
    );
    assert.equal(
      isPlatformAdminUser(
        { email: "founder@tradecatch.ca", platformRole: "none" },
        { TRADECATCH_ADMIN_EMAILS: "founder@tradecatch.ca" },
      ),
      true,
    );
  });
});

describe("platform stats", () => {
  const orgs = [
    org({ id: "a", name: "Nord", plan: "growth" }),
    org({ id: "b", name: "Sud", status: "suspended", plan: "starter" }),
    org({ id: "c", name: "Est", status: "churned", updatedAt: "2026-10-11T12:00:00.000Z" }),
    org({ id: "d", name: "Demo", accountType: "demo", plan: "growth", missedCallClientId: "demo-client" }),
  ];
  const usage = {
    leadsByClient: { a: 4, b: 1, "demo-client": 50 },
    callsByClient: { a: 3, "demo-client": 9 },
    completedCallsByClient: { a: 2, "demo-client": 8 },
    appointmentsByOrg: { a: 5, d: 7 },
  };

  it("counts paying revenue and keeps another business's usage out", () => {
    const stats = buildPlatformStats(orgs, usage, new Date("2026-10-17T12:00:00.000Z"));
    assert.equal(stats.businesses, 3);
    assert.equal(stats.activeSubscriptions, 1);
    assert.equal(stats.mrr, 749.99);
    assert.equal(stats.leads, 5);
    assert.equal(stats.calls, 3);
    assert.equal(stats.aiCompleted, 2);
    assert.equal(stats.appointments, 5);
    assert.equal(stats.demos, 1);
    const one = filterPlatformRows(stats.rows, { businessId: "a" });
    assert.deepEqual(one.map((row) => row.leads), [4]);
    assert.equal(filterPlatformRows(stats.rows, { q: "laval", status: "active" }).some((row) => row.id === "d"), true);
  });
});

describe("administrative actions", () => {
  it("requires the confirmation word and protects the signed-in organization", () => {
    assert.equal(decideStatusChange({
      next: "suspended",
      confirm: "please",
      sessionOrganizationId: "admin-org",
      targetOrganizationId: "customer",
    }).ok, false);
    assert.equal(decideStatusChange({
      next: "suspended",
      confirm: "suspend",
      sessionOrganizationId: "same",
      targetOrganizationId: "same",
    }).ok, false);
    const ok = decideStatusChange({
      next: "suspended",
      confirm: "suspend",
      sessionOrganizationId: "admin-org",
      targetOrganizationId: "customer",
    });
    assert.equal(ok.ok && ok.status, "suspended");
  });

  it("refuses to remove the last owner", () => {
    const members = [
      { userId: "owner", role: "owner" as const },
      { userId: "tech", role: "member" as const },
    ];
    assert.equal(decideRoleChange({ members, userId: "owner", next: "admin" }).ok, false);
    const changed = decideRoleChange({ members, userId: "tech", next: "viewer" });
    assert.equal(changed.ok && changed.role, "viewer");
  });
});
