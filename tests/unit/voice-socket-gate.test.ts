import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { POST as relayPost } from "../../src/app/api/voice/socket/route";

/**
 * The relay's simulated-turn POST runs against real client receptionist configs
 * and returns the transfer numbers they hold. It must never be anonymous.
 */
const KEYS = [
  "NODE_ENV",
  "MISSED_CALL_OPS_SECRET",
  "CRON_SECRET",
  "MISSED_CALL_SANDBOX",
  "TRADECATCH_ENV",
  "NEXT_PUBLIC_TRADECATCH_ENV",
  "TRADECATCH_E2E",
] as const;

const env = process.env as Record<string, string | undefined>;
const saved = new Map<string, string | undefined>();

function post(headers: Record<string, string> = {}) {
  return relayPost(
    new NextRequest("http://localhost/api/voice/socket", {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: JSON.stringify({ type: "prompt", voicePrompt: "billing" }),
        toE164: "+14385597001",
      }),
    }),
  );
}

describe("voice relay sandbox gate", () => {
  beforeEach(() => {
    for (const key of KEYS) {
      saved.set(key, env[key]);
      delete env[key];
    }
  });
  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  });

  it("does not exist on real production unless the sandbox flag is set", async () => {
    env.NODE_ENV = "production";
    env.MISSED_CALL_OPS_SECRET = "ops-secret-ops-secret";
    const res = await post({ authorization: "Bearer ops-secret-ops-secret" });
    assert.equal(res.status, 404);
  });

  it("requires the ops bearer when the sandbox is on", async () => {
    // Not production, so the runtime may use its in-memory store once the
    // request is allowed through; only the gate is under test here.
    env.NODE_ENV = "test";
    env.MISSED_CALL_OPS_SECRET = "ops-secret-ops-secret";

    assert.equal((await post()).status, 401);
    assert.equal((await post({ authorization: "Bearer nope" })).status, 401);
    const ok = await post({ authorization: "Bearer ops-secret-ops-secret" });
    assert.notEqual(ok.status, 401);
    assert.notEqual(ok.status, 404);
  });

  it("denies everyone in production when no ops secret is configured", async () => {
    env.NODE_ENV = "production";
    env.MISSED_CALL_SANDBOX = "1";
    assert.equal((await post()).status, 401);
  });
});
