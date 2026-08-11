import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isUpstashConfigured,
  upstashClaimIdempotencyKey,
  upstashRateLimit,
} from "../../src/lib/upstash";
import { rateLimitAsync } from "../../src/lib/rate-limit";

describe("isUpstashConfigured", () => {
  it("is false when env vars are missing", () => {
    assert.equal(isUpstashConfigured({}), false);
    assert.equal(
      isUpstashConfigured({ UPSTASH_REDIS_REST_URL: "https://example.com" }),
      false,
    );
  });

  it("is true when both URL and token are set", () => {
    assert.equal(
      isUpstashConfigured({
        UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "token",
      }),
      true,
    );
  });
});

describe("rateLimitAsync", () => {
  it("falls back to in-memory when Upstash is unset", async () => {
    const key = `async-unit-${Date.now()}-${Math.random()}`;
    const windowMs = 60_000;
    const limit = 2;
    const env = {};

    assert.equal(
      (await rateLimitAsync({ key, limit, windowMs, env })).allowed,
      true,
    );
    assert.equal(
      (await rateLimitAsync({ key, limit, windowMs, env })).allowed,
      true,
    );
    assert.equal(
      (await rateLimitAsync({ key, limit, windowMs, env })).allowed,
      false,
    );
  });
});

describe("upstash helpers without network", () => {
  it("upstashRateLimit throws when not configured", async () => {
    await assert.rejects(
      () =>
        upstashRateLimit({
          key: "x",
          limit: 1,
          windowMs: 1000,
          env: {},
        }),
      /not configured/,
    );
  });

  it("upstashClaimIdempotencyKey throws when not configured", async () => {
    await assert.rejects(
      () =>
        upstashClaimIdempotencyKey({
          key: "x",
          ttlMs: 1000,
          env: {},
        }),
      /not configured/,
    );
  });
});
