import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { signState } from "../../src/product/scheduling/crypto";
import { buildGoogleAuthUrl, readOAuthState } from "../../src/product/scheduling/google";

const SECRET = "calendar-state-test-secret";
const NOW = Date.parse("2026-10-16T18:00:00.000Z");

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of ["AUTH_SECRET", "GOOGLE_CALENDAR_CLIENT_ID"]) saved[key] = process.env[key];
  process.env.AUTH_SECRET = SECRET;
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "client-id";
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function stateOf(url: string): string {
  const state = new URL(url).searchParams.get("state");
  assert.ok(state);
  return state;
}

describe("Google Calendar OAuth state", () => {
  it("names the business and the person who started the flow", () => {
    const { url } = buildGoogleAuthUrl("org_1", "usr_1", NOW);
    assert.deepEqual(readOAuthState(stateOf(url), NOW + 1000), { organizationId: "org_1", userId: "usr_1" });
  });

  it("is different on every request and lasts ten minutes", () => {
    const a = buildGoogleAuthUrl("org_1", "usr_1", NOW).state;
    const b = buildGoogleAuthUrl("org_1", "usr_1", NOW).state;
    assert.notEqual(a, b);
    assert.ok(readOAuthState(a, NOW + 9 * 60_000));
    assert.equal(readOAuthState(a, NOW + 10 * 60_000 + 1), null);
  });

  it("rejects a state that was edited to name another person or business", () => {
    const state = buildGoogleAuthUrl("org_1", "usr_1", NOW).state;
    const [body, mac] = state.split(".");
    const edited = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    for (const change of [{ userId: "usr_2" }, { organizationId: "org_2" }]) {
      const forged = Buffer.from(JSON.stringify({ ...edited, ...change })).toString("base64url");
      assert.equal(readOAuthState(`${forged}.${mac}`, NOW + 1000), null);
    }
  });

  it("rejects a state signed with a different secret", () => {
    const foreign = signState(JSON.stringify({ organizationId: "org_1", userId: "usr_1", exp: NOW + 60_000 }), "other");
    assert.equal(readOAuthState(foreign, NOW), null);
  });

  it("rejects a correctly signed state that does not say who it is for", () => {
    const old = signState(JSON.stringify({ organizationId: "org_1", exp: NOW + 60_000, nonce: "n" }), SECRET);
    assert.equal(readOAuthState(old, NOW), null);
  });

  it("returns null, not an exception, for malformed input", () => {
    for (const state of ["", "x", "a.b", "a.b.c", `${Buffer.from("not json").toString("base64url")}.sig`]) {
      assert.equal(readOAuthState(state, NOW), null, state);
    }
    const garbage = signState("not json", SECRET);
    assert.equal(readOAuthState(garbage, NOW), null);
  });
});
