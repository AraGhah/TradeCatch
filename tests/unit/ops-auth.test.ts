import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authorizeOpsRequest,
  getOpsSecret,
  guardOpsRequest,
} from "../../src/lib/ops-auth";

type TestEnv = NodeJS.ProcessEnv;

function withNodeEnv<T>(value: string, run: () => T): T {
  const env = process.env as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  env.NODE_ENV = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previous;
  }
}

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

describe("guardOpsRequest", () => {
  const tick = (headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/automations/tick", { headers });

  it("refuses an unauthorized request with 401 before auditing", async () => {
    const refusal = guardOpsRequest(tick(), "test.tick", false);
    assert.equal(refusal?.status, 401);
    assert.deepEqual(await refusal?.json(), { error: "Unauthorized" });
  });

  it("requires X-Ops-Actor on manual production requests", async () => {
    const refusal = withNodeEnv("production", () =>
      guardOpsRequest(tick(), "test.tick", true),
    );
    assert.equal(refusal?.status, 403);
    const body = (await refusal?.json()) as { error: string };
    assert.match(body.error, /X-Ops-Actor/);
  });

  it("lets an identified operator or the scheduler through in production", () => {
    withNodeEnv("production", () => {
      const operator = tick({ "x-ops-actor": "ops@tradecatch.ca" });
      assert.equal(guardOpsRequest(operator, "test.tick", true), null);
      const cron = tick({ "x-vercel-cron": "cloudflare" });
      assert.equal(guardOpsRequest(cron, "test.tick", true), null);
    });
  });

  it("does not require an actor outside production", () => {
    const refusal = withNodeEnv("development", () =>
      guardOpsRequest(tick(), "test.tick", true),
    );
    assert.equal(refusal, null);
  });

  it("defaults to the shared ops bearer check", () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.MISSED_CALL_OPS_SECRET;
    env.MISSED_CALL_OPS_SECRET = "guard-secret";
    try {
      withNodeEnv("development", () => {
        assert.equal(guardOpsRequest(tick(), "test.tick")?.status, 401);
        const signed = tick({ authorization: "Bearer guard-secret" });
        assert.equal(guardOpsRequest(signed, "test.tick"), null);
      });
    } finally {
      if (previous === undefined) delete env.MISSED_CALL_OPS_SECRET;
      else env.MISSED_CALL_OPS_SECRET = previous;
    }
  });
});
