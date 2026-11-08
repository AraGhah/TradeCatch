import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeReturnPath } from "../../src/product/saas/auth/return-path";
import { signedInResponse } from "../../src/product/saas/auth/route-helpers";

describe("safeReturnPath", () => {
  it("accepts our own workspace pages, in either language", () => {
    for (const path of [
      "/app",
      "/app/referrals",
      "/app/parrainage",
      "/fr/app",
      "/fr/app/parrainage",
      "/app/leads?status=new",
    ]) {
      assert.equal(safeReturnPath(path), path);
    }
  });

  it("refuses anything that could send a customer somewhere else", () => {
    for (const bad of [
      "https://evil.example/app",
      "//evil.example/app",
      "/\\evil.example",
      "/app/../admin",
      "/app/%2e%2e/admin",
      "/app/%2E%2E%2Fadmin",
      "javascript:alert(1)",
      "/login",
      "/admin",
      "/api/auth/logout",
      "/application",
      "/app#fragment",
      "/app\n/x",
      "/app/\u0000",
      "",
      "   ",
      "app/referrals",
      "/" + "a".repeat(400),
      null,
      undefined,
      42,
      {},
    ]) {
      assert.equal(safeReturnPath(bad), null, String(bad));
    }
  });
});

describe("signing in returns to the page they were heading to", () => {
  const session = {
    ok: true as const,
    cookieValue: "cookie",
    maxAge: 3600,
    billingOnly: false,
  } as Parameters<typeof signedInResponse>[0];

  it("goes to the requested workspace page", async () => {
    const response = signedInResponse(session, "en", "/app/referrals");
    assert.deepEqual(await response.json(), { ok: true, next: "/app/referrals" });
    assert.ok(response.headers.get("set-cookie")?.includes("HttpOnly"));
  });

  it("falls back to the workspace home for an unsafe or missing destination", async () => {
    for (const next of [undefined, "https://evil.example", "//evil.example", "/admin"]) {
      assert.deepEqual(await signedInResponse(session, "en", next).json(), { ok: true, next: "/app" });
    }
    assert.deepEqual(await signedInResponse(session, "fr", "//x").json(), { ok: true, next: "/fr/app" });
  });

  it("keeps a billing-only session on billing whatever was asked for", async () => {
    const billing = { ...session, billingOnly: true } as typeof session;
    assert.deepEqual(await signedInResponse(billing, "en", "/app/referrals").json(), { ok: true, next: "/billing" });
  });
});
