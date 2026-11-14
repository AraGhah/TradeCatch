import "../support/next-request-context";
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { withRequest } from "../support/next-request-context";
import { GET as refreshGet, POST as refreshPost } from "../../src/app/api/auth/refresh/route";
import { POST as logoutPost } from "../../src/app/api/auth/logout/route";
import { signAdminJwt, verifyAdminJwt } from "../../src/product/saas/auth/admin-jwt";
import { b64url, signJwt, unverifiedExpiry, verifyJwt } from "../../src/product/saas/auth/jwt";
import { completePassword, issuePasswordToken } from "../../src/product/saas/auth/password-auth";
import {
  issueSessionTokens,
  REFRESH_REUSE_GRACE_MS,
  refreshSession,
} from "../../src/product/saas/auth/refresh-token";
import { startSessionForUser } from "../../src/product/saas/auth/session-start";
import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  ACCESS_TOKEN_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  signSessionClaims,
  verifySessionClaims,
} from "../../src/product/saas/auth/session-token";
import { hashToken } from "../../src/product/saas/ids";
import { getSaasStore, resetSaasRuntimeForTests } from "../../src/product/saas/runtime";
import { requireTenantContext } from "../../src/product/saas/tenant";
import { getSecurityService, resetSecurityRuntimeForTests } from "../../src/product/security/runtime";

const secret = "auth-session-tokens-secret-at-least-32-chars";
const GOOD = "Copper-Pipe-Kettle-82";
const saved = { AUTH_SECRET: process.env.AUTH_SECRET, NODE_ENV: process.env.NODE_ENV };

let counter = 0;
async function newAccount() {
  counter += 1;
  const email = `tokens-${Date.now()}-${counter}@example.test`;
  const created = await getSaasStore().createOrganizationWithOwner({
    name: `Tokens ${counter}`,
    ownerEmail: email,
    ownerName: "Owner",
    locale: "en",
    plan: "essential",
  });
  return { email, ...created };
}

async function signedIn() {
  const account = await newAccount();
  const started = await startSessionForUser({ user: account.user });
  assert.ok(started.ok);
  if (!started.ok) throw new Error("unreachable");
  assert.ok(started.tokens.refreshToken);
  return { ...account, started, refresh: started.tokens.refreshToken! };
}

function decode(token: string) {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
}

function req(method: string, path: string, cookie = "", headers: Record<string, string> = {}) {
  return new NextRequest(`https://tradecatch.test${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...headers },
  });
}

beforeEach(() => {
  process.env.AUTH_SECRET = secret;
  (process.env as { NODE_ENV?: string }).NODE_ENV = "development";
  resetSaasRuntimeForTests();
  resetSecurityRuntimeForTests();
});
afterEach(() => mock.restoreAll());
after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetSaasRuntimeForTests();
});

describe("access token (JWT)", () => {
  it("is a standard HS256 JWT with issuer, audience, subject, issued-at, expiry and an id", async () => {
    const { started, user, organization } = await signedIn();
    const token = started.cookieValue;
    const header = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"));
    assert.deepEqual(header, { alg: "HS256", typ: "JWT" });
    const claims = decode(token);
    assert.equal(claims.iss, ACCESS_TOKEN_ISSUER);
    assert.equal(claims.aud, ACCESS_TOKEN_AUDIENCE);
    assert.equal(claims.sub, user.id);
    assert.equal(claims.oid, organization.id);
    assert.equal(typeof claims.jti, "string");
    assert.equal(typeof claims.iat, "number");
    assert.ok(started.sessionId.startsWith("ses_"));
    assert.equal(claims.sid, started.sessionId);
    assert.deepEqual(await verifySessionClaims(token, secret), {
      sid: started.sessionId,
      uid: user.id,
      oid: organization.id,
      plan: "essential",
      exp: claims.exp,
    });
  });

  it("is short-lived: at most 15 minutes, while the sign-in itself lasts 14 days", async () => {
    const { started } = await signedIn();
    const claims = decode(started.cookieValue) as { iat: number; exp: number };
    assert.ok(claims.exp - claims.iat <= ACCESS_TOKEN_TTL_SECONDS);
    assert.equal(ACCESS_TOKEN_TTL_SECONDS, 15 * 60);
    assert.ok(started.maxAge <= ACCESS_TOKEN_TTL_SECONDS);
    assert.ok(started.tokens.refreshMaxAge > 13 * 24 * 3600);
    assert.ok(started.tokens.refreshMaxAge <= SESSION_TTL_SECONDS);
  });

  it("rejects a wrong secret, tampering, expiry, a future issue time and an over-long life", async () => {
    const now = Date.now();
    const base = { sid: "ses_1", uid: "usr_1", oid: "org_1", plan: "essential" as const };
    const token = await signSessionClaims({ ...base, exp: Math.floor(now / 1000) + 600 }, secret, now);
    assert.ok(await verifySessionClaims(token, secret, now));
    assert.equal(await verifySessionClaims(token, "another-secret-another-secret-123456", now), null);
    // Expired.
    assert.equal(await verifySessionClaims(token, secret, now + 601_000), null);
    // Flip a payload character: the signature no longer matches.
    const [h, p, s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...decode(token), oid: "org_other" })).toString("base64url");
    assert.equal(await verifySessionClaims(`${h}.${forged}.${s}`, secret, now), null);
    assert.ok(p);
    // Issued in the future.
    const future = await signSessionClaims({ ...base, exp: Math.floor(now / 1000) + 9000 }, secret, now + 3_600_000);
    assert.equal(await verifySessionClaims(future, secret, now), null);
    // A token claiming a year of life is refused even though it is signed.
    const long = await signSessionClaims({ ...base, exp: Math.floor(now / 1000) + 365 * 86400 }, secret, now);
    assert.equal(await verifySessionClaims(long, secret, now), null);
  });

  it("rejects a wrong issuer or audience even when the signature is valid", async () => {
    const now = Math.floor(Date.now() / 1000);
    const good = {
      iss: ACCESS_TOKEN_ISSUER,
      aud: ACCESS_TOKEN_AUDIENCE,
      sub: "usr_1",
      sid: "ses_1",
      oid: "org_1",
      plan: "essential",
      iat: now,
      exp: now + 600,
      jti: "j1",
    };
    assert.ok(await verifySessionClaims(await signJwt(good, secret, "access-jwt"), secret));
    for (const bad of [{ iss: "evil" }, { aud: "tradecatch-admin" }, { aud: undefined }, { sub: "" }, { plan: "root" }]) {
      const token = await signJwt({ ...good, ...bad }, secret, "access-jwt");
      assert.equal(await verifySessionClaims(token, secret), null, JSON.stringify(bad));
    }
  });

  it('refuses alg "none", other algorithms, extra header fields and malformed tokens', async () => {
    const { started } = await signedIn();
    const [, payload, sig] = started.cookieValue.split(".");
    const enc = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));
    for (const header of [
      { alg: "none", typ: "JWT" },
      { alg: "HS512", typ: "JWT" },
      { alg: "RS256", typ: "JWT" },
      { alg: "HS256", typ: "JWT", kid: "x" },
      { alg: "HS256" },
    ]) {
      assert.equal(await verifySessionClaims(`${enc(header)}.${payload}.${sig}`, secret), null, JSON.stringify(header));
      assert.equal(await verifySessionClaims(`${enc(header)}.${payload}.`, secret), null);
    }
    for (const junk of ["", "a", "a.b", "a.b.c.d", "...", `${started.cookieValue}x`, "x".repeat(10_000)]) {
      assert.equal(await verifySessionClaims(junk, secret), null);
      assert.equal(await verifyJwt(junk, secret, "access-jwt"), null);
    }
  });

  it("is not interchangeable with the administrator token, in either direction", async () => {
    const { started, user } = await signedIn();
    assert.equal(await verifyAdminJwt(started.cookieValue, secret), null);
    const adminToken = await signAdminJwt({ sub: user.id, sid: started.sessionId }, secret);
    assert.equal(await verifySessionClaims(adminToken, secret), null);
  });

  it("exposes its expiry for routing without trusting it", async () => {
    const { started } = await signedIn();
    assert.equal(unverifiedExpiry(started.cookieValue), decode(started.cookieValue).exp);
    for (const junk of [undefined, "", "a.b", "a.!!.c", "x".repeat(9000)]) assert.equal(unverifiedExpiry(junk), null);
  });
});

describe("refresh token rotation", () => {
  it("stores only a hash of the refresh token, never the token", async () => {
    const { refresh } = await signedIn();
    const store = getSaasStore();
    assert.equal(await store.findRefreshToken(refresh), null);
    const row = await store.findRefreshToken(hashToken(refresh));
    assert.ok(row);
    assert.equal(JSON.stringify(row).includes(refresh), false);
    assert.equal(row.rotatedAt, undefined);
  });

  it("exchanges a refresh token for a new access token and a NEW refresh token", async () => {
    const { refresh, started, user } = await signedIn();
    const result = await refreshSession({ rawToken: refresh });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.notEqual(result.tokens.refreshToken, refresh);
    assert.notEqual(result.tokens.accessToken, started.cookieValue);
    const claims = await verifySessionClaims(result.tokens.accessToken, secret);
    assert.equal(claims?.uid, user.id);
    assert.equal(claims?.sid, started.sessionId, "the same sign-in continues");
    const old = await getSaasStore().findRefreshToken(hashToken(refresh));
    assert.ok(old?.rotatedAt, "the used token is marked as rotated");
    // The new refresh token keeps working.
    assert.ok((await refreshSession({ rawToken: result.tokens.refreshToken! })).ok);
  });

  it("allows the same token twice within a few seconds (two tabs), but not after the grace period", async () => {
    const { refresh, started } = await signedIn();
    const now = Date.now();
    assert.ok((await refreshSession({ rawToken: refresh, nowMs: now })).ok);
    assert.ok((await refreshSession({ rawToken: refresh, nowMs: now + 2_000 })).ok, "parallel tab");
    const late = await refreshSession({ rawToken: refresh, nowMs: now + REFRESH_REUSE_GRACE_MS + 5_000 });
    assert.deepEqual(late, { ok: false, error: "reused" });
    // Theft response: the whole sign-in ends, and it is written to the audit log.
    assert.ok((await getSaasStore().getSession(started.sessionId))?.revokedAt);
    const audit = await getSecurityService().listAudit();
    assert.ok(audit.some((row) => row.action === "refresh_token_reuse_detected" && row.target === started.sessionId));
  });

  it("after theft is detected, the thief and the owner both have to sign in again", async () => {
    const { refresh, started } = await signedIn();
    const now = Date.now();
    const rotated = await refreshSession({ rawToken: refresh, nowMs: now });
    assert.ok(rotated.ok);
    if (!rotated.ok) return;
    // Replay of the stolen old token long after the owner already rotated it.
    assert.equal((await refreshSession({ rawToken: refresh, nowMs: now + 120_000 })).ok, false);
    assert.equal((await refreshSession({ rawToken: rotated.tokens.refreshToken!, nowMs: now + 121_000 })).ok, false);
    assert.ok((await getSaasStore().getSession(started.sessionId))?.revokedAt);
  });

  it("refuses unknown, malformed, expired and revoked sessions", async () => {
    const { refresh, started } = await signedIn();
    for (const raw of ["", "short", "x".repeat(43), "!".repeat(43), `${refresh}x`]) {
      assert.deepEqual(await refreshSession({ rawToken: raw }), { ok: false, error: "invalid" }, raw);
    }
    assert.deepEqual(
      await refreshSession({ rawToken: refresh, nowMs: Date.now() + (SESSION_TTL_SECONDS + 60) * 1000 }),
      { ok: false, error: "invalid" },
    );
    await getSaasStore().revokeSession(started.sessionId, new Date().toISOString());
    assert.deepEqual(await refreshSession({ rawToken: refresh }), { ok: false, error: "invalid" });
  });

  it("will not renew without the server secret", async () => {
    const { refresh } = await signedIn();
    delete process.env.AUTH_SECRET;
    assert.deepEqual(await refreshSession({ rawToken: refresh }), { ok: false, error: "unavailable" });
  });

  it("stops renewing for a business that is no longer active, except for billing recovery", async () => {
    const { refresh, organization } = await signedIn();
    await getSaasStore().updateOrganization(organization.id, { status: "suspended" });
    const result = await refreshSession({ rawToken: refresh });
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.billingOnly, true);
  });

  it("still signs people in before migration 039 is applied, with a longer access token and a logged gap", async () => {
    mock.method(console, "error", () => {});
    const account = await newAccount();
    const store = getSaasStore();
    mock.method(store, "createRefreshToken", async () => {
      throw new Error('relation "tc_refresh_tokens" does not exist');
    });
    const started = await startSessionForUser({ user: account.user });
    assert.ok(started.ok);
    if (!started.ok) return;
    assert.equal(started.tokens.refreshToken, undefined);
    assert.ok(started.maxAge > ACCESS_TOKEN_TTL_SECONDS, "falls back to the old session-long token");
    assert.ok(await verifySessionClaims(started.cookieValue, secret));
  });
});

describe("renewing and signing out over HTTP", () => {
  it("POST /api/auth/refresh sets new HttpOnly cookies and never puts a token in the body", async () => {
    const { refresh } = await signedIn();
    const response = await refreshPost(req("POST", "/api/auth/refresh", `tc_refresh=${refresh}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    const body = (await response.json()) as { ok?: boolean; accessExpiresAt?: unknown };
    assert.equal(body.ok, true);
    assert.equal(typeof body.accessExpiresAt, "number");
    assert.equal(Object.keys(body).sort().join(), "accessExpiresAt,ok");
    const cookies = response.headers.getSetCookie();
    const access = cookies.find((c) => c.startsWith("tc_session="))!;
    const next = cookies.find((c) => c.startsWith("tc_refresh="))!;
    for (const cookie of [access, next]) {
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=lax/i);
    }
    assert.match(next, /Path=\/api\/auth/);
    assert.ok(!next.includes(`tc_refresh=${refresh};`), "the refresh token was rotated");
    assert.ok(!JSON.stringify(body).includes(next.split(";")[0]!.slice("tc_refresh=".length)));
  });

  it("marks the cookies Secure in production", async () => {
    const { refresh } = await signedIn();
    (process.env as { NODE_ENV?: string }).NODE_ENV = "production";
    const response = await refreshPost(req("POST", "/api/auth/refresh", `tc_refresh=${refresh}`));
    for (const cookie of response.headers.getSetCookie()) assert.match(cookie, /Secure/i, cookie);
  });

  it("answers 401 and clears the cookies when there is nothing valid to renew", async () => {
    for (const cookie of ["", "tc_refresh=garbage", `tc_refresh=${"a".repeat(43)}`]) {
      const response = await refreshPost(req("POST", "/api/auth/refresh", cookie));
      assert.equal(response.status, 401, cookie);
      const cleared = response.headers.getSetCookie();
      assert.ok(cleared.some((c) => c.startsWith("tc_session=;") || /tc_session=;/.test(c)));
      assert.ok(cleared.some((c) => /tc_refresh=;/.test(c)));
    }
  });

  it("GET /api/auth/refresh renews and returns to the page, but never to another site", async () => {
    const { refresh } = await signedIn();
    const ok = await refreshGet(req("GET", "/api/auth/refresh?next=%2Fapp%2Fleads%3Fstatus%3Dnew", `tc_refresh=${refresh}`));
    assert.equal(ok.status, 303);
    assert.equal(new URL(ok.headers.get("location")!).pathname + new URL(ok.headers.get("location")!).search, "/app/leads?status=new");
    assert.ok(ok.headers.getSetCookie().some((c) => c.startsWith("tc_session=") && !/tc_session=;/.test(c)));

    const second = await signedIn();
    for (const evil of ["https://evil.example/app", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      const response = await refreshGet(
        req("GET", `/api/auth/refresh?next=${encodeURIComponent(evil)}`, `tc_refresh=${second.refresh}`),
      );
      assert.equal(response.status, 303);
      const location = new URL(response.headers.get("location")!);
      assert.equal(location.origin, "https://tradecatch.test", evil);
      assert.equal(location.pathname, "/app", evil);
      // The refresh token rotates on every use, so carry the new one forward.
      const rotated = response.headers.getSetCookie().find((c) => c.startsWith("tc_refresh="))!;
      second.refresh = rotated.split(";")[0]!.slice("tc_refresh=".length);
    }
  });

  it("GET /api/auth/refresh sends a signed-out visitor to the login page with the page they wanted", async () => {
    const response = await refreshGet(req("GET", "/api/auth/refresh?next=%2Ffr%2Fapp%2Fparrainage"));
    assert.equal(response.status, 303);
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.pathname, "/fr/connexion");
    assert.equal(location.searchParams.get("next"), "/fr/app/parrainage");
    const admin = await refreshGet(req("GET", "/api/auth/refresh?next=%2Fadmin%2Fsupport"));
    const adminLocation = new URL(admin.headers.get("location")!);
    assert.equal(adminLocation.pathname, "/login");
    assert.equal(adminLocation.searchParams.get("next"), null, "admin pages are not a post-login destination for customers");
  });

  it("an access token alone no longer works after sign-out, and the refresh token is dead too", async () => {
    const { started, refresh } = await signedIn();
    const cookie = `tc_session=${started.cookieValue}; tc_refresh=${refresh}`;
    const before = await withRequest(req("GET", "/app", cookie), () => requireTenantContext());
    assert.equal(before.ok, true);

    const out = await withRequest(req("POST", "/api/auth/logout", cookie), () => logoutPost(req("POST", "/api/auth/logout", cookie)));
    assert.equal(out.status, 200);
    const cleared = out.headers.getSetCookie();
    for (const name of ["tc_session", "tc_refresh", "tc_admin"]) {
      assert.ok(cleared.some((c) => new RegExp(`${name}=;`).test(c)), `${name} cleared`);
    }

    const after = await withRequest(req("GET", "/app", cookie), () => requireTenantContext());
    assert.equal(after.ok, false);
    if (!after.ok) assert.equal(after.status, 401);
    assert.deepEqual(await refreshSession({ rawToken: refresh }), { ok: false, error: "invalid" });
    const audit = await getSecurityService().listAudit();
    assert.ok(audit.some((row) => row.action === "logout" && row.target === started.sessionId));
  });

  it("signs out even when only the refresh cookie is left (the access token already expired)", async () => {
    const { started, refresh } = await signedIn();
    const cookie = `tc_refresh=${refresh}`;
    const out = await withRequest(req("POST", "/api/auth/logout", cookie), () => logoutPost(req("POST", "/api/auth/logout", cookie)));
    assert.equal(out.status, 200);
    assert.ok((await getSaasStore().getSession(started.sessionId))?.revokedAt);
  });

  it("signing out is harmless when nobody is signed in", async () => {
    const out = await withRequest(req("POST", "/api/auth/logout"), () => logoutPost(req("POST", "/api/auth/logout")));
    assert.equal(out.status, 200);
  });
});

describe("a password reset ends every sign-in", () => {
  it("signs out the access token and the refresh token of every device", async () => {
    const a = await signedIn();
    const b = await startSessionForUser({ user: a.user });
    assert.ok(b.ok);
    if (!b.ok) return;
    const link = await issuePasswordToken({ userId: a.user.id, kind: "reset" });
    const done = await completePassword({ rawToken: link, password: GOOD });
    assert.equal(done.ok, true);

    for (const [access, refresh] of [
      [a.started.cookieValue, a.refresh],
      [b.cookieValue, b.tokens.refreshToken!],
    ] as const) {
      const cookie = `tc_session=${access}`;
      const ctx = await withRequest(req("GET", "/app", cookie), () => requireTenantContext());
      assert.equal(ctx.ok, false, "the old access token no longer opens the app");
      assert.deepEqual(await refreshSession({ rawToken: refresh }), { ok: false, error: "invalid" });
    }
  });
});

describe("issuing tokens", () => {
  it("refresh lifetime never exceeds the session", async () => {
    const { started } = await signedIn();
    const session = (await getSaasStore().getSession(started.sessionId))!;
    const issued = await issueSessionTokens({ session, plan: "essential", secret });
    const row = await getSaasStore().findRefreshToken(hashToken(issued.refreshToken!));
    assert.equal(row?.expiresAt, session.expiresAt);
  });
});
