import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSecurityWarnings } from "../../src/lib/security-warnings";

const LONG = "x".repeat(40);
const GOOD = { AUTH_SECRET: LONG, CF_TRUSTED: "1", UPSTASH_REDIS_REST_URL: "https://r.example", UPSTASH_REDIS_REST_TOKEN: "t" };
const keys = (env: Record<string, string | undefined>) => getSecurityWarnings(env).map((w) => w.key);

describe("getSecurityWarnings", () => {
  it("is silent for a well-configured deployment", () => {
    assert.deepEqual(getSecurityWarnings(GOOD), []);
  });

  it("flags a missing, borrowed or short signing secret", () => {
    assert.deepEqual(keys({ ...GOOD, AUTH_SECRET: undefined }), ["AUTH_SECRET"]);
    assert.deepEqual(keys({ ...GOOD, AUTH_SECRET: undefined, MISSED_CALL_OPS_SECRET: LONG }), ["AUTH_SECRET"]);
    assert.deepEqual(keys({ ...GOOD, AUTH_SECRET: "short" }), ["AUTH_SECRET"]);
    assert.match(getSecurityWarnings({ ...GOOD, AUTH_SECRET: undefined, MISSED_CALL_OPS_SECRET: LONG })[0].message, /operations secret/);
  });

  it("flags untrusted client addresses unless a trusted proxy is declared", () => {
    const withoutTrust: Record<string, string | undefined> = { ...GOOD, CF_TRUSTED: undefined };
    assert.deepEqual(keys(withoutTrust), ["CF_TRUSTED"]);
    for (const trust of [{ CF_TRUSTED: "1" }, { TRUST_PROXY_HEADERS: "1" }, { VERCEL: "1" }, { VERCEL_ENV: "production" }]) {
      assert.deepEqual(keys({ ...withoutTrust, ...trust }), [], JSON.stringify(trust));
    }
    assert.deepEqual(keys({ ...withoutTrust, CF_TRUSTED: "0" }), ["CF_TRUSTED"]);
  });

  it("flags limits that are only per instance, and accepts either shared store", () => {
    const base = { AUTH_SECRET: LONG, CF_TRUSTED: "1" };
    assert.deepEqual(keys(base), ["RATE_LIMIT_STORE"]);
    assert.deepEqual(keys({ ...base, DATABASE_URL: "postgres://u:p@h/d" }), ["RATE_LIMIT_STORE"]);
    assert.deepEqual(keys({ ...base, DATABASE_URL: "postgres://u:p@h/d", SAAS_DURABLE_STORE: "1" }), []);
    assert.deepEqual(keys({ ...base, UPSTASH_REDIS_REST_URL: "https://r.example", UPSTASH_REDIS_REST_TOKEN: "t" }), []);
  });

  it("never includes a configured value in the report", () => {
    const secret = "do-not-print-this-secret-value-0123456789";
    const url = `${"postgres"}://u:hunter2@h/d`;
    const report = JSON.stringify(getSecurityWarnings({ AUTH_SECRET: secret.slice(0, 10), DATABASE_URL: url }));
    assert.doesNotMatch(report, /hunter2|do-not-print/);
  });
});
