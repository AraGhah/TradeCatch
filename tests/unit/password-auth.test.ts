import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { POST as passwordLoginRoute } from "../../src/app/api/auth/password-login/route";
import {
  changePassword,
  completePassword,
  inspectPasswordToken,
  issuePasswordToken,
  passwordLogin,
  requestPasswordReset,
  sendActivationInvite,
  setPasswordUrl,
} from "../../src/product/saas/auth/password-auth";
import {
  checkPasswordStrength,
  hashPassword,
  verifyPassword,
} from "../../src/product/saas/auth/password";
import { startSessionForUser } from "../../src/product/saas/auth/session-start";
import { verifySessionClaims } from "../../src/product/saas/auth/session-token";
import {
  getSaasStore,
  resetSaasRuntimeForTests,
} from "../../src/product/saas/runtime";

const GOOD = "Copper-Pipe-Kettle-82";
const OTHER = "Maple-Wrench-Lantern-47";
const secret = "unit-test-auth-secret";

const saved = {
  AUTH_SECRET: process.env.AUTH_SECRET,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  SAAS_DEV_LOGIN: process.env.SAAS_DEV_LOGIN,
};

let counter = 0;
async function newAccount(plan: "essential" | "professional" = "essential") {
  counter += 1;
  const email = `owner-${Date.now()}-${counter}@example.test`;
  const created = await getSaasStore().createOrganizationWithOwner({
    name: `Plomberie ${counter}`,
    ownerEmail: email,
    ownerName: "Owner",
    locale: "en",
    plan,
  });
  return { email, ...created };
}

/** An account whose owner has already chosen GOOD as their password. */
async function accountWithPassword() {
  const account = await newAccount();
  const token = await issuePasswordToken({
    userId: account.user.id,
    kind: "activation",
  });
  const done = await completePassword({ rawToken: token, password: GOOD });
  assert.equal(done.ok, true);
  return account;
}

describe("password hashing", () => {
  it("round-trips, salts every hash, and never stores the password", async () => {
    const first = await hashPassword(GOOD);
    const second = await hashPassword(GOOD);
    assert.notEqual(first, second);
    assert.equal(first.includes(GOOD), false);
    assert.match(first, /^scrypt\$16384\$8\$1\$/);
    assert.equal(await verifyPassword(GOOD, first), true);
    assert.equal(await verifyPassword(`${GOOD}x`, first), false);
    assert.equal(await verifyPassword("", first), false);
  });

  it("treats the same text in different unicode forms as one password", async () => {
    const stored = await hashPassword("Café-Crème-2026");
    assert.equal(await verifyPassword("Café-Crème-2026", stored), true);
  });

  it("refuses malformed or hostile stored hashes instead of crashing", async () => {
    for (const bad of [
      "",
      "plain-text",
      "scrypt$1$2$3$a$b",
      "scrypt$16384$8$1$AAAA$BBBB",
      "scrypt$999999999$8$1$AAAAAAAAAAAAAAAA$BBBBBBBBBBBBBBBBBBBBBBBB",
      "scrypt$16383$8$1$AAAAAAAAAAAAAAAA$BBBBBBBBBBBBBBBBBBBBBBBB",
      "bcrypt$16384$8$1$AAAAAAAAAAAAAAAA$BBBBBBBBBBBBBBBBBBBBBBBB",
    ]) {
      assert.equal(await verifyPassword(GOOD, bad), false, bad);
    }
  });
});

describe("password rules", () => {
  it("rejects short, long, common and email-derived passwords", () => {
    assert.equal(checkPasswordStrength("Short1!"), "too_short");
    assert.equal(checkPasswordStrength("x".repeat(129)), "too_long");
    assert.equal(checkPasswordStrength("password123"), "common");
    assert.equal(checkPasswordStrength("aaaaaaaaaaaa"), "common");
    assert.equal(
      checkPasswordStrength("Marie.Tremblay-2026", "marie.tremblay@example.test"),
      "contains_email",
    );
    assert.equal(
      checkPasswordStrength("marie.tremblay@example.test", "marie.tremblay@example.test"),
      "contains_email",
    );
    assert.equal(checkPasswordStrength(GOOD, "marie@example.test"), null);
  });
});

describe("account activation and password reset", () => {
  before(() => {
    process.env.AUTH_SECRET = secret;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.SAAS_DEV_LOGIN;
    resetSaasRuntimeForTests();
  });
  after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetSaasRuntimeForTests();
  });

  it("a customer activates an invited account and is signed in", async () => {
    const account = await newAccount();
    const raw = await issuePasswordToken({
      userId: account.user.id,
      kind: "activation",
    });
    assert.deepEqual(await inspectPasswordToken(raw), {
      valid: true,
      kind: "activation",
    });

    const done = await completePassword({
      rawToken: raw,
      password: GOOD,
      userAgent: "unit-test",
    });
    assert.equal(done.ok, true);
    if (!done.ok || !done.session) throw new Error("expected a session");

    const claims = await verifySessionClaims(done.session.cookieValue, secret);
    assert.equal(claims?.uid, account.user.id);
    assert.equal(claims?.oid, account.organization.id);

    // Only a salted hash is stored.
    const stored = await getSaasStore().getPasswordCredential(account.user.id);
    assert.ok(stored);
    assert.equal(JSON.stringify(stored).includes(GOOD), false);
    assert.equal(await verifyPassword(GOOD, stored.hash), true);
  });

  it("a link works exactly once", async () => {
    const account = await newAccount();
    const raw = await issuePasswordToken({
      userId: account.user.id,
      kind: "activation",
    });
    assert.equal((await completePassword({ rawToken: raw, password: GOOD })).ok, true);
    const replay = await completePassword({ rawToken: raw, password: OTHER });
    assert.deepEqual(replay, { ok: false, error: "invalid_link" });
    assert.deepEqual(await inspectPasswordToken(raw), { valid: false });
    // The replay did not change the password.
    const stored = await getSaasStore().getPasswordCredential(account.user.id);
    assert.equal(await verifyPassword(GOOD, stored!.hash), true);
  });

  it("a weak password does not spend the link", async () => {
    const account = await newAccount();
    const raw = await issuePasswordToken({
      userId: account.user.id,
      kind: "reset",
    });
    const weak = await completePassword({ rawToken: raw, password: "password123" });
    assert.deepEqual(weak, {
      ok: false,
      error: "weak_password",
      problem: "common",
    });
    assert.deepEqual(await inspectPasswordToken(raw), {
      valid: true,
      kind: "reset",
    });
    assert.equal((await completePassword({ rawToken: raw, password: GOOD })).ok, true);
  });

  it("expired, forged and malformed links are refused", async () => {
    const account = await newAccount();
    const expired = await issuePasswordToken({
      userId: account.user.id,
      kind: "reset",
      ttlMs: -1000,
    });
    assert.deepEqual(await completePassword({ rawToken: expired, password: GOOD }), {
      ok: false,
      error: "invalid_link",
    });
    for (const forged of ["", "short", "A".repeat(43), "!".repeat(43)]) {
      assert.deepEqual(await completePassword({ rawToken: forged, password: GOOD }), {
        ok: false,
        error: "invalid_link",
      });
    }
    assert.equal(await getSaasStore().getPasswordCredential(account.user.id), null);
  });

  it("setting a password signs out every older session", async () => {
    const account = await newAccount();
    const old = await startSessionForUser({ user: account.user });
    assert.equal(old.ok, true);
    const claims = old.ok
      ? await verifySessionClaims(old.cookieValue, secret)
      : null;
    const raw = await issuePasswordToken({
      userId: account.user.id,
      kind: "reset",
    });
    await completePassword({ rawToken: raw, password: GOOD });
    const session = await getSaasStore().getSession(claims!.sid);
    assert.ok(session?.revokedAt);
  });

  it("a reset request never reveals whether the email has an account", async () => {
    const unknown = await requestPasswordReset({
      email: `nobody-${Date.now()}@example.invalid`,
      locale: "en",
      origin: "https://example.invalid",
    });
    assert.deepEqual(unknown, { ok: true });
    assert.equal(
      await getSaasStore().getUserByEmail(`nobody-${Date.now()}@example.invalid`),
      null,
    );
  });

  it("a reset link for a real account is single use and sets the new password", async () => {
    const account = await accountWithPassword();
    const result = await requestPasswordReset({
      email: account.email,
      locale: "fr",
      origin: "https://example.invalid",
    });
    // No mail provider here, so the local run hands the link back.
    assert.ok(result.devToken);
    const done = await completePassword({
      rawToken: result.devToken!,
      password: OTHER,
    });
    assert.equal(done.ok, true);
    assert.equal((await passwordLogin({ email: account.email, password: GOOD })).ok, false);
    assert.equal((await passwordLogin({ email: account.email, password: OTHER })).ok, true);
  });

  it("an invite still goes out as an email link when password storage is not migrated yet", async () => {
    const account = await newAccount();
    const store = getSaasStore();
    const original = store.createPasswordToken;
    store.createPasswordToken = async () => {
      throw new Error('relation "tc_password_tokens" does not exist');
    };
    try {
      const result = await sendActivationInvite({
        email: account.email,
        locale: "en",
        origin: "https://example.invalid",
        organizationId: account.organization.id,
      });
      // No provider here: a clean refusal, not an exception.
      assert.deepEqual(result, { ok: false, error: "Email is not configured." });
    } finally {
      store.createPasswordToken = original;
    }
  });

  it("an activation link points at the set-password page in the customer's language and never carries a password", async () => {
    assert.equal(
      setPasswordUrl("https://tradecatch.ca/", "fr", "tok/en+1"),
      "https://tradecatch.ca/fr/definir-mot-de-passe?token=tok%2Fen%2B1",
    );
    assert.equal(
      setPasswordUrl("https://tradecatch.ca", "en", "abc"),
      "https://tradecatch.ca/set-password?token=abc",
    );
    const account = await newAccount();
    const result = await sendActivationInvite({
      email: account.email,
      locale: "fr",
      origin: "https://example.invalid",
      organizationId: account.organization.id,
    });
    // No provider configured: refused cleanly, nothing sent in clear text.
    assert.deepEqual(result, { ok: false, error: "Email is not configured." });
    assert.equal(JSON.stringify(result).toLowerCase().includes("password"), false);
  });
});

describe("password sign-in", () => {
  before(() => {
    process.env.AUTH_SECRET = secret;
    resetSaasRuntimeForTests();
  });
  after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetSaasRuntimeForTests();
  });

  it("signs a customer in to their own business only", async () => {
    const a = await accountWithPassword();
    const b = await accountWithPassword();
    const result = await passwordLogin({ email: a.email, password: GOOD });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const claims = await verifySessionClaims(result.session.cookieValue, secret);
    assert.equal(claims?.uid, a.user.id);
    assert.equal(claims?.oid, a.organization.id);
    assert.notEqual(claims?.oid, b.organization.id);
    // A session can never be opened for a business the person does not belong to.
    const crossTenant = await startSessionForUser({
      user: a.user,
      organizationId: b.organization.id,
    });
    assert.equal(crossTenant.ok, false);
  });

  it("is case-insensitive on the email and exact on the password", async () => {
    const a = await accountWithPassword();
    assert.equal(
      (await passwordLogin({ email: a.email.toUpperCase(), password: GOOD })).ok,
      true,
    );
    assert.equal(
      (await passwordLogin({ email: a.email, password: GOOD.toLowerCase() })).ok,
      false,
    );
  });

  it("gives one answer for a wrong password, an unknown email and an account with no password", async () => {
    const withPassword = await accountWithPassword();
    const noPassword = await newAccount();
    const wrong = await passwordLogin({ email: withPassword.email, password: "nope-nope-nope" });
    const unknown = await passwordLogin({
      email: `ghost-${Date.now()}@example.invalid`,
      password: GOOD,
    });
    const none = await passwordLogin({ email: noPassword.email, password: GOOD });
    for (const r of [wrong, unknown, none]) {
      assert.deepEqual(r, { ok: false, error: "invalid_credentials" });
    }
  });

  it("stops guessing after repeated failures, even for the right password", async () => {
    const a = await accountWithPassword();
    for (let i = 0; i < 5; i += 1) {
      const r = await passwordLogin({ email: a.email, password: `wrong-${i}-wrong` });
      assert.deepEqual(r, { ok: false, error: "invalid_credentials" });
    }
    assert.deepEqual(await passwordLogin({ email: a.email, password: GOOD }), {
      ok: false,
      error: "rate_limited",
    });
  });

  it("the route sets a secure session cookie and keeps the answer private", async () => {
    const a = await accountWithPassword();
    const request = new NextRequest("http://localhost/api/auth/password-login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
      body: JSON.stringify({ email: a.email, password: GOOD, locale: "fr" }),
    });
    const response = await passwordLoginRoute(request);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const body = (await response.json()) as { ok: boolean; next: string };
    assert.equal(body.ok, true);
    assert.equal(body.next, "/fr/app");
    const cookie = response.cookies.get("tc_session");
    assert.ok(cookie?.value);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, "lax");

    const bad = await passwordLoginRoute(
      new NextRequest("http://localhost/api/auth/password-login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.8" },
        body: JSON.stringify({ email: a.email, password: "wrong-wrong-wrong", locale: "en" }),
      }),
    );
    assert.equal(bad.status, 401);
    assert.equal(bad.cookies.get("tc_session"), undefined);
  });

  it("rejects extra fields and malformed input", async () => {
    const response = await passwordLoginRoute(
      new NextRequest("http://localhost/api/auth/password-login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.9" },
        body: JSON.stringify({ email: "not-an-email", password: "x", organizationId: "org_x" }),
      }),
    );
    assert.equal(response.status, 400);
  });
});

describe("changing a password", () => {
  before(() => {
    process.env.AUTH_SECRET = secret;
    resetSaasRuntimeForTests();
  });
  after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetSaasRuntimeForTests();
  });

  it("needs the current password and signs out other devices but not this one", async () => {
    const a = await accountWithPassword();
    const here = await startSessionForUser({ user: a.user });
    const there = await startSessionForUser({ user: a.user });
    assert.ok(here.ok && there.ok);
    const hereId = (await verifySessionClaims(here.cookieValue, secret))!.sid;
    const thereId = (await verifySessionClaims(there.cookieValue, secret))!.sid;

    assert.deepEqual(
      await changePassword({
        user: a.user,
        currentSessionId: hereId,
        currentPassword: "not-my-password",
        newPassword: OTHER,
      }),
      { ok: false, error: "wrong_password" },
    );
    assert.deepEqual(
      await changePassword({
        user: a.user,
        currentSessionId: hereId,
        currentPassword: GOOD,
        newPassword: "password123",
      }),
      { ok: false, error: "weak_password", problem: "common" },
    );
    assert.deepEqual(
      await changePassword({
        user: a.user,
        currentSessionId: hereId,
        currentPassword: GOOD,
        newPassword: GOOD,
      }),
      { ok: false, error: "same_password" },
    );
    assert.deepEqual(
      await changePassword({
        user: a.user,
        currentSessionId: hereId,
        currentPassword: GOOD,
        newPassword: OTHER,
      }),
      { ok: true },
    );

    const store = getSaasStore();
    assert.equal((await store.getSession(hereId))?.revokedAt, undefined);
    assert.ok((await store.getSession(thereId))?.revokedAt);
    assert.equal((await passwordLogin({ email: a.email, password: GOOD })).ok, false);
    assert.equal((await passwordLogin({ email: a.email, password: OTHER })).ok, true);
  });

  it("an account that never chose a password cannot set one without its email link", async () => {
    const a = await newAccount();
    assert.deepEqual(
      await changePassword({
        user: a.user,
        currentSessionId: "ses_none",
        currentPassword: "anything-at-all",
        newPassword: GOOD,
      }),
      { ok: false, error: "no_password" },
    );
  });
});
