import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateUsage } from "../../src/product/saas/usage-metering";
import { USAGE_ALLOWANCES } from "../../src/lib/plans";

describe("usage metering", () => {
  it("matches the provisional allowances in the plan configuration", () => {
    assert.deepEqual(USAGE_ALLOWANCES, {
      starter: {
        smsSegmentsPerMonth: 500,
        voiceMinutesPerMonth: 0,
        calendars: 1,
        teamMembers: 1,
        businessLocations: 1,
      },
      growth: {
        smsSegmentsPerMonth: 1500,
        voiceMinutesPerMonth: 300,
        calendars: 1,
        teamMembers: 3,
        businessLocations: 1,
      },
      receptionist: {
        smsSegmentsPerMonth: 4000,
        voiceMinutesPerMonth: 900,
        calendars: 3,
        teamMembers: 10,
        businessLocations: 3,
      },
    });
  });

  it("flags near-limit usage without reporting over limit yet", () => {
    const snapshot = evaluateUsage("starter", "smsSegmentsPerMonth", 420);
    assert.equal(snapshot.allowance, 500);
    assert.equal(snapshot.percentUsed, 84);
    assert.equal(snapshot.nearLimit, true);
    assert.equal(snapshot.overLimit, false);
  });

  it("flags over limit at or above the allowance, never below", () => {
    assert.equal(evaluateUsage("growth", "smsSegmentsPerMonth", 1500).overLimit, true);
    assert.equal(evaluateUsage("growth", "smsSegmentsPerMonth", 1499).overLimit, false);
    assert.equal(evaluateUsage("growth", "smsSegmentsPerMonth", 1499).nearLimit, true);
  });

  it("treats any usage against a zero allowance as over limit, with no percentage", () => {
    const snapshot = evaluateUsage("starter", "voiceMinutesPerMonth", 1);
    assert.equal(snapshot.allowance, 0);
    assert.equal(snapshot.percentUsed, null);
    assert.equal(snapshot.overLimit, true);
    assert.equal(evaluateUsage("starter", "voiceMinutesPerMonth", 0).overLimit, false);
  });
});
