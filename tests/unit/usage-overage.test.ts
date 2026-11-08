import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  confirmedOverageUnits,
  createMemoryUsageStore,
  listOverages,
  recordOrganizationUsage,
  resolveOverage,
  setUsageStoreForTests,
  smsSegments,
  usageSummary,
  voiceMinutes,
} from "../../src/product/saas/usage-metering";
import { USAGE_ALLOWANCES } from "../../src/lib/plans";

const NOW = new Date("2026-11-10T12:00:00Z");

describe("usage units", () => {
  it("counts SMS segments for GSM-7 and unicode bodies", () => {
    assert.equal(smsSegments("hello"), 1);
    assert.equal(smsSegments("a".repeat(160)), 1);
    assert.equal(smsSegments("a".repeat(161)), 2);
    assert.equal(smsSegments("a".repeat(306)), 2);
    assert.equal(smsSegments("a".repeat(307)), 3);
    // French accents in the GSM-7 set stay cheap; a curly quote forces UCS-2.
    assert.equal(smsSegments("Bonjour, êtes-vous là ?".replace("ê", "è")), 1);
    assert.equal(smsSegments("it’s ".repeat(20)), 2);
    assert.equal(smsSegments("x".repeat(70) + "’"), 2);
  });

  it("rounds call minutes up and ignores empty durations", () => {
    assert.equal(voiceMinutes(1), 1);
    assert.equal(voiceMinutes(60), 1);
    assert.equal(voiceMinutes(61), 2);
    assert.equal(voiceMinutes(undefined), 0);
    assert.equal(voiceMinutes(0), 0);
  });
});

describe("usage overage confirmation", () => {
  beforeEach(() => setUsageStoreForTests(createMemoryUsageStore()));

  const meter = (
    amount: number,
    notify?: Parameters<typeof recordOrganizationUsage>[0]["notify"],
    plan: "starter" | "growth" | "receptionist" = "starter",
  ) =>
    recordOrganizationUsage({
      organizationId: "org_a",
      plan,
      metric: "smsSegmentsPerMonth",
      amount,
      now: NOW,
      notify,
    });

  it("records usage without opening anything while inside the allowance", async () => {
    await meter(USAGE_ALLOWANCES.starter.smsSegmentsPerMonth);
    assert.deepEqual(await listOverages("org_a", NOW), []);
    const [sms] = await usageSummary("org_a", "starter", NOW);
    assert.equal(sms!.used, 500);
  });

  it("opens one pending confirmation and tells the owner once", async () => {
    const notices: number[] = [];
    const notify = async (n: { used: number }) => {
      notices.push(n.used);
    };
    await meter(500, notify);
    await meter(1, notify);
    await meter(5, notify);
    const rows = await listOverages("org_a", NOW);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, "pending");
    assert.deepEqual(notices, [501]);
  });

  it("bills nothing past the allowance until the owner confirms", async () => {
    await meter(520);
    assert.equal(
      await confirmedOverageUnits("org_a", "starter", "smsSegmentsPerMonth", NOW),
      0,
    );
    const done = await resolveOverage({
      organizationId: "org_a",
      metric: "smsSegmentsPerMonth",
      decision: "confirmed",
      userId: "user_1",
      now: NOW,
    });
    assert.equal(done?.status, "confirmed");
    assert.equal(done?.resolvedByUserId, "user_1");
    await meter(10);
    assert.equal(
      await confirmedOverageUnits("org_a", "starter", "smsSegmentsPerMonth", NOW),
      30,
    );
  });

  it("a declined overage is never billable and cannot be flipped", async () => {
    await meter(520);
    await resolveOverage({
      organizationId: "org_a",
      metric: "smsSegmentsPerMonth",
      decision: "declined",
      userId: "user_1",
      now: NOW,
    });
    assert.equal(
      await resolveOverage({
        organizationId: "org_a",
        metric: "smsSegmentsPerMonth",
        decision: "confirmed",
        userId: "user_1",
        now: NOW,
      }),
      null,
    );
    assert.equal(
      await confirmedOverageUnits("org_a", "starter", "smsSegmentsPerMonth", NOW),
      0,
    );
  });

  it("cannot confirm an overage that was never opened", async () => {
    assert.equal(
      await resolveOverage({
        organizationId: "org_a",
        metric: "smsSegmentsPerMonth",
        decision: "confirmed",
        userId: "user_1",
        now: NOW,
      }),
      null,
    );
  });

  it("is per organization and per month", async () => {
    await meter(520);
    assert.deepEqual(await listOverages("org_b", NOW), []);
    const nextMonth = new Date("2026-12-02T12:00:00Z");
    assert.deepEqual(await listOverages("org_a", nextMonth), []);
  });

  it("a failing notifier never breaks metering", async () => {
    await meter(520, async () => {
      throw new Error("mail down");
    });
    assert.equal((await listOverages("org_a", NOW)).length, 1);
  });

  it("any Starter phone use is past its zero voice allowance", async () => {
    await recordOrganizationUsage({
      organizationId: "org_a",
      plan: "starter",
      metric: "voiceMinutesPerMonth",
      amount: 1,
      now: NOW,
    });
    const rows = await listOverages("org_a", NOW);
    assert.equal(rows[0]?.metric, "voiceMinutesPerMonth");
  });
});
