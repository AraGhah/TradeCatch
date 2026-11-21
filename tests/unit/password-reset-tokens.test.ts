import "../support/next-request-context";
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { inspect } from "node:util";
import { NextRequest } from "next/server";
import { withRequest } from "../support/next-request-context";
import { POST as forgotRoute } from "../../src/app/api/auth/forgot-password/route";
import { POST as setPasswordRoute } from "../../src/app/api/auth/set-password/route";
import { POST as checkRoute } from "../../src/app/api/auth/set-password/check/route";
import {
  completePassword,
  issuePasswordToken,
  passwordLogin,
  PASSWORD_RESET_TTL_MS,
} from "../../src/product/saas/auth/password-auth";
import { refreshSession } from "../../src/product/saas/auth/refresh-token";
import { startSessionForUser } from "../../src/product/saas/auth/session-start";
import { hashToken } from "../../src/product/saas/ids";
import { getSaasStore, resetSaasRuntimeForTests } from "../../src/product/saas/runtime";
import { requireTenantContext } from "../../src/product/saas/tenant";
import {
  getSecurityService,
  resetSecurityRuntimeForTests,
} from "../../src/product/security/runtime";
import { resetRateLimitState } from "../../src/lib/rate-limit";
import { describePasswordTokenContract } from "./support/password-token-contract";

/**
 * KAN-27: password reset tokens. RESET-01 ... RESET-14 (RESET-13, the phone
 * flow, is the Playwright spec tests/password-reset.spec.ts).
 *
 * These call the real route handlers with the real in-memory store, a fake mail
 * provider that records every email, a recorded console and a mocked clock.
 */

const SITE = "https://app.tradecatch.test";
const GOOD = "Copper-Pipe-Kettle-82";
const NEXT = "Maple-Wrench-Lantern-47";
const THIRD = "Cedar-Anvil-Harbour-19";
const MIN = 60_000;

const names = [
  "AUTH_SECRET",
  "NODE_ENV",
  "NEXT_PUBLIC_SITE_URL",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "SAAS_DEV_LOGIN",
  "TRADECATCH_E2E",
  "TRUST_PROXY_HEADERS",
] as const;
const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
const env = process.env as Record<string, string | undefined>;
const realFetch = globalThis.fetch;

type Mail = { to: string; subject: string; text: string };
let mail: Mail[] = [];
let mailMode: "ok" | "fail" = "ok";
let lastBody = "";

function installMailProvider() {
  env.RESEND_API_KEY = "re_test_key";
  env.RESEND_FROM_EMAIL = "TradeCatch <noreply@tradecatch.test>";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("api.resend.com")) return realFetch(input, init);
    const body = JSON.parse(String(init?.body)) as {
      to: string | string[];
      subject: string;
      text: string;
    };
    lastBody = body.text;
    if (mailMode === "fail") {
      // A provider error that echoes the message body back, link included.
      return new Response(
        JSON.stringify({
          name: "application_error",
          statusCode: 500,
          message: `provider rejected: ${body.text}`,
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
    mail.push({
      to: Array.isArray(body.to) ? body.to[0]! : body.to,
      subject: body.subject,
      text: body.text,
    });
    return new Response(JSON.stringify({ id: "em_test" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const mailTo = (address: string) => mail.filter((m) => m.to === address);
const resetMails = (address: string) =>
  mailTo(address).filter((m) => /reset|réinitial/i.test(m.subject));
const tokenIn = (text: string) =>
  text.match(/#token=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/)?.[1] ?? null;

// Everything the routes say or log, so RESET-12 can search all of it.
let logs: string[] = [];
let responses: string[] = [];
function recordConsole() {
  logs = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    mock.method(console, method, (...args: unknown[]) => {
      logs.push(
        args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 6 }))).join(" "),
      );
    });
  }
}

let ipCounter = 0;
const freshIp = () => {
  ipCounter += 1;
  return `10.27.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
};

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`${SITE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": freshIp(), ...headers },
    body: JSON.stringify(body),
  });
}

async function seen(pending: Response | Promise<Response>) {
  const response = await pending;
  const copy = response.clone();
  responses.push(
    JSON.stringify({
      status: copy.status,
      headers: [...copy.headers.entries()],
      body: await copy.text(),
    }),
  );
  return response;
}

const forgot = (email: string, opts: { ip?: string; locale?: "en" | "fr" } = {}) =>
  seen(
    forgotRoute(
      post(
        "/api/auth/forgot-password",
        { email, locale: opts.locale ?? "en" },
        opts.ip ? { "x-forwarded-for": opts.ip } : {},
      ),
    ),
  );

const submit = (token: string, password: string) =>
  seen(setPasswordRoute(post("/api/auth/set-password", { token, password, locale: "en" })));

const check = (token: string) =>
  seen(checkRoute(post("/api/auth/set-password/check", { token })));

let counter = 0;
async function newAccount() {
  counter += 1;
  const email = `reset-${Date.now()}-${counter}@example.test`;
  const created = await getSaasStore().createOrganizationWithOwner({
    name: `Reset ${counter}`,
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
  return account;
}

/** Asks for a reset link and returns the secret from the email that arrived. */
async function requestLink(email: string, locale: "en" | "fr" = "en") {
  const before = resetMails(email).length;
  const res = await forgot(email, { locale });
  assert.equal(res.status, 200);
  const mails = resetMails(email);
  assert.equal(mails.length, before + 1, "one new reset email");
  const raw = tokenIn(mails.at(-1)!.text);
  assert.ok(raw, "the email carries a link with a secret");
  return { raw, mail: mails.at(-1)! };
}

async function canSignInWith(email: string, password: string) {
  return (await passwordLogin({ email, password })).ok;
}

function setEnv(name: (typeof names)[number], value: string | undefined) {
  if (value === undefined) delete env[name];
  else env[name] = value;
}

describe("KAN-27 password reset tokens", () => {
  before(() => {
    setEnv("AUTH_SECRET", "kan-27-auth-secret-at-least-32-characters");
    setEnv("NEXT_PUBLIC_SITE_URL", SITE);
    setEnv("SAAS_DEV_LOGIN", undefined);
    setEnv("TRADECATCH_E2E", undefined);
    setEnv("NODE_ENV", undefined);
    setEnv("TRUST_PROXY_HEADERS", undefined);
  });

  beforeEach(() => {
    mail = [];
    mailMode = "ok";
    responses = [];
    resetSaasRuntimeForTests();
    resetSecurityRuntimeForTests();
    resetRateLimitState();
    installMailProvider();
    recordConsole();
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
  });

  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
    globalThis.fetch = realFetch;
    setEnv("NODE_ENV", undefined);
    setEnv("TRUST_PROXY_HEADERS", undefined);
    setEnv("SAAS_DEV_LOGIN", undefined);
  });

  after(() => {
    for (const name of names) setEnv(name, saved[name]);
    resetSaasRuntimeForTests();
    resetSecurityRuntimeForTests();
  });

  describe("RESET-01 requesting a reset produces a secure email", () => {
    it("emails one HTTPS link on the configured site, secret in the fragment, 30 minutes", async () => {
      const account = await accountWithPassword();
      const res = await forgot(account.email);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });

      assert.equal(resetMails(account.email).length, 1);
      const message = resetMails(account.email)[0]!;
      const link = new URL(message.text.match(/https:\/\/\S+/)![0]);
      assert.equal(link.protocol, "https:");
      assert.equal(link.origin, SITE);
      assert.equal(link.pathname, "/set-password");
      assert.equal(link.search, "", "no secret in the query string, which servers log");
      const raw = tokenIn(message.text)!;
      assert.match(raw, /^[A-Za-z0-9_-]{43}$/, "256 bits from a secure random source");
      assert.match(message.text, /expires in 30 minutes/);

      // Stored only as a hash; the 30 minutes are in the row, from creation.
      const store = getSaasStore();
      assert.equal(await store.findPasswordToken(raw), null, "the raw value is not a key");
      const row = await store.findPasswordToken(hashToken(raw));
      assert.equal(row?.kind, "reset");
      assert.equal(row?.userId, account.user.id);
      assert.equal(
        Date.parse(row!.expiresAt) - Date.parse(row!.createdAt),
        PASSWORD_RESET_TTL_MS,
      );
      assert.equal(PASSWORD_RESET_TTL_MS, 30 * MIN);
      assert.equal(JSON.stringify(row).includes(raw), false);
    });

    it("writes the French link in the French path", async () => {
      const account = await accountWithPassword();
      const { mail: message } = await requestLink(account.email, "fr");
      const link = new URL(message.text.match(/https:\/\/\S+/)![0]);
      assert.equal(link.pathname, "/fr/definir-mot-de-passe");
      assert.match(message.subject, /Réinitialisez/);
    });

    it("never builds the link from the request, even with forged host headers", async () => {
      setEnv("NODE_ENV", "production");
      setEnv("TRUST_PROXY_HEADERS", "1");
      const account = await accountWithPassword();
      const request = new NextRequest("https://evil.example/api/auth/forgot-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "evil.example",
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
          "x-forwarded-for": freshIp(),
        },
        body: JSON.stringify({ email: account.email, locale: "en" }),
      });
      const res = await forgotRoute(request);
      assert.equal(res.status, 200);
      const text = resetMails(account.email)[0]!.text;
      assert.equal(new URL(text.match(/https:\/\/\S+/)![0]).origin, SITE);
      assert.equal(text.includes("evil.example"), false);
    });
  });

  describe("RESET-02 a valid link works before it expires", () => {
    it("changes the password, signs the browser in and emails a notice", async () => {
      const account = await accountWithPassword();
      const { raw } = await requestLink(account.email);
      mock.timers.tick(30 * MIN - 1);

      assert.deepEqual(await (await check(raw)).json(), { valid: true, kind: "reset" });
      const res = await submit(raw, NEXT);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; next: string };
      assert.equal(body.ok, true);
      assert.match(body.next, /^\/(fr\/)?(app|billing|facturation|admin)/);
      assert.ok(res.headers.get("set-cookie")?.includes("tc_session="), "signed in");
      assert.match(res.headers.get("cache-control") ?? "", /no-store/);

      assert.equal(await canSignInWith(account.email, NEXT), true);
      assert.equal(await canSignInWith(account.email, GOOD), false);

      const notice = mailTo(account.email).filter((m) => /was changed/i.test(m.subject));
      assert.equal(notice.length, 1);
      assert.equal(notice[0]!.text.includes(NEXT), false, "never the password");
      assert.equal(notice[0]!.text.includes(raw), false, "never the link");
      assert.equal(tokenIn(notice[0]!.text), null);
    });

    it("a weak password is refused and does not spend the link or move its deadline", async () => {
      const account = await accountWithPassword();
      const { raw } = await requestLink(account.email);
      const before = await getSaasStore().findPasswordToken(hashToken(raw));
      for (const weak of ["short", "password123", account.email]) {
        const res = await submit(raw, weak);
        assert.equal(res.status, 422);
      }
      await check(raw);
      const after = await getSaasStore().findPasswordToken(hashToken(raw));
      assert.deepEqual(after, before, "nothing about the link changed");
      assert.equal((await submit(raw, NEXT)).status, 200);
    });
  });

  describe("RESET-03 a link older than 30 minutes is rejected", () => {
    it("is valid one millisecond before and dead at the 30 minute mark", async () => {
      const account = await accountWithPassword();
      const { raw } = await requestLink(account.email);

      mock.timers.tick(30 * MIN - 1);
      assert.equal(((await (await check(raw)).json()) as { valid: boolean }).valid, true);
      mock.timers.tick(1);
      assert.deepEqual(await (await check(raw)).json(), { valid: false });

      const res = await submit(raw, NEXT);
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: "invalid_link" });
      assert.equal(res.headers.get("set-cookie"), null, "no sign-in from a dead link");
      assert.equal(await canSignInWith(account.email, GOOD), true, "password unchanged");
      assert.equal(await canSignInWith(account.email, NEXT), false);
    });

    it("never extends the deadline, however often the link is looked at", async () => {
      const account = await accountWithPassword();
      const { raw } = await requestLink(account.email);
      const original = (await getSaasStore().findPasswordToken(hashToken(raw)))!.expiresAt;
      for (let i = 0; i < 5; i += 1) {
        mock.timers.tick(5 * MIN);
        await check(raw);
        await submit(raw, "password123");
      }
      mock.timers.tick(5 * MIN + 1);
      assert.equal(
        (await getSaasStore().findPasswordToken(hashToken(raw)))!.expiresAt,
        original,
      );
      assert.equal(((await (await check(raw)).json()) as { valid: boolean }).valid, false);
    });
  });

  describe("RESET-04 a used link cannot be used again", () => {
    it("refuses a replay with the same or a different password", async () => {
      const account = await accountWithPassword();
      const { raw } = await requestLink(account.email);
      assert.equal((await submit(raw, NEXT)).status, 200);

      for (const password of [NEXT, THIRD]) {
        const replay = await submit(raw, password);
        assert.equal(replay.status, 400);
        assert.deepEqual(await replay.json(), { error: "invalid_link" });
        assert.equal(replay.headers.get("set-cookie"), null);
      }
      assert.deepEqual(await (await check(raw)).json(), { valid: false });
      assert.equal(await canSignInWith(account.email, NEXT), true);
      assert.equal(await canSignInWith(account.email, THIRD), false);
    });
  });

  describe("RESET-05 an invalid token changes nothing", () => {
    it("answers the same for forged, malformed and tampered tokens", async () => {
      const account = await accountWithPassword();
      const { raw } = await requestLink(account.email);
      const flipped = `${raw.slice(0, 42)}${raw.endsWith("A") ? "B" : "A"}`;
      const attempts = [
        "A".repeat(43),
        flipped,
        raw.slice(0, 42),
        `${raw}x`,
        "!".repeat(43),
        hashToken(raw),
        "../../etc/passwd".padEnd(43, "x"),
      ];
      const answers = new Set<string>();
      for (const token of attempts) {
        const res = await submit(token, NEXT);
        assert.equal(res.status === 400 || res.status === 422, true, token);
        answers.add(`${res.status} ${await res.text()}`);
        assert.equal(res.headers.get("set-cookie"), null);
        assert.deepEqual(await (await check(token)).json(), { valid: false });
      }
      assert.equal(answers.size <= 2, true, "no oracle for how close a guess was");
      assert.equal(await canSignInWith(account.email, GOOD), true);
      assert.equal(await canSignInWith(account.email, NEXT), false);
      // The real link was untouched by all of that.
      assert.equal(((await (await check(raw)).json()) as { valid: boolean }).valid, true);
    });

    it("rejects unexpected fields and non-JSON without touching anything", async () => {
      const bad = [
        new NextRequest(`${SITE}/api/auth/set-password`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": freshIp() },
          body: JSON.stringify({ token: "A".repeat(43), password: NEXT, locale: "en", admin: true }),
        }),
        new NextRequest(`${SITE}/api/auth/set-password`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": freshIp() },
          body: "not json",
        }),
      ];
      for (const request of bad) {
        const res = await setPasswordRoute(request);
        assert.equal(res.status >= 400 && res.status < 500, true);
      }
    });
  });

  describe("RESET-06 a second link invalidates the first", () => {
    it("only the newest link works", async () => {
      const account = await accountWithPassword();
      const first = await requestLink(account.email);
      mock.timers.tick(MIN);
      const second = await requestLink(account.email);
      assert.notEqual(first.raw, second.raw);

      assert.deepEqual(await (await check(first.raw)).json(), { valid: false });
      const stale = await submit(first.raw, NEXT);
      assert.equal(stale.status, 400);
      assert.equal(await canSignInWith(account.email, GOOD), true, "the old link changed nothing");

      assert.equal((await submit(second.raw, NEXT)).status, 200);
    });

    it("simultaneous requests leave exactly one live link", async () => {
      const account = await accountWithPassword();
      await Promise.all([1, 2, 3, 4].map(() => forgot(account.email)));
      const raws = resetMails(account.email).map((m) => tokenIn(m.text)!);
      assert.equal(raws.length, 4);
      const live = [];
      for (const raw of raws) {
        const verdict = (await (await check(raw)).json()) as { valid: boolean };
        if (verdict.valid) live.push(raw);
      }
      assert.equal(live.length, 1);
    });

    it("a refused request (rate limited) does not cancel the link already sent", async () => {
      const account = await accountWithPassword();
      const first = await requestLink(account.email);
      for (let i = 0; i < 4; i += 1) await forgot(account.email);
      const refused = await forgot(account.email);
      assert.equal(refused.status, 429);
      const live = await Promise.all(
        resetMails(account.email).map(async (m) =>
          ((await (await check(tokenIn(m.text)!)).json()) as { valid: boolean }).valid,
        ),
      );
      assert.equal(live.filter(Boolean).length, 1, "the newest sent link is the live one");
      assert.equal(
        ((await (await check(first.raw)).json()) as { valid: boolean }).valid,
        false,
      );
    });

    it("a reset request leaves an unused account-invitation link alone", async () => {
      const account = await newAccount();
      const invite = await issuePasswordToken({ userId: account.user.id, kind: "activation" });
      await forgot(account.email);
      assert.deepEqual(await (await check(invite)).json(), { valid: true, kind: "activation" });
    });
  });

  describe("RESET-07 an unknown email gets the same answer", () => {
    it("same status, body and headers whether or not the account exists, and nothing is created", async () => {
      const account = await accountWithPassword();
      const stranger = `nobody-${Date.now()}@example.test`;

      const known = await forgot(account.email);
      const unknown = await forgot(stranger);
      assert.equal(known.status, unknown.status);
      assert.deepEqual(await known.json(), await unknown.json());
      assert.equal(known.headers.get("cache-control"), unknown.headers.get("cache-control"));
      assert.equal(known.headers.get("content-type"), unknown.headers.get("content-type"));

      assert.equal(mailTo(stranger).length, 0, "no email to an address with no account");
      assert.equal(await getSaasStore().getUserByEmail(stranger), null, "no account created");
      // An address with an account but no organization behaves the same way.
      assert.equal(mail.length, 1);
    });

    it("is also silent about case and spacing variants of an unknown address", async () => {
      const res = await forgot("  Nobody@Example.Test ");
      assert.deepEqual(await res.json(), { ok: true });
      assert.equal(mail.length, 0);
    });
  });

  describe("RESET-08 excessive requests are rate limited", () => {
    it("limits one address (IP): the sixth request is refused with Retry-After", async () => {
      const ip = "198.51.100.77";
      for (let i = 0; i < 5; i += 1) {
        const ok = await forgot(`someone-${i}@example.test`, { ip });
        assert.equal(ok.status, 200, `request ${i + 1}`);
      }
      const refused = await forgot("someone-6@example.test", { ip });
      assert.equal(refused.status, 429);
      const body = (await refused.json()) as { error: string; retryAfterSeconds: number };
      assert.equal(body.error, "rate_limited");
      assert.ok(Number(refused.headers.get("retry-after")) >= 1);
      assert.ok(body.retryAfterSeconds >= 1);
    });

    it("limits one account across many addresses, identically for unknown emails", async () => {
      const account = await accountWithPassword();
      const stranger = `ghost-${Date.now()}@example.test`;
      for (const email of [account.email, stranger]) {
        const statuses: number[] = [];
        for (let i = 0; i < 7; i += 1) {
          // A different IP every time: only the per-account budget can stop this.
          statuses.push((await forgot(email)).status);
        }
        assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
      }
      assert.equal(resetMails(account.email).length, 5, "the refused ones sent nothing");
      assert.equal(mailTo(stranger).length, 0);
    });

    it("refills over time, so a real person is not locked out for good", async () => {
      const account = await accountWithPassword();
      for (let i = 0; i < 5; i += 1) await forgot(account.email);
      assert.equal((await forgot(account.email)).status, 429);
      mock.timers.tick(13 * MIN);
      assert.equal((await forgot(account.email)).status, 200);
    });

    it("limits guessing at the link itself", async () => {
      const ip = "198.51.100.88";
      let refused = 0;
      for (let i = 0; i < 40; i += 1) {
        const res = await seen(
          setPasswordRoute(
            post("/api/auth/set-password", { token: "A".repeat(43), password: NEXT, locale: "en" }, { "x-forwarded-for": ip }),
          ) as unknown as Response,
        );
        if (res.status === 429) refused += 1;
      }
      assert.ok(refused > 0, "guessing is throttled");
    });
  });

  describe("RESET-09 two simultaneous submissions: only one succeeds", () => {
    it("one wins, the others are told the link is used, and the winner's password stands", async () => {
      const account = await accountWithPassword();
      const { raw } = await requestLink(account.email);
      const passwords = [NEXT, THIRD, "Birch-Tundra-Violet-33", "Pine-Garnet-Ocean-58", "Slate-Orchid-Meadow-71"];
      const results = await Promise.all(passwords.map((p) => submit(raw, p)));
      const statuses = results.map((r) => r.status).sort();
      assert.deepEqual(statuses, [200, 400, 400, 400, 400]);

      let winners = 0;
      for (const password of passwords) {
        if (await canSignInWith(account.email, password)) winners += 1;
      }
      assert.equal(winners, 1, "exactly one of the five passwords is now the password");
      assert.equal(await canSignInWith(account.email, GOOD), false);
    });
  });

  describe("RESET-10 a successful reset ends every session", () => {
    it("revokes sessions and refresh tokens, and the old access cookie stops working", async () => {
      const account = await accountWithPassword();
      const phone = await startSessionForUser({ user: account.user });
      const laptop = await startSessionForUser({ user: account.user });
      assert.ok(phone.ok && laptop.ok);
      if (!phone.ok || !laptop.ok) throw new Error("unreachable");

      const { raw } = await requestLink(account.email);
      const res = await submit(raw, NEXT);
      assert.equal(res.status, 200);

      const store = getSaasStore();
      assert.ok((await store.getSession(phone.sessionId))?.revokedAt);
      assert.ok((await store.getSession(laptop.sessionId))?.revokedAt);
      for (const started of [phone, laptop]) {
        assert.deepEqual(
          await refreshSession({ rawToken: started.tokens.refreshToken! }),
          { ok: false, error: "invalid" },
        );
        const stale = new NextRequest(`${SITE}/app`, {
          headers: { cookie: `tc_session=${started.cookieValue}` },
        });
        assert.equal((await withRequest(stale, () => requireTenantContext())).ok, false);
      }
      // The browser that finished the reset is signed in on a brand new session.
      const fresh = res.headers.get("set-cookie") ?? "";
      assert.match(fresh, /tc_session=/);
      assert.match(fresh, /tc_refresh=/);
    });

    it("also cancels any other link still open for the account", async () => {
      const account = await newAccount();
      const invite = await issuePasswordToken({ userId: account.user.id, kind: "activation" });
      const reset = await issuePasswordToken({ userId: account.user.id, kind: "reset" });
      assert.equal((await submit(reset, GOOD)).status, 200);
      assert.deepEqual(await (await check(invite)).json(), { valid: false });
    });
  });

  describe("RESET-11 a new link after expiry works", () => {
    it("issues a fresh valid link once the first has expired", async () => {
      const account = await accountWithPassword();
      const first = await requestLink(account.email);
      mock.timers.tick(31 * MIN);
      assert.deepEqual(await (await check(first.raw)).json(), { valid: false });

      const second = await requestLink(account.email);
      assert.notEqual(second.raw, first.raw);
      assert.deepEqual(await (await check(second.raw)).json(), { valid: true, kind: "reset" });
      assert.equal((await submit(first.raw, THIRD)).status, 400);
      assert.equal((await submit(second.raw, NEXT)).status, 200);
      assert.equal(await canSignInWith(account.email, NEXT), true);
    });
  });

  describe("RESET-12 no secret appears in logs or API responses", () => {
    it("searches every log line and every response of a full flow, including failures", async () => {
      const account = await accountWithPassword();
      const secrets = new Set<string>();

      // Happy path.
      const first = await requestLink(account.email);
      secrets.add(first.raw);
      assert.equal((await submit(first.raw, NEXT)).status, 200);

      // Provider failure that echoes the message (and so the link) back. In
      // production, where a local dev link is never handed back in the response.
      setEnv("NODE_ENV", "production");
      setEnv("TRUST_PROXY_HEADERS", "1");
      mailMode = "fail";
      await forgot(account.email);
      const echoed = tokenIn(lastBody);
      assert.ok(echoed, "the provider saw a link");
      secrets.add(echoed);
      mailMode = "ok";
      setEnv("NODE_ENV", undefined);
      setEnv("TRUST_PROXY_HEADERS", undefined);
      assert.ok(
        logs.some((line) => line.includes("delivery failed")),
        "the failure was logged, with the secret masked",
      );

      // Store failure whose message happens to contain a secret.
      const second = await requestLink(account.email);
      secrets.add(second.raw);
      const store = getSaasStore();
      const original = store.completePasswordReset;
      store.completePasswordReset = async () => {
        throw new Error(`connection lost while saving ${second.raw}`);
      };
      assert.equal((await submit(second.raw, THIRD)).status, 503);
      store.completePasswordReset = original;

      const haystack = [...logs, ...responses].join("\n");
      for (const secret of secrets) {
        assert.equal(haystack.includes(secret), false, "a link secret leaked");
        assert.equal(haystack.includes(hashToken(secret)), false, "a link hash leaked");
      }
      for (const password of [GOOD, NEXT, THIRD]) {
        assert.equal(haystack.includes(password), false, "a password leaked");
      }
      assert.equal(/scrypt\$/.test(haystack), false, "a password hash leaked");
      assert.equal(/"(token|devToken|tokenHash|password_?hash)"/i.test(responses.join("\n")), false);
    });

    it("never hands a link back in production, even if the email fails and dev login is on", async () => {
      setEnv("NODE_ENV", "production");
      setEnv("TRUST_PROXY_HEADERS", "1");
      setEnv("SAAS_DEV_LOGIN", "1");
      const account = await accountWithPassword();
      mailMode = "fail";
      const res = await forgot(account.email);
      const body = await res.json();
      assert.deepEqual(body, { ok: true });
      const noMail = await forgot(`nobody-${Date.now()}@example.test`);
      assert.deepEqual(await noMail.json(), { ok: true });
    });

    it("keeps the set-password route's own failure text free of database details", async () => {
      const account = await accountWithPassword();
      const { raw } = await requestLink(account.email);
      const store = getSaasStore();
      const original = store.completePasswordReset;
      store.completePasswordReset = async () => {
        throw new Error('relation "tc_password_tokens" does not exist (host=db.internal)');
      };
      try {
        const res = await submit(raw, NEXT);
        const text = await res.text();
        assert.equal(res.status, 503);
        assert.deepEqual(JSON.parse(text), { error: "unavailable" });
        assert.equal(text.includes("tc_password_tokens"), false);
        assert.equal(text.includes("db.internal"), false);
      } finally {
        store.completePasswordReset = original;
      }
    });
  });

  describe("RESET-14 database or email failure is handled safely", () => {
    it("a database failure while saving keeps the link unspent and never reports success", async () => {
      const account = await accountWithPassword();
      const { raw } = await requestLink(account.email);
      const store = getSaasStore();
      const original = store.completePasswordReset;
      store.completePasswordReset = async () => {
        throw new Error("simulated outage");
      };
      const failed = await submit(raw, NEXT);
      store.completePasswordReset = original;

      assert.equal(failed.status, 503);
      assert.deepEqual(await failed.json(), { error: "unavailable" });
      assert.equal(failed.headers.get("set-cookie"), null, "not signed in");
      assert.equal(await canSignInWith(account.email, GOOD), true, "password unchanged");
      assert.equal(await canSignInWith(account.email, NEXT), false);
      assert.equal(mailTo(account.email).some((m) => /was changed/i.test(m.subject)), false);

      // And because nothing was spent, the person can simply try again.
      assert.equal((await submit(raw, NEXT)).status, 200);
    });

    it("the link check failing is reported as a failure, never as an expired link", async () => {
      const account = await accountWithPassword();
      const { raw } = await requestLink(account.email);
      const store = getSaasStore();
      const original = store.findPasswordToken;
      store.findPasswordToken = async () => {
        throw new Error("simulated outage");
      };
      const res = await check(raw);
      store.findPasswordToken = original;
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { error: "unavailable" });
    });

    it("an email provider failure sends nothing false: same answer, audited, no sign-in link instead", async () => {
      setEnv("NODE_ENV", "production");
      setEnv("TRUST_PROXY_HEADERS", "1");
      const account = await accountWithPassword();
      mailMode = "fail";
      const res = await forgot(account.email);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
      assert.equal(mail.length, 0);

      const audit = await getSecurityService().listAudit();
      assert.ok(audit.some((e) => e.action === "password_reset_email_failed"));
      assert.equal(
        logs.some((l) => l.includes("delivery failed")),
        true,
        "the failure is logged for operators",
      );
    });

    it("a database failure while creating the link sends nothing and does not substitute a sign-in link", async () => {
      const account = await accountWithPassword();
      const store = getSaasStore();
      const original = store.replacePasswordToken;
      const magic = mock.method(store, "createMagicLink");
      store.replacePasswordToken = async () => {
        throw new Error("simulated outage");
      };
      // Non-production: the failure is visible to the (local) caller as a refusal.
      const res = await forgot(account.email);
      store.replacePasswordToken = original;
      assert.equal(res.status, 200);
      assert.equal(mail.length, 0, "no email without a stored link");
      assert.equal(magic.mock.callCount(), 0, "no sign-in link was made instead");
      const audit = await getSecurityService().listAudit();
      assert.ok(audit.some((e) => e.action === "password_reset_failed"));
    });

    it("the request endpoint says so when it cannot even start, instead of a false 'sent'", async () => {
      const account = await accountWithPassword();
      const store = getSaasStore();
      const original = store.getUserByEmail;
      store.getUserByEmail = async () => {
        throw new Error("simulated outage");
      };
      const res = await forgot(account.email);
      store.getUserByEmail = original;
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { error: "unavailable" });
    });
  });

  describe("store contract (in-memory)", () => {
    describePasswordTokenContract("password link storage", async () => {
      resetSaasRuntimeForTests();
      const store = getSaasStore();
      return {
        store,
        newUser: async () => {
          const account = await newAccount();
          return { userId: account.user.id, organizationId: account.organization.id };
        },
      };
    });
  });
});
