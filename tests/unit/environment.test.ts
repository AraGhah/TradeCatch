import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDemoModeVisible,
  isOpsSandboxEnabled,
  isRealProductionRuntime,
  isStagingRuntime,
  resolveTradeCatchEnv,
  shouldUseDryRunSms,
} from "../../src/lib/environment";
import {
  authorizeStagingBasicAuth,
  getStagingBasicCredentials,
} from "../../src/lib/staging-access";
import { getProductionSafetyIssues } from "../../src/lib/production-safety";
import { createTwilioSmsPort } from "../../src/product/missed-call/twilio";

describe("TradeCatch environment isolation", () => {
  it("resolves explicit staging over NODE_ENV=production", () => {
    assert.equal(
      resolveTradeCatchEnv({
        NODE_ENV: "production",
        TRADECATCH_ENV: "staging",
      }),
      "staging",
    );
    assert.equal(
      isStagingRuntime({
        NODE_ENV: "production",
        TRADECATCH_ENV: "staging",
      }),
      true,
    );
    assert.equal(
      isRealProductionRuntime({
        NODE_ENV: "production",
        TRADECATCH_ENV: "staging",
      }),
      false,
    );
  });

  it("infers staging from hostname when TRADECATCH_ENV is unset", () => {
    assert.equal(
      resolveTradeCatchEnv({
        NODE_ENV: "production",
        NEXT_PUBLIC_SITE_URL: "https://staging.tradecatch.ca",
      }),
      "staging",
    );
  });

  it("treats live production as real production", () => {
    assert.equal(
      isRealProductionRuntime({
        NODE_ENV: "production",
        TRADECATCH_ENV: "production",
        NEXT_PUBLIC_SITE_URL: "https://tradecatch.ca",
      }),
      true,
    );
    assert.equal(
      isDemoModeVisible({
        NODE_ENV: "production",
        TRADECATCH_ENV: "production",
      }),
      false,
    );
  });

  it("enables sandbox and dry-run SMS on staging by default", () => {
    const staging = {
      NODE_ENV: "production",
      TRADECATCH_ENV: "staging",
    };
    assert.equal(isOpsSandboxEnabled(staging), true);
    assert.equal(shouldUseDryRunSms(staging), true);
    assert.equal(isDemoModeVisible({ ...staging, NEXT_PUBLIC_DEMO_MODE: "1" }), true);
  });

  it("allows live SMS on staging only when explicitly requested", () => {
    assert.equal(
      shouldUseDryRunSms({
        NODE_ENV: "production",
        TRADECATCH_ENV: "staging",
        MISSED_CALL_SMS_MODE: "live",
        TWILIO_ACCOUNT_SID: "ACstaging",
        TWILIO_AUTH_TOKEN: "token",
      }),
      false,
    );
  });

  it("uses the dry-run SMS adapter on staging builds", async () => {
    const port = createTwilioSmsPort({
      NODE_ENV: "production",
      TRADECATCH_ENV: "staging",
      MISSED_CALL_SMS_MODE: "dry-run",
    });
    const result = await port.send({
      toE164: "+15145550111",
      fromE164: "+15145550100",
      body: "Bonjour — message de test staging",
    });
    assert.match(result.sid, /^SM_dry_/);
  });

  it("does not fail production safety checks when evaluated alone on staging flags", () => {
    // Callers must gate with isRealProductionRuntime(); staging may set these.
    const issues = getProductionSafetyIssues({
      MISSED_CALL_SANDBOX: "1",
      MISSED_CALL_ALLOW_DEMO: "1",
      MISSED_CALL_SMS_MODE: "dry-run",
    });
    assert.ok(issues.length >= 3);
    assert.equal(
      isRealProductionRuntime({
        NODE_ENV: "production",
        TRADECATCH_ENV: "staging",
      }),
      false,
    );
  });
});

describe("staging Basic access gate", () => {
  it("is inactive when credentials are unset", () => {
    assert.equal(getStagingBasicCredentials({}), null);
    assert.equal(authorizeStagingBasicAuth(null, {}), true);
  });

  it("accepts matching Basic credentials", () => {
    const env = {
      STAGING_BASIC_AUTH_USER: "demo",
      STAGING_BASIC_AUTH_PASSWORD: "s3cret",
    };
    const header = `Basic ${Buffer.from("demo:s3cret").toString("base64")}`;
    assert.equal(authorizeStagingBasicAuth(header, env), true);
    assert.equal(
      authorizeStagingBasicAuth(
        `Basic ${Buffer.from("demo:wrong").toString("base64")}`,
        env,
      ),
      false,
    );
  });
});
