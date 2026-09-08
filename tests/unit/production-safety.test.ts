import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isE2eHarness } from "../../src/lib/config";
import { getProductionSafetyIssues } from "../../src/lib/production-safety";

describe("production safety", () => {
  it("reports every unsafe production switch", () => {
    const issues = getProductionSafetyIssues({
      SAAS_DEV_LOGIN: "1",
      MISSED_CALL_SANDBOX: "1",
      MISSED_CALL_ALLOW_DEMO: "1",
      MISSED_CALL_SKIP_TWILIO_VALIDATE: "1",
      TRADECATCH_E2E: "1",
      MISSED_CALL_SMS_MODE: "DRY-RUN",
    });

    assert.deepEqual(
      issues.map(({ key }) => key),
      [
        "SAAS_DEV_LOGIN",
        "MISSED_CALL_SANDBOX",
        "MISSED_CALL_ALLOW_DEMO",
        "MISSED_CALL_SKIP_TWILIO_VALIDATE",
        "TRADECATCH_E2E",
        "MISSED_CALL_SMS_MODE",
      ],
    );
  });

  it("accepts a production-safe environment", () => {
    assert.deepEqual(
      getProductionSafetyIssues({ MISSED_CALL_SMS_MODE: "live" }),
      [],
    );
  });

  it("allows the E2E bypass only on a loopback site URL", () => {
    assert.equal(
      isE2eHarness({
        TRADECATCH_E2E: "1",
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
      }),
      true,
    );
    assert.equal(
      isE2eHarness({
        TRADECATCH_E2E: "1",
        NEXT_PUBLIC_SITE_URL: "https://tradecatch.ca",
      }),
      false,
    );
    assert.equal(
      isE2eHarness({
        TRADECATCH_E2E: "1",
        NEXT_PUBLIC_SITE_URL: "http://localhost:3100",
        VERCEL_ENV: "production",
      }),
      false,
    );
  });
});
