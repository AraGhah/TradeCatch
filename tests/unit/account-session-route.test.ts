import "../support/next-request-context";
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { withRequest } from "../support/next-request-context";
import { GET as sessionGet } from "../../src/app/api/auth/session/route";
import {
  peekRefreshToken,
  refreshSession,
  REFRESH_REUSE_GRACE_MS,
} from "../../src/product/saas/auth/refresh-token";
import { startSessionForUser } from "../../src/product/saas/auth/session-start";
import { hashToken } from "../../src/product/saas/ids";
import { getSaasStore, resetSaasRuntimeForTests } from "../../src/product/saas/runtime";
import { resetSecurityRuntimeForTests } from "../../src/product/security/runtime";

const secret = "account-session-route-secret-at-least-32-chars";
const ADMIN_EMAIL = "kan25-admin@example.test";
const saved = {
  AUTH_SECRET: process.env.AUTH_SECRET,
  SESSION_SECRET: process.env.SESSION_SECRET,
  MISSED_CALL_OPS_SECRET: process.env.MISSED_CALL_OPS_SECRET,
  TRADECATCH_ADMIN_EMAILS: process.env.TRADECATCH_ADMIN_EMAILS,
  NODE_ENV: process.env.NODE_ENV,
};

let counter = 0;
async function account(email?: string) {
  counter += 1;
  const created = await getSaasStore().createOrganizationWithOwner({
    name: `Profile ${counter}`,
    ownerEmail: email ?? `profile-${Date.now()}-${counter}@example.test`,
    ownerName: "Owner",
    locale: "en",
    plan: "essential",
  });
  const started = await startSessionForUser({ user: created.user });
  assert.ok(started.ok);
  if (!started.ok) throw new Error("unreachable");
  const refresh = started.tokens.refreshToken!;
  return {
    ...created,
    started,
    access: started.cookieValue,
    refresh,
    both: `tc_session=${started.cookieValue}; tc_refresh=${refresh}`,
    refreshOnly: `tc_refresh=${refresh}`,
  };
}

async function ask(cookie = "", locale?: "fr") {
  const request = new NextRequest(
    `https://tradecatch.test/api/auth/session${locale ? `?locale=${locale}` : ""}`,
    { headers: cookie ? { cookie } : {} },
  );
  const response = await withRequest(request, () => sessionGet(request));
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
    cookies: response.headers.getSetCookie(),
    headers: response.headers,
  };
}

const clears = (cookies: string[], name: string) =>
  cookies.some((cookie) => new RegExp(`^${name}=;`).test(cookie));

beforeEach(() => {
  process.env.AUTH_SECRET = secret;
  process.env.TRADECATCH_ADMIN_EMAILS = ADMIN_EMAIL;
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

describe("GET /api/auth/session", () => {
  it("answers signed out, with the sign-in page, and touches no cookie, for a visitor with none", async () => {
    const en = await ask();
    assert.equal(en.status, 200);
    assert.deepEqual(en.body, { state: "anonymous", destination: "/login" });
    assert.deepEqual(en.cookies, []);

    const fr = await ask("", "fr");
    assert.deepEqual(fr.body, { state: "anonymous", destination: "/fr/connexion" });
  });

  it("sends a customer to their dashboard", async () => {
    const { both } = await account();
    const en = await ask(both);
    assert.deepEqual(en.body, { state: "signed_in", role: "customer", destination: "/app" });
    assert.deepEqual(en.cookies, [], "a valid session is never rewritten by a status check");
    assert.deepEqual((await ask(both, "fr")).body, {
      state: "signed_in",
      role: "customer",
      destination: "/fr/app",
    });
  });

  it("sends an administrator to the admin dashboard, decided by the server's list and not by the browser", async () => {
    const admin = await account(ADMIN_EMAIL);
    assert.deepEqual((await ask(admin.both)).body, {
      state: "signed_in",
      role: "admin",
      destination: "/admin",
    });
    assert.deepEqual((await ask(admin.both, "fr")).body, {
      state: "signed_in",
      role: "admin",
      destination: "/fr/admin",
    });

    // Asking for the role, or for another locale's role, changes nothing: only the list counts.
    const customer = await account();
    const forged = await ask(customer.both + "; role=admin; tc_admin=1");
    assert.deepEqual(forged.body, { state: "signed_in", role: "customer", destination: "/app" });
  });

  it("returns only a state, a role and an address: no token, no email, no business", async () => {
    const { both, access, refresh, user, organization } = await account();
    const out = await ask(both);
    assert.deepEqual(Object.keys(out.body).sort(), ["destination", "role", "state"]);
    const text = JSON.stringify(out.body);
    for (const secretValue of [access, refresh, user.email, user.name, organization.name, organization.id, user.id]) {
      assert.ok(!text.includes(secretValue), `leaks ${secretValue}`);
    }
    assert.match(out.headers.get("cache-control") ?? "", /no-store/);
    assert.match(out.headers.get("cache-control") ?? "", /private/);
  });

  it("recognises a signed-in person whose 15-minute access token has expired, from the refresh token, without rotating it", async () => {
    const customer = await account();
    // The browser has dropped the expired access cookie; only the refresh cookie remains.
    for (let i = 0; i < 3; i += 1) {
      const out = await ask(customer.refreshOnly);
      assert.deepEqual(out.body, { state: "signed_in", role: "customer", destination: "/app" });
      assert.deepEqual(out.cookies, [], "a status check never rewrites cookies");
    }
    // The token was only looked at: the real renewal still works, and is not mistaken for theft.
    const renewed = await refreshSession({ rawToken: customer.refresh });
    assert.equal(renewed.ok, true);

    const admin = await account(ADMIN_EMAIL);
    assert.deepEqual((await ask(admin.refreshOnly)).body, {
      state: "signed_in",
      role: "admin",
      destination: "/admin",
    });
  });

  it("keeps recognising a token that a parallel tab just rotated, and stops once it is long stale", async () => {
    const customer = await account();
    assert.equal((await refreshSession({ rawToken: customer.refresh })).ok, true);
    assert.equal((await ask(customer.refreshOnly)).body.state, "signed_in", "within the grace period");

    const other = await account();
    const hash = hashToken(other.refresh);
    const longAgo = new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 5 * 60_000).toISOString();
    await getSaasStore().rotateRefreshToken(hash, longAgo);
    const out = await ask(other.refreshOnly);
    assert.equal(out.body.state, "anonymous");
    // Looking is not revoking: the session itself is untouched by a status check.
    const session = await getSaasStore().getSession(other.started.sessionId);
    assert.equal(session?.revokedAt, undefined);
  });

  it("treats an ended session as signed out and clears every sign-in cookie in the same answer", async () => {
    const customer = await account();
    await getSaasStore().revokeSession(customer.started.sessionId, new Date().toISOString());
    const out = await ask(customer.both);
    assert.deepEqual(out.body, { state: "anonymous", destination: "/login" });
    for (const name of ["tc_session", "tc_refresh", "tc_admin"]) {
      assert.ok(clears(out.cookies, name), `${name} cleared`);
    }
    // Only the access token left behind (the refresh cookie is not sent to pages): same answer.
    const accessOnly = await ask(`tc_session=${customer.access}`);
    assert.equal(accessOnly.body.state, "anonymous");
    assert.ok(clears(accessOnly.cookies, "tc_session"));
  });

  it("treats garbage and tampered cookies as signed out and removes them", async () => {
    const customer = await account();
    const tampered = customer.access.slice(0, -2) + (customer.access.endsWith("AA") ? "BB" : "AA");
    for (const cookie of [
      "tc_session=not-a-token; tc_refresh=also-not-one",
      `tc_session=${tampered}`,
      "tc_refresh=" + "A".repeat(43),
    ]) {
      const out = await ask(cookie);
      assert.equal(out.body.state, "anonymous", cookie);
      assert.ok(out.cookies.length > 0, `cleared: ${cookie}`);
    }
  });

  it("sends a suspended business's owner to billing only", async () => {
    const owner = await account();
    await getSaasStore().updateOrganization(owner.organization.id, { status: "suspended" });
    assert.deepEqual((await ask(owner.both)).body, {
      state: "signed_in",
      role: "billing",
      destination: "/billing",
    });
    assert.deepEqual((await ask(owner.refreshOnly, "fr")).body, {
      state: "signed_in",
      role: "billing",
      destination: "/fr/facturation",
    });
  });

  it("answers 503 and removes nothing when the sign-in store cannot be reached", async () => {
    const customer = await account();
    mock.method(getSaasStore(), "getSession", async () => {
      throw new Error("database unavailable");
    });
    mock.method(getSaasStore(), "findRefreshToken", async () => {
      throw new Error("database unavailable");
    });
    const out = await ask(customer.both);
    assert.equal(out.status, 503);
    assert.deepEqual(out.body, { state: "unavailable" });
    assert.deepEqual(out.cookies, [], "a database outage must not sign anyone out");
    const refreshOnly = await ask(customer.refreshOnly);
    assert.equal(refreshOnly.status, 503);
    assert.deepEqual(refreshOnly.cookies, []);
  });

  it("clears nothing and signs nobody in when the signing secret is not configured", async () => {
    const customer = await account();
    for (const name of ["AUTH_SECRET", "SESSION_SECRET", "MISSED_CALL_OPS_SECRET"]) delete process.env[name];
    const out = await ask(customer.both);
    assert.deepEqual(out.body, { state: "anonymous", destination: "/login" });
    assert.deepEqual(out.cookies, []);
  });
});

describe("peekRefreshToken", () => {
  it("is read-only and refuses what refreshSession would refuse", async () => {
    const customer = await account();
    const before = await getSaasStore().findRefreshToken(hashToken(customer.refresh));
    assert.ok(await peekRefreshToken(customer.refresh));
    assert.deepEqual(await getSaasStore().findRefreshToken(hashToken(customer.refresh)), before);

    for (const junk of ["", "short", "A".repeat(43), "!".repeat(43), "A".repeat(44)]) {
      assert.equal(await peekRefreshToken(junk), null, junk);
    }
    // Past the end of the sign-in.
    assert.equal(await peekRefreshToken(customer.refresh, Date.now() + 15 * 24 * 3600 * 1000), null);
  });
});
