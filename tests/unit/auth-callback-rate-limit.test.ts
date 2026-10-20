import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/auth/callback/route";
import { enforceRateLimit } from "../../src/lib/rate-limit-response";

function callback(ip: string, token = "junk-token", locale = "en") {
  const nonce = "n".repeat(43);
  const name =
    process.env.NODE_ENV === "production"
      ? "__Host-tc_login_confirmation"
      : "tc_login_confirmation";
  return POST(
    new NextRequest("http://localhost/api/auth/callback", {
      method: "POST",
      headers: {
        "x-forwarded-for": ip,
        cookie: name + "=" + nonce,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        token: token.padEnd(43, "x"),
        locale,
        confirmation: nonce,
        confirm: "1",
      }).toString(),
    }),
  );
}

describe("magic-link callback flood protection", () => {
  it("stops processing links from one address after its budget, and not before", async () => {
    const ip = "198.51.100.7";
    for (let i = 0; i < 60; i += 1) {
      const res = await callback(ip, `junk-${i}`);
      assert.equal(res.status, 303);
      assert.doesNotMatch(res.headers.get("location") ?? "", /rate_limited/);
    }
    const refused = await callback(ip, "junk-61");
    assert.equal(refused.status, 303);
    assert.match(
      refused.headers.get("location") ?? "",
      /\/login\?error=rate_limited$/,
    );
  });

  it("keeps other addresses working and sends French users to the French sign-in", async () => {
    const other = await callback("198.51.100.8");
    assert.doesNotMatch(other.headers.get("location") ?? "", /rate_limited/);

    const ip = "198.51.100.9";
    for (let i = 0; i < 60; i += 1) await callback(ip, `x-${i}`);
    const refused = await callback(ip, "again", "fr");
    assert.match(
      refused.headers.get("location") ?? "",
      /\/fr\/connexion\?error=rate_limited$/,
    );
  });
});

describe("enforceRateLimit", () => {
  it("returns null while there is budget, then a 429 with Retry-After", async () => {
    const subject = `unit-${Date.now()}-${Math.random()}`;
    const input = { scope: "unit", subject, limit: 2, windowMs: 60_000 };
    assert.equal(await enforceRateLimit(input), null);
    assert.equal(await enforceRateLimit(input), null);
    const refused = await enforceRateLimit(input);
    assert.ok(refused);
    assert.equal(refused.status, 429);
    const retryAfter = Number(refused.headers.get("retry-after"));
    assert.ok(retryAfter >= 1 && retryAfter <= 60, `Retry-After ${retryAfter}`);
    assert.equal(refused.headers.get("cache-control"), "no-store");
    assert.deepEqual(await refused.json(), {
      error: "Too many requests. Please wait a moment and try again.",
    });
  });

  it("budgets different subjects and scopes separately", async () => {
    const base = `iso-${Date.now()}-${Math.random()}`;
    assert.equal(
      await enforceRateLimit({
        scope: "a",
        subject: base,
        limit: 1,
        windowMs: 60_000,
      }),
      null,
    );
    assert.ok(
      await enforceRateLimit({
        scope: "a",
        subject: base,
        limit: 1,
        windowMs: 60_000,
      }),
    );
    assert.equal(
      await enforceRateLimit({
        scope: "b",
        subject: base,
        limit: 1,
        windowMs: 60_000,
      }),
      null,
    );
    assert.equal(
      await enforceRateLimit({
        scope: "a",
        subject: `${base}-2`,
        limit: 1,
        windowMs: 60_000,
      }),
      null,
    );
  });
});
