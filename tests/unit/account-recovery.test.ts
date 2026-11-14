import "../support/next-request-context";
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { withRequest } from "../support/next-request-context";
import { GET as adminList } from "../../src/app/api/admin/account-recovery/route";
import { POST as adminAct } from "../../src/app/api/admin/account-recovery/[id]/route";
import { POST as publicRecovery } from "../../src/app/api/auth/account-recovery/route";
import { POST as forgotPassword } from "../../src/app/api/auth/forgot-password/route";
import { signAdminJwt } from "../../src/product/saas/auth/admin-jwt";
import {
  completePassword,
  inspectPasswordToken,
  issuePasswordToken,
  passwordLogin,
  requestPasswordReset,
} from "../../src/product/saas/auth/password-auth";
import { refreshSession } from "../../src/product/saas/auth/refresh-token";
import { startSessionForUser } from "../../src/product/saas/auth/session-start";
import { hashToken } from "../../src/product/saas/ids";
import { getSaasStore, resetSaasRuntimeForTests } from "../../src/product/saas/runtime";
import { resetRateLimitState } from "../../src/lib/rate-limit";
import { requireTenantContext } from "../../src/product/saas/tenant";
import { getSecurityService, resetSecurityRuntimeForTests } from "../../src/product/security/runtime";
import { totpCode } from "../../src/product/security/totp";

const secret = "account-recovery-secret-at-least-32-chars";
const GOOD = "Copper-Pipe-Kettle-82";
const OTHER = "Maple-Wrench-Lantern-47";
const ADMIN_EMAIL = "recovery-admin@example.test";
const names = [
  "AUTH_SECRET",
  "NODE_ENV",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "SAAS_DEV_LOGIN",
  "TRADECATCH_ADMIN_EMAILS",
  "MISSED_CALL_OPS_SECRET",
  "ADMIN_ALERT_EMAIL",
  "TRADECATCH_E2E",
] as const;
const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
const realFetch = globalThis.fetch;

type Mail = { to: string; subject: string; text: string };
let mail: Mail[] = [];

function captureEmail() {
  mail = [];
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_FROM_EMAIL = "TradeCatch <noreply@tradecatch.test>";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("api.resend.com")) {
      const body = JSON.parse(String(init?.body)) as { to: string | string[]; subject: string; text: string };
      mail.push({ to: Array.isArray(body.to) ? body.to[0]! : body.to, subject: body.subject, text: body.text });
      return new Response(JSON.stringify({ id: "em_test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

const mailTo = (address: string) => mail.filter((m) => m.to === address);
const linkToken = (text: string) => {
  const match = text.match(/(?:set-password|definir-mot-de-passe)\?token=([A-Za-z0-9_%-]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
};

let counter = 0;
async function newAccount(prefix = "owner") {
  counter += 1;
  const email = `${prefix}-${Date.now()}-${counter}@example.test`;
  const created = await getSaasStore().createOrganizationWithOwner({
    name: `Recovery ${counter}`,
    ownerEmail: email,
    ownerName: "Owner",
    locale: "en",
    plan: "professional",
  });
  return { email, ...created };
}

async function accountWithPassword() {
  const account = await newAccount();
  const token = await issuePasswordToken({ userId: account.user.id, kind: "activation" });
  assert.equal((await completePassword({ rawToken: token, password: GOOD })).ok, true);
  const started = await startSessionForUser({ user: account.user });
  assert.ok(started.ok);
  if (!started.ok) throw new Error("unreachable");
  return { ...account, started };
}

async function adminSession() {
  const created = await getSaasStore().createOrganizationWithOwner({
    name: "TradeCatch HQ",
    ownerEmail: ADMIN_EMAIL,
    ownerName: "Admin",
    locale: "en",
    plan: "professional",
  });
  const started = await startSessionForUser({ user: created.user });
  assert.ok(started.ok);
  if (!started.ok) throw new Error("unreachable");
  const adminToken = await signAdminJwt({ sub: created.user.id, sid: started.sessionId }, secret);
  return {
    user: created.user,
    started,
    // Enrol the second factor and prove it for this very session, like the real sign-in flow.
    markMfaVerified: async () => {
      const security = getSecurityService();
      const enrolled = await security.enrollMfa(created.user.id);
      await security.confirmMfa(created.user.id, started.sessionId, totpCode(enrolled.secret));
    },
    cookie: `tc_session=${started.cookieValue}; tc_admin=${adminToken}`,
    sessionOnlyCookie: `tc_session=${started.cookieValue}`,
  };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`https://tradecatch.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const recoveryBody = (overrides: Record<string, unknown> = {}) => ({
  accountEmail: "lost@example.test",
  contactEmail: "new-contact@example.test",
  contactName: "Lee Owner",
  businessName: "Lee Plumbing",
  phone: "514-555-0101",
  details: "The old email account was closed by the provider.",
  locale: "en",
  ...overrides,
});

function adminGet(cookie: string, headers: Record<string, string> = {}) {
  const request = new NextRequest("https://tradecatch.test/api/admin/account-recovery", {
    method: "GET",
    headers: { cookie, ...headers },
  });
  return withRequest(request, () => adminList(request));
}

function adminPost(id: string, cookie: string, body: unknown, headers: Record<string, string> = {}) {
  const request = new NextRequest(`https://tradecatch.test/api/admin/account-recovery/${id}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return withRequest(request, () => adminAct(request, { params: Promise.resolve({ id }) }));
}

const VERIFY = {
  action: "verify",
  method: "phone_callback_number_on_file",
  notes: "Called the business number on file and spoke with the owner, who confirmed the plan and city.",
  confirmed: true,
};

async function openRequest(accountEmail: string, contactEmail = "new-contact@example.test", ip = "198.51.100.20") {
  const response = await publicRecovery(
    post("/api/auth/account-recovery", recoveryBody({ accountEmail, contactEmail }), { "x-forwarded-for": ip }),
  );
  assert.equal(response.status, 200);
  const rows = await getSaasStore().listRecoveryRequests();
  const row = rows.find((r) => r.accountEmail === accountEmail.toLowerCase() && r.contactEmail === contactEmail.toLowerCase());
  assert.ok(row);
  return row;
}

beforeEach(() => {
  process.env.AUTH_SECRET = secret;
  process.env.TRADECATCH_ADMIN_EMAILS = ADMIN_EMAIL;
  delete process.env.SAAS_DEV_LOGIN;
  delete process.env.TRADECATCH_E2E;
  delete process.env.MISSED_CALL_OPS_SECRET;
  delete process.env.ADMIN_ALERT_EMAIL;
  (process.env as { NODE_ENV?: string }).NODE_ENV = "development";
  resetSaasRuntimeForTests();
  resetSecurityRuntimeForTests();
  resetRateLimitState();
  captureEmail();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  mock.restoreAll();
});
after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetSaasRuntimeForTests();
});

describe("password reset email", () => {
  it("emails a unique single-use link that expires in 30 minutes, and stores only its hash", async () => {
    const account = await accountWithPassword();
    const before = Date.now();
    const result = await requestPasswordReset({ email: account.email, locale: "en", origin: "https://tradecatch.test" });
    assert.deepEqual(result, { ok: true }, "the browser is never handed the token when mail is configured");

    const sent = mailTo(account.email);
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.subject, /reset your tradecatch password/i);
    assert.match(sent[0]!.text, /30 minutes/);
    assert.match(sent[0]!.text, /https:\/\/tradecatch\.test\/set-password\?token=/);
    const raw = linkToken(sent[0]!.text);
    assert.ok(raw && raw.length === 43);

    const store = getSaasStore();
    assert.equal(await store.findPasswordToken(raw), null, "the raw token is not what is stored");
    const row = await store.findPasswordToken(hashToken(raw));
    assert.ok(row);
    assert.equal(row.kind, "reset");
    const lifetime = Date.parse(row.expiresAt) - Date.parse(row.createdAt);
    assert.equal(lifetime, 30 * 60 * 1000);
    assert.ok(Date.parse(row.createdAt) >= before - 1000);
    assert.equal(sent[0]!.text.includes(GOOD), false, "never a password in an email");
  });

  it("two requests make two different links, and a newer reset cancels nothing it should not", async () => {
    const account = await accountWithPassword();
    await requestPasswordReset({ email: account.email, locale: "en", origin: "https://tradecatch.test" });
    await requestPasswordReset({ email: account.email, locale: "en", origin: "https://tradecatch.test" });
    const [one, two] = mailTo(account.email).map((m) => linkToken(m.text));
    assert.ok(one && two && one !== two);
  });

  it("answers the same, and sends nothing, for an email with no account", async () => {
    const known = await accountWithPassword();
    const unknownEmail = `nobody-${Date.now()}@example.test`;
    const ask = async (email: string, ip: string) => {
      const response = await forgotPassword(post("/api/auth/forgot-password", { email, locale: "en" }, { "x-forwarded-for": ip }));
      return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
    };
    const a = await ask(known.email, "198.51.100.31");
    const b = await ask(unknownEmail, "198.51.100.32");
    assert.deepEqual(a, b);
    assert.deepEqual(a.body, { ok: true });
    assert.equal(a.cache, "no-store, private");
    assert.equal(mailTo(known.email).length, 1);
    assert.equal(mailTo(unknownEmail).length, 0);
    assert.equal(await getSaasStore().getUserByEmail(unknownEmail), null, "no account is created");
  });

  it("in production the lookup happens after the answer, so the response never says whether the email exists", async () => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = "production";
    const known = await accountWithPassword();
    const withAccount = await requestPasswordReset({ email: known.email, locale: "fr", origin: "https://tradecatch.test" });
    const without = await requestPasswordReset({ email: "ghost@example.test", locale: "fr", origin: "https://tradecatch.test" });
    assert.deepEqual(withAccount, { ok: true });
    assert.deepEqual(without, { ok: true });
    assert.equal(mailTo(known.email).length, 1);
    assert.match(mailTo(known.email)[0]!.text, /definir-mot-de-passe\?token=/);
  });

  it("never reveals the token in the response, even when sending fails", async () => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = "production";
    const account = await accountWithPassword();
    mock.method(console, "error", () => {});
    globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;
    const result = await requestPasswordReset({ email: account.email, locale: "en", origin: "https://tradecatch.test" });
    assert.deepEqual(result, { ok: true });
  });

  it("limits requests per email address, so one inbox cannot be flooded", async () => {
    const account = await accountWithPassword();
    for (let i = 0; i < 8; i += 1) {
      await requestPasswordReset({ email: account.email, locale: "en", origin: "https://tradecatch.test" });
    }
    assert.equal(mailTo(account.email).length, 5);
  });

  it("limits requests per address on the route, with a retry hint", async () => {
    const ip = "198.51.100.44";
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 8; i += 1) {
      last = await forgotPassword(post("/api/auth/forgot-password", { email: `x${i}@example.test`, locale: "en" }, { "x-forwarded-for": ip }));
      statuses.push(last.status);
    }
    assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
    assert.equal(statuses[7], 429);
    assert.ok(last?.headers.get("retry-after"));
    const limited = (await last!.json()) as { error?: string; retryAfterSeconds?: number };
    assert.equal(limited.error, "rate_limited");
    assert.ok((limited.retryAfterSeconds ?? 0) > 0);
  });

  it("refuses malformed requests without touching accounts", async () => {
    for (const body of [{}, { email: "not-an-email" }, { email: "a@b.test", extra: 1 }, { email: "a@b.test", locale: "de" }]) {
      const response = await forgotPassword(post("/api/auth/forgot-password", body, { "x-forwarded-for": "198.51.100.50" }));
      assert.equal(response.status, 400);
    }
  });

  it("a link works once, an expired link never works, and an old link dies when a newer password is set", async () => {
    const account = await accountWithPassword();
    await requestPasswordReset({ email: account.email, locale: "en", origin: "https://tradecatch.test" });
    await requestPasswordReset({ email: account.email, locale: "en", origin: "https://tradecatch.test" });
    const [first, second] = mailTo(account.email).map((m) => linkToken(m.text)!);

    const done = await completePassword({ rawToken: second, password: OTHER });
    assert.equal(done.ok, true);
    assert.deepEqual(await completePassword({ rawToken: second, password: GOOD }), { ok: false, error: "invalid_link" }, "reused");
    assert.deepEqual(await inspectPasswordToken(first), { valid: false }, "the older link was cancelled too");
    assert.deepEqual(await completePassword({ rawToken: first, password: GOOD }), { ok: false, error: "invalid_link" });

    const expired = await issuePasswordToken({ userId: account.user.id, kind: "reset", ttlMs: -1_000 });
    assert.deepEqual(await inspectPasswordToken(expired), { valid: false });
    assert.deepEqual(await completePassword({ rawToken: expired, password: GOOD }), { ok: false, error: "invalid_link" });
    for (const junk of ["", "short", "x".repeat(43), "!".repeat(43)]) {
      assert.deepEqual(await completePassword({ rawToken: junk, password: GOOD }), { ok: false, error: "invalid_link" });
    }
    assert.equal((await passwordLogin({ email: account.email, password: OTHER })).ok, true);
    assert.equal((await passwordLogin({ email: account.email, password: GOOD })).ok, false);
  });

  it("validates the new password and keeps the link usable after a weak attempt", async () => {
    const account = await accountWithPassword();
    const raw = await issuePasswordToken({ userId: account.user.id, kind: "reset" });
    for (const weak of ["short", "password123", "x".repeat(200), account.email]) {
      const result = await completePassword({ rawToken: raw, password: weak });
      assert.equal(result.ok, false, weak.slice(0, 12));
    }
    assert.deepEqual(await inspectPasswordToken(raw), { valid: true, kind: "reset" });
    assert.equal((await completePassword({ rawToken: raw, password: OTHER })).ok, true);
  });

  it("emails a confirmation after the password changes, and signs out every older session", async () => {
    const account = await accountWithPassword();
    const raw = await issuePasswordToken({ userId: account.user.id, kind: "reset" });
    mail = [];
    const done = await completePassword({ rawToken: raw, password: OTHER });
    assert.equal(done.ok, true);
    const notice = mailTo(account.email);
    assert.equal(notice.length, 1);
    assert.match(notice[0]!.subject, /password was changed/i);
    assert.match(notice[0]!.text, /If this was not you/);
    assert.equal(notice[0]!.text.includes(OTHER), false);
    assert.equal(linkToken(notice[0]!.text), null, "the notice carries no sign-in or reset token");

    const cookie = `tc_session=${account.started.cookieValue}`;
    const stale = new NextRequest("https://tradecatch.test/app", { headers: { cookie } });
    const ctx = await withRequest(stale, () => requireTenantContext());
    assert.equal(ctx.ok, false);
    assert.deepEqual(await refreshSession({ rawToken: account.started.tokens.refreshToken! }), { ok: false, error: "invalid" });
  });

  it("an activation (first password) does not send a 'password changed' warning", async () => {
    const account = await newAccount();
    const raw = await issuePasswordToken({ userId: account.user.id, kind: "activation" });
    mail = [];
    assert.equal((await completePassword({ rawToken: raw, password: GOOD })).ok, true);
    assert.equal(mailTo(account.email).length, 0);
  });
});

describe("support-based account recovery", () => {
  it("answers identically for an existing and an unknown account, and changes nothing by itself", async () => {
    const lost = await accountWithPassword();
    const known = await publicRecovery(post("/api/auth/account-recovery", recoveryBody({ accountEmail: lost.email }), { "x-forwarded-for": "198.51.100.60" }));
    const unknown = await publicRecovery(post("/api/auth/account-recovery", recoveryBody({ accountEmail: "ghost@example.test" }), { "x-forwarded-for": "198.51.100.61" }));
    assert.equal(known.status, 200);
    assert.deepEqual(await known.json(), await unknown.json());
    assert.equal(known.headers.get("cache-control"), "no-store, private");

    const store = getSaasStore();
    assert.equal((await store.getUserByEmail(lost.email))?.id, lost.user.id, "email unchanged");
    assert.equal(await store.getUserByEmail("new-contact@example.test"), null, "no account is created for the new address");
    assert.equal((await passwordLogin({ email: lost.email, password: GOOD })).ok, true, "owner still signs in normally");
    const rows = await store.listRecoveryRequests();
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.accountEmail === lost.email)?.status, "open");

    // The acknowledgement goes to the contact address and says nothing about any account.
    const ack = mailTo("new-contact@example.test");
    assert.equal(ack.length, 2);
    for (const m of ack) {
      assert.equal(m.text.includes(lost.email), false);
      assert.equal(m.text.includes("Recovery"), false);
      assert.equal(linkToken(m.text), null);
    }
  });

  it("records the request in the audit log, and does not store the same open request twice", async () => {
    const lost = await accountWithPassword();
    await openRequest(lost.email);
    await openRequest(lost.email);
    assert.equal((await getSaasStore().listRecoveryRequests()).length, 1);
    const audit = await getSecurityService().listAudit();
    assert.equal(audit.filter((row) => row.action === "account_recovery_requested").length, 1);
  });

  it("ignores bots (filled honeypot) and refuses malformed or oversized requests", async () => {
    let n = 0;
    const nextIp = () => ({ "x-forwarded-for": `198.51.100.${100 + n++}` });
    const bot = await publicRecovery(post("/api/auth/account-recovery", recoveryBody({ website: "http://spam.example" }), nextIp()));
    assert.equal(bot.status, 200);
    assert.equal((await getSaasStore().listRecoveryRequests()).length, 0);
    for (const bad of [
      recoveryBody({ accountEmail: "nope" }),
      recoveryBody({ contactEmail: "nope" }),
      recoveryBody({ details: "short" }),
      recoveryBody({ phone: "<script>" }),
      { ...recoveryBody(), role: "admin" },
      {},
    ]) {
      assert.equal((await publicRecovery(post("/api/auth/account-recovery", bad, nextIp()))).status, 400, JSON.stringify(bad).slice(0, 60));
    }
  });

  it("is rate limited per address", async () => {
    const ip = { "x-forwarded-for": "198.51.100.63" };
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await publicRecovery(post("/api/auth/account-recovery", recoveryBody({ accountEmail: `a${i}@example.test` }), ip))).status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
  });

  it("only a verified administrator can read or act on requests", async () => {
    const lost = await accountWithPassword();
    const row = await openRequest(lost.email);
    process.env.MISSED_CALL_OPS_SECRET = "ops-secret-for-the-recovery-test";
    const admin = await adminSession();

    // Not signed in.
    assert.equal((await adminGet("")).status, 401);
    assert.equal((await adminPost(row.id, "", VERIFY)).status, 401);
    // A customer, even the very account being recovered.
    const customer = `tc_session=${lost.started.cookieValue}`;
    assert.equal((await adminGet(customer)).status, 403);
    assert.equal((await adminPost(row.id, customer, VERIFY)).status, 403);
    // The shared operations secret identifies nobody, so it cannot do this.
    const ops = { authorization: "Bearer ops-secret-for-the-recovery-test", "x-ops-actor": "founder" };
    assert.equal((await adminGet("", ops)).status, 403);
    assert.equal((await adminPost(row.id, "", VERIFY, ops)).status, 403);
    // An administrator whose session has not passed MFA.
    assert.equal((await adminGet(admin.sessionOnlyCookie)).status, 403);
    assert.equal((await adminPost(row.id, admin.sessionOnlyCookie, VERIFY)).status, 403);
    // MFA passed but no admin token.
    await admin.markMfaVerified();
    assert.equal((await adminGet(admin.sessionOnlyCookie)).status, 401);
    // Fully verified.
    const ok = await adminGet(admin.cookie);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store, private");
    const body = (await ok.json()) as { requests: { id: string; match: { currentEmail: string; businesses: { phone: string | null }[] } }[] };
    assert.equal(body.requests[0]?.id, row.id);
    assert.equal(body.requests[0]?.match.currentEmail, lost.email);

    assert.equal((await getSaasStore().getRecoveryRequest(row.id))?.status, "open", "nothing changed while access was refused");
    assert.equal((await getSaasStore().getUserByEmail(lost.email))?.id, lost.user.id);
  });

  it("will not move an account on a weak or unconfirmed check, or out of order", async () => {
    const lost = await accountWithPassword();
    const row = await openRequest(lost.email);
    const admin = await adminSession();
    await admin.markMfaVerified();

    assert.equal((await adminPost(row.id, admin.cookie, { action: "complete", confirmed: true })).status, 409, "cannot change email before verifying");
    for (const body of [
      { ...VERIFY, notes: "ok" },
      { ...VERIFY, confirmed: false },
      { ...VERIFY, method: "trust_me" },
      { action: "verify", method: VERIFY.method, notes: VERIFY.notes },
      { action: "delete", confirmed: true },
      { ...VERIFY, newEmail: "attacker@example.test" },
    ]) {
      assert.equal((await adminPost(row.id, admin.cookie, body)).status, 400, JSON.stringify(body).slice(0, 70));
    }
    assert.equal((await adminPost("rec_not_a_real_one", admin.cookie, VERIFY)).status, 404);
    assert.equal((await adminPost("../../etc", admin.cookie, VERIFY)).status, 404);
    assert.equal((await getSaasStore().getUserByEmail(lost.email))?.id, lost.user.id);
  });

  it("moves the account to the verified address, keeps every business record, and signs nobody in", async () => {
    const lost = await accountWithPassword();
    await getSaasStore().updateOrganization(lost.organization.id, { phoneE164: "+15145550101", city: "Montreal" });
    const store = getSaasStore();
    const orgBefore = await store.getOrganization(lost.organization.id);
    const membershipsBefore = await store.listMembershipsForUser(lost.user.id);
    const staleReset = await issuePasswordToken({ userId: lost.user.id, kind: "reset" });

    const row = await openRequest(lost.email, "Fresh-Owner@Example.test");
    const admin = await adminSession();
    await admin.markMfaVerified();
    mail = [];

    const verified = await adminPost(row.id, admin.cookie, VERIFY);
    assert.equal(verified.status, 200);
    assert.equal(((await verified.json()) as { status: string }).status, "verified");
    assert.equal((await store.getUserByEmail(lost.email))?.id, lost.user.id, "verification alone changes nothing");

    const done = await adminPost(row.id, admin.cookie, { action: "complete", confirmed: true });
    assert.equal(done.status, 200);
    const completed = (await done.json()) as { status: string; linkSent?: boolean };
    assert.equal(completed.status, "completed");
    assert.equal(completed.linkSent, true, "the administrator is told the password link went out");

    // The account moved; nothing else did.
    const moved = await store.getUserByEmail("fresh-owner@example.test");
    assert.equal(moved?.id, lost.user.id);
    assert.equal(await store.getUserByEmail(lost.email), null);
    assert.deepEqual(await store.getOrganization(lost.organization.id), orgBefore);
    assert.deepEqual(await store.listMembershipsForUser(lost.user.id), membershipsBefore);

    // Recovery is not a sign-in: no new session, old ones and old links are dead, the old password is gone.
    const live = (await store.listSessionsForUser(lost.user.id)).filter((s) => s.id !== admin.started.sessionId);
    assert.equal(live.length, 0);
    const cookie = `tc_session=${lost.started.cookieValue}`;
    const stale = new NextRequest("https://tradecatch.test/app", { headers: { cookie } });
    assert.equal((await withRequest(stale, () => requireTenantContext())).ok, false);
    assert.deepEqual(await refreshSession({ rawToken: lost.started.tokens.refreshToken! }), { ok: false, error: "invalid" });
    assert.deepEqual(await inspectPasswordToken(staleReset), { valid: false });
    assert.equal((await passwordLogin({ email: "fresh-owner@example.test", password: GOOD })).ok, false, "the old password does not survive recovery");
    assert.equal((await passwordLogin({ email: lost.email, password: GOOD })).ok, false);

    // The new address gets a single-use 30-minute link; the old address gets a notice.
    const link = mailTo("fresh-owner@example.test");
    assert.equal(link.length, 1);
    assert.match(link[0]!.text, /30 minutes/);
    const raw = linkToken(link[0]!.text);
    assert.ok(raw);
    const notice = mailTo(lost.email);
    assert.equal(notice.length, 1);
    assert.match(notice[0]!.subject, /sign-in email .* changed/i);
    assert.equal(linkToken(notice[0]!.text), null);
    const chosen = await completePassword({ rawToken: raw, password: OTHER });
    assert.equal(chosen.ok, true);
    assert.equal((await passwordLogin({ email: "fresh-owner@example.test", password: OTHER })).ok, true);
    assert.deepEqual(await completePassword({ rawToken: raw, password: GOOD }), { ok: false, error: "invalid_link" });

    // Same business, same data, after recovery.
    assert.deepEqual(await store.getOrganization(lost.organization.id), orgBefore);

    // Applying it again, or reusing it, does nothing.
    assert.equal((await adminPost(row.id, admin.cookie, { action: "complete", confirmed: true })).status, 409);
    assert.equal((await adminPost(row.id, admin.cookie, VERIFY)).status, 409);
  });

  it("tells the administrator when the password link could not be emailed, and the account is still moved", async () => {
    const lost = await accountWithPassword();
    const row = await openRequest(lost.email, "no-mail@example.test");
    const admin = await adminSession();
    await admin.markMfaVerified();
    await adminPost(row.id, admin.cookie, VERIFY);
    mock.method(console, "error", () => {});
    globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;
    const done = await adminPost(row.id, admin.cookie, { action: "complete", confirmed: true });
    assert.equal(done.status, 200);
    assert.deepEqual(await done.json(), { ok: true, status: "completed", linkSent: false });
    assert.equal((await getSaasStore().getUserByEmail("no-mail@example.test"))?.id, lost.user.id);
    const audit = await getSecurityService().listAudit();
    assert.ok(audit.some((e) => e.action === "account_recovery_link_failed"));
    // The customer can still get in with "Forgot your password" at the verified address.
    globalThis.fetch = realFetch;
    captureEmail();
    await requestPasswordReset({ email: "no-mail@example.test", locale: "en", origin: "https://tradecatch.test" });
    assert.equal(mailTo("no-mail@example.test").length, 1);
  });

  it("records every step in the audit log, attributed to the administrator, without full email addresses", async () => {
    const lost = await accountWithPassword();
    const row = await openRequest(lost.email, "audit-new@example.test");
    const admin = await adminSession();
    await admin.markMfaVerified();
    await adminPost(row.id, admin.cookie, VERIFY);
    await adminPost(row.id, admin.cookie, { action: "complete", confirmed: true });

    const audit = await getSecurityService().listAudit();
    const actions = audit.filter((e) => e.action.startsWith("account_recovery")).map((e) => e.action);
    for (const expected of [
      "account_recovery_requested",
      "account_recovery_identity_verified",
      "account_recovery_email_changed",
      "account_recovery_link_sent",
    ]) {
      assert.ok(actions.includes(expected), expected);
    }
    const changed = audit.find((e) => e.action === "account_recovery_email_changed")!;
    assert.equal(changed.actorUserId, admin.user.id);
    assert.equal(changed.target, row.id);
    assert.equal(changed.organizationId, lost.organization.id);
    const text = JSON.stringify(audit.filter((e) => e.action.startsWith("account_recovery")));
    assert.equal(text.includes(lost.email), false);
    assert.equal(text.includes("audit-new@example.test"), false);
    // The raw verification notes live with the request, not in the audit trail.
    const stored = await getSaasStore().getRecoveryRequest(row.id);
    assert.equal(stored?.verifiedBy, admin.user.id);
    assert.equal(stored?.verificationMethod, "phone_callback_number_on_file");
    assert.ok(stored?.verificationNotes && stored.verificationNotes.length >= 20);
    assert.equal(stored?.resolvedBy, admin.user.id);
  });

  it("cannot be used to take over an administrator account, or the acting administrator's own", async () => {
    const admin = await adminSession();
    await admin.markMfaVerified();
    const attack = await openRequest(ADMIN_EMAIL, "attacker@example.test");
    const result = await adminPost(attack.id, admin.cookie, VERIFY);
    assert.equal(result.status, 403);
    assert.deepEqual(await result.json(), { error: "protected_account" });
    assert.equal((await getSaasStore().getUserByEmail(ADMIN_EMAIL))?.id, admin.user.id);
    assert.equal((await getSaasStore().getRecoveryRequest(attack.id))?.status, "open");

    // A second administrator may not recover the first through the desk either.
    const view = (await (await adminGet(admin.cookie)).json()) as { requests: { match: { isAdministrator: boolean } }[] };
    assert.equal(view.requests[0]?.match.isAdministrator, true);
  });

  it("refuses a new address that already belongs to another account, and leaves the request open to resolve", async () => {
    const lost = await accountWithPassword();
    const other = await accountWithPassword();
    const row = await openRequest(lost.email, other.email);
    const admin = await adminSession();
    await admin.markMfaVerified();
    assert.equal((await adminPost(row.id, admin.cookie, VERIFY)).status, 200);
    const result = await adminPost(row.id, admin.cookie, { action: "complete", confirmed: true });
    assert.equal(result.status, 409);
    assert.deepEqual(await result.json(), { error: "email_taken" });
    assert.equal((await getSaasStore().getUserByEmail(other.email))?.id, other.user.id, "the other account is untouched");
    assert.equal((await getSaasStore().getUserByEmail(lost.email))?.id, lost.user.id);
    assert.equal((await getSaasStore().getRecoveryRequest(row.id))?.status, "verified");
    assert.equal((await passwordLogin({ email: lost.email, password: GOOD })).ok, true, "the owner's own access is intact");
  });

  it("a request for an email with no account cannot be verified or applied", async () => {
    const row = await openRequest("ghost@example.test");
    const admin = await adminSession();
    await admin.markMfaVerified();
    const result = await adminPost(row.id, admin.cookie, VERIFY);
    assert.equal(result.status, 422);
    assert.deepEqual(await result.json(), { error: "no_matching_account" });
    const view = (await (await adminGet(admin.cookie)).json()) as { requests: { match: unknown }[] };
    assert.equal(view.requests[0]?.match, null);
    assert.equal((await adminPost(row.id, admin.cookie, { action: "reject", notes: "No account with that email." })).status, 200);
    assert.equal((await getSaasStore().getRecoveryRequest(row.id))?.status, "rejected");
  });

  it("rejecting a request changes nothing and cannot be undone by applying it", async () => {
    const lost = await accountWithPassword();
    const row = await openRequest(lost.email);
    const admin = await adminSession();
    await admin.markMfaVerified();
    assert.equal((await adminPost(row.id, admin.cookie, { action: "reject", notes: "Could not verify the caller." })).status, 200);
    assert.equal((await adminPost(row.id, admin.cookie, VERIFY)).status, 409);
    assert.equal((await adminPost(row.id, admin.cookie, { action: "complete", confirmed: true })).status, 409);
    assert.equal((await getSaasStore().getUserByEmail(lost.email))?.id, lost.user.id);
    assert.equal((await passwordLogin({ email: lost.email, password: GOOD })).ok, true);
  });

  it("two administrators cannot both apply the same request", async () => {
    const lost = await accountWithPassword();
    const row = await openRequest(lost.email, "double@example.test");
    const admin = await adminSession();
    await admin.markMfaVerified();
    await adminPost(row.id, admin.cookie, VERIFY);
    mail = []; // drop the acknowledgement sent when the request was filed
    const [a, b] = await Promise.all([
      adminPost(row.id, admin.cookie, { action: "complete", confirmed: true }),
      adminPost(row.id, admin.cookie, { action: "complete", confirmed: true }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal(mailTo("double@example.test").length, 1, "one link, not two");
  });
});
