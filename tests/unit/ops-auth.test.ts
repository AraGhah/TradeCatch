import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authorizeOpsRequest,
  getOpsSecret,
} from "../../src/lib/ops-auth";

type TestEnv = NodeJS.ProcessEnv;

describe("ops-auth", () => {
  it("allows unauthenticated access in development when no secret is set", () => {
    const env: TestEnv = { NODE_ENV: "development" };
    assert.equal(getOpsSecret(env), null);
    const req = new Request("http://localhost/api/missed-call/leads");
    assert.equal(authorizeOpsRequest(req, env), true);
  });

  it("denies access in production when no secret is configured", () => {
    const env: TestEnv = { NODE_ENV: "production" };
    const req = new Request("http://localhost/api/missed-call/leads");
    assert.equal(authorizeOpsRequest(req, env), false);
  });

  it("accepts a matching MISSED_CALL_OPS_SECRET bearer token", () => {
    const env: TestEnv = {
      NODE_ENV: "production",
      MISSED_CALL_OPS_SECRET: "ops-secret-value",
    };
    const ok = new Request("http://localhost/api/missed-call/leads", {
      headers: { Authorization: "Bearer ops-secret-value" },
    });
    const bad = new Request("http://localhost/api/missed-call/leads", {
      headers: { Authorization: "Bearer wrong" },
    });
    assert.equal(authorizeOpsRequest(ok, env), true);
    assert.equal(authorizeOpsRequest(bad, env), false);
  });

  it("falls back to CRON_SECRET", () => {
    const env: TestEnv = {
      NODE_ENV: "production",
      CRON_SECRET: "cron-secret-value",
    };
    const req = new Request("http://localhost/api/missed-call/escalations/tick", {
      headers: { Authorization: "Bearer cron-secret-value" },
    });
    assert.equal(authorizeOpsRequest(req, env), true);
  });
});
