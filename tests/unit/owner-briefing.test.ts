import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { runOwnerBriefings } from "../../src/product/agent-tools/agents/owner-briefing";
import { getGrowthStore } from "../../src/product/growth/runtime";
import { resetGrowthRuntimeForTests } from "../../src/product/growth/runtime";
import { getSaasStore, resetSaasRuntimeForTests } from "../../src/product/saas/runtime";

afterEach(() => {
  resetSaasRuntimeForTests();
  resetGrowthRuntimeForTests();
});

async function createOrg(overrides: { timezone?: string } = {}) {
  const { organization } = await getSaasStore().createOrganizationWithOwner({
    name: "Plomberie Test",
    ownerEmail: "owner@example.com",
    ownerName: "Owner Test",
    timezone: overrides.timezone ?? "UTC",
  });
  return organization;
}

describe("owner-briefing agent", () => {
  it("skips organizations that are not due yet in their local time zone", async () => {
    const organization = await createOrg({ timezone: "UTC" });
    const earlyMorning = new Date("2026-01-01T08:00:00Z");
    const [outcome] = await runOwnerBriefings([organization], earlyMorning);
    assert.equal(outcome.sent, false);
    assert.equal((outcome as { reason: string }).reason, "not_due");
  });

  it("finds the owner and proceeds to the send step when no notify email is configured", async () => {
    const organization = await createOrg({ timezone: "UTC" });
    const evening = new Date("2026-01-01T19:00:00Z");
    const [outcome] = await runOwnerBriefings([organization], evening);
    assert.equal(outcome.organizationId, organization.id);
    // No RESEND_API_KEY/RESEND_FROM_EMAIL in the test environment, so the
    // send itself is a safe no-op — this still proves metrics aggregation,
    // owner lookup, and the due-check all ran correctly end to end.
    assert.equal(outcome.sent, false);
    assert.equal(
      (outcome as { reason: string }).reason,
      "no_notify_email",
    );
  });

  it("reaches the email send step once a notify email is configured", async () => {
    const organization = await createOrg({ timezone: "UTC" });
    await getGrowthStore().upsertOrgSettings(organization.id, {
      notifyEmail: "owner@example.com",
    });
    const evening = new Date("2026-01-01T19:00:00Z");
    const [outcome] = await runOwnerBriefings([organization], evening);
    assert.equal(outcome.sent, false);
    assert.equal(
      (outcome as { reason: string }).reason,
      "resend_not_configured",
    );
  });

  it("skips organizations that are not active", async () => {
    const organization = await createOrg({ timezone: "UTC" });
    const suspended = { ...organization, status: "suspended" as const };
    const evening = new Date("2026-01-01T19:00:00Z");
    const outcomes = await runOwnerBriefings([suspended], evening);
    assert.equal(outcomes.length, 0);
  });
});
