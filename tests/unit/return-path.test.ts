import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPathname } from "../../src/i18n/pathname";
import {
  isSignedInPage,
  renewalRedirectPath,
  safeReturnPath,
  safeSignedInPath,
} from "../../src/product/saas/auth/return-path";
import { signSessionClaims } from "../../src/product/saas/auth/session-token";
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
    cookieValue: "access",
    maxAge: 900,
    billingOnly: false,
    isPlatformAdmin: false,
    tokens: {
      accessToken: "access",
      accessMaxAge: 900,
      accessExpiresAt: 0,
      refreshToken: "refresh",
      refreshMaxAge: 3600,
    },
  } as Parameters<typeof signedInResponse>[0];

  it("goes to the requested workspace page", async () => {
    const response = signedInResponse(session, "en", "/app/referrals");
    assert.deepEqual(await response.json(), { ok: true, next: "/app/referrals" });
    const cookies = response.headers.getSetCookie();
    const access = cookies.find((c) => c.startsWith("tc_session="));
    const refresh = cookies.find((c) => c.startsWith("tc_refresh="));
    assert.ok(access?.includes("HttpOnly") && /SameSite=lax/i.test(access) && access.includes("Path=/;"));
    assert.ok(refresh?.includes("HttpOnly") && /SameSite=lax/i.test(refresh));
    assert.ok(refresh?.includes("Path=/api/auth"), "the refresh token is only sent to the sign-in endpoints");
    assert.equal(JSON.stringify(await signedInResponse(session, "en").json()).includes("refresh"), false);
  });

  it("sends an administrator to the admin dashboard and a customer to their workspace", async () => {
    const admin = { ...session, isPlatformAdmin: true } as typeof session;
    assert.deepEqual(await signedInResponse(admin, "en").json(), { ok: true, next: "/admin" });
    assert.deepEqual(await signedInResponse(admin, "fr").json(), { ok: true, next: "/fr/admin" });
    assert.deepEqual(await signedInResponse(session, "en").json(), { ok: true, next: "/app" });
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

describe("renewing an expired sign-in before a signed-in page renders", () => {
  const secret = "return-path-test-secret-at-least-32-chars";
  const fresh = (nowMs: number, ttl = 900) =>
    signSessionClaims(
      { sid: "ses_1", uid: "usr_1", oid: "org_1", plan: "essential", exp: Math.floor(nowMs / 1000) + ttl },
      secret,
      nowMs,
    );

  it("lets a page through while the access token is fresh", async () => {
    const now = Date.now();
    assert.equal(renewalRedirectPath("/app/leads", "", await fresh(now), now), null);
    assert.equal(renewalRedirectPath("/admin", "", await fresh(now), now), null);
  });

  it("renews first when the access token is missing, expired or about to expire, and comes back to the page", async () => {
    const now = Date.now();
    assert.equal(
      renewalRedirectPath("/app/referrals", "", undefined, now),
      "/api/auth/refresh?next=%2Fapp%2Freferrals",
    );
    assert.equal(
      renewalRedirectPath("/app/leads", "?status=new", await fresh(now - 2_000_000), now),
      "/api/auth/refresh?next=%2Fapp%2Fleads%3Fstatus%3Dnew",
    );
    assert.equal(
      renewalRedirectPath("/fr/app/parrainage", "", await fresh(now, 2), now),
      "/api/auth/refresh?next=%2Ffr%2Fapp%2Fparrainage",
    );
    assert.equal(renewalRedirectPath("/admin/support", "", "junk", now), "/api/auth/refresh?next=%2Fadmin%2Fsupport");
    assert.equal(renewalRedirectPath("/billing", "", undefined, now), "/api/auth/refresh?next=%2Fbilling");
  });

  it("leaves public pages alone and never carries an unsafe destination", () => {
    for (const path of ["/", "/pricing", "/login", "/fr/connexion", "/application/x", "/api/app/leads"]) {
      assert.equal(renewalRedirectPath(path, "", undefined), null, path);
    }
    // Still a workspace page, so it renews, but the odd path is not carried along.
    assert.equal(renewalRedirectPath("/app//evil.example", "", undefined), "/api/auth/refresh");
    assert.equal(isSignedInPage("/app/%2e%2e/admin"), true);
    assert.equal(safeSignedInPath("/app/%2e%2e/admin"), null);
  });

  it("accepts the admin and billing areas as places to come back to, but nothing else", () => {
    for (const ok of ["/admin", "/admin/support", "/fr/admin", "/billing", "/fr/facturation", "/app/x?y=1"]) {
      assert.equal(safeSignedInPath(ok), ok);
    }
    for (const bad of ["/billing/x", "//evil", "/login", "https://evil.example/admin", "/admin#x"]) {
      assert.equal(safeSignedInPath(bad), null, bad);
    }
  });

  it("uses the same login addresses as the rest of the site", () => {
    assert.equal(getPathname({ href: "/login", locale: "en" }), "/login");
    assert.equal(getPathname({ href: "/login", locale: "fr" }), "/fr/connexion");
  });
});
