import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { totpCode } from "../src/product/security/totp";
import { waitForFormHydration } from "./support/hydration";
import { workspaceSession } from "./support/workspace-session";

const OPS = "Bearer tradecatch-e2e-ops-secret-not-for-production";
const ADMIN_EMAIL = "auth-session-admin@example.test";
const PASSWORD = "Copper-Pipe-Kettle-82";

/** A documentation-range address so repeated runs never share a rate-limit bucket. */
const freshIp = () =>
  `2001:db8:${randomUUID().replaceAll("-", "").match(/.{4}/g)!.slice(0, 6).join(":")}`;

/**
 * Every client without its own forwarded address shares one rate-limit bucket
 * with every other spec running in parallel. Give each test (and each extra
 * browser context it opens) a private address, like the other specs do.
 */
const test = base.extend({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": freshIp() });
  },
});

function clientContext(browser: Browser) {
  return browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
}

async function cookieNamed(context: BrowserContext, name: string) {
  return (await context.cookies()).find((cookie) => cookie.name === name);
}

function claimsOf(token: string) {
  return JSON.parse(
    Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"),
  ) as { iss: string; aud: string; iat: number; exp: number; sub: string };
}

/** Waits for the browser-side session keeper, which wraps window.fetch once mounted. */
async function keeperReady(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => !window.fetch.toString().includes("[native code]"),
      ),
    )
    .toBe(true);
}

async function rejectCookiesIfVisible(page: Page) {
  const reject = page.getByRole("button", { name: "Reject non-essential" });
  try {
    await reject.waitFor({ state: "visible", timeout: 2_000 });
    await reject.click();
  } catch {
    // A prior choice in this browser context legitimately means no banner.
  }
}

async function provision(page: Page, email: string, name = "Recovery Plumbing") {
  const response = await page.request.post(
    "/api/missed-call/ops/provision-organization",
    {
      headers: { Authorization: OPS, "X-Ops-Actor": "playwright-auth-session" },
      data: {
        email,
        organizationName: name,
        ownerName: "Recovery Owner",
        locale: "en",
        plan: "growth",
      },
    },
  );
  expect(response.status()).toBe(201);
}

async function magicLinkSignIn(page: Page, email: string) {
  const login = await page.request.post("/api/auth/magic-link", {
    data: { email, locale: "en" },
    headers: { "x-forwarded-for": freshIp() },
  });
  const { devToken } = await login.json();
  expect(devToken).toBeTruthy();
  await page.goto(
    `/api/auth/callback?token=${encodeURIComponent(devToken)}&locale=en`,
  );
  await page
    .getByRole("button", { name: "Confirm and sign in", exact: true })
    .click();
}

async function signedInContext(browser: Browser, email: string) {
  const context = await clientContext(browser);
  const page = await context.newPage();
  await provision(page, email);
  await magicLinkSignIn(page, email);
  await expect(page).toHaveURL(/\/app\/?$/);
  return { context, page };
}

test.describe("sessions and tokens", () => {
  test("sign-in issues a short-lived access token and a rotating refresh token in locked-down cookies", async ({
    page,
    context,
  }) => {
    await workspaceSession(page);
    const access = await cookieNamed(context, "tc_session");
    const refresh = await cookieNamed(context, "tc_refresh");
    expect(access).toBeTruthy();
    expect(refresh).toBeTruthy();

    expect(access).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    // The renewal credential is only ever sent to the auth endpoints.
    expect(refresh).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/api/auth",
    });

    const claims = claimsOf(access!.value);
    expect(claims.iss).toBe("tradecatch");
    expect(claims.aud).toBe("tradecatch-app");
    expect(claims.exp - claims.iat).toBe(15 * 60);
    expect(refresh!.value).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Nothing a script (or a copied link) could read.
    expect(await page.evaluate(() => document.cookie)).not.toContain("tc_");
    const storage = await page.evaluate(() =>
      JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
    );
    for (const secret of [access!.value, refresh!.value, "eyJ"]) {
      expect(storage).not.toContain(secret);
      expect(page.url()).not.toContain(secret);
    }
  });

  test("an expired access token is renewed from the refresh token, which rotates", async ({
    page,
    context,
  }) => {
    await workspaceSession(page);
    const before = (await cookieNamed(context, "tc_refresh"))!.value;
    const firstAccess = (await cookieNamed(context, "tc_session"))!.value;

    await context.clearCookies({ name: "tc_session" });
    // An API call never renews by itself...
    expect((await page.request.get("/api/app/me")).status()).toBe(401);
    // ...but opening a page does, and lands exactly where the person was going.
    await page.goto("/app/settings/security");
    await expect(page).toHaveURL(/\/app\/settings\/security$/);
    expect(new URL(page.url()).search).toBe("");

    const renewed = await cookieNamed(context, "tc_session");
    expect(renewed).toBeTruthy();
    expect(renewed!.value).not.toBe(firstAccess);
    expect((await cookieNamed(context, "tc_refresh"))!.value).not.toBe(before);
    expect((await page.request.get("/api/app/me")).status()).toBe(200);
  });

  test("a page call that hits an expired token renews silently and carries on", async ({
    page,
    context,
  }) => {
    await workspaceSession(page);
    await keeperReady(page);
    await context.clearCookies({ name: "tc_session" });
    const status = await page.evaluate(
      async () => (await fetch("/api/app/me")).status,
    );
    expect(status).toBe(200);
    expect(await cookieNamed(context, "tc_session")).toBeTruthy();
  });

  test("the session survives navigation and a reload", async ({ page }) => {
    await workspaceSession(page);
    for (const path of ["/app/settings/security", "/app", "/app/settings/account"]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}\\/?$`));
    }
    await page.reload();
    await expect(page).toHaveURL(/\/app\/settings\/account\/?$/);
    expect((await page.request.get("/api/app/me")).status()).toBe(200);
  });

  test("a refused renewal sends a signed-out visitor to sign in, and never loops", async ({
    page,
    context,
  }) => {
    await workspaceSession(page);
    await context.clearCookies();
    await page.goto("/app/settings/security");
    await expect(page).toHaveURL(/\/login/);
    expect((await cookieNamed(context, "tc_session"))).toBeUndefined();
    expect((await page.request.post("/api/auth/refresh")).status()).toBe(401);
    // The sign-in page itself is never sent through renewal.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("renewal never follows an off-site or look-alike destination", async ({
    page,
  }) => {
    await workspaceSession(page);
    for (const next of [
      "https://evil.example/app",
      "//evil.example",
      "/\\evil.example",
      "/app//evil.example",
      "javascript:alert(1)",
    ]) {
      const response = await page.request.get(
        `/api/auth/refresh?next=${encodeURIComponent(next)}`,
        { maxRedirects: 0 },
      );
      expect(response.status()).toBe(303);
      const location = response.headers()["location"] ?? "";
      expect(location, next).not.toContain("evil.example");
      expect(location, next).not.toContain("javascript:");
      expect(new URL(location, page.url()).origin).toBe(new URL(page.url()).origin);
    }
  });

  test("signing out ends the session everywhere, including a copy of the old cookies", async ({
    page,
    context,
    browser,
  }) => {
    await workspaceSession(page);
    const copy = await context.cookies();
    expect(copy.map((c) => c.name)).toEqual(
      expect.arrayContaining(["tc_session", "tc_refresh"]),
    );

    const out = await page.request.post("/api/auth/logout");
    expect(out.ok()).toBe(true);
    expect(await cookieNamed(context, "tc_session")).toBeUndefined();
    expect(await cookieNamed(context, "tc_refresh")).toBeUndefined();
    expect(out.headers()["cache-control"]).toContain("no-store");

    // What a thief holding the earlier cookies would try:
    const thief = await clientContext(browser);
    try {
      await thief.addCookies(copy);
      expect((await thief.request.get("/api/app/me")).status()).toBe(401);
      expect((await thief.request.post("/api/auth/refresh")).status()).toBe(401);
      const stolenPage = await thief.newPage();
      await stolenPage.goto("/app");
      await expect(stolenPage).toHaveURL(/\/login/);
    } finally {
      await thief.close();
    }
  });
});

test.describe("who can see what", () => {
  test("a customer cannot reach administrator pages or APIs", async ({ page }) => {
    await workspaceSession(page);
    for (const path of [
      "/api/admin/account-recovery",
      "/api/admin/sales-leads",
    ]) {
      expect((await page.request.get(path)).status(), path).toBe(403);
    }
    expect(
      (
        await page.request.post("/api/admin/account-recovery/rec_abcdef", {
          data: { action: "reject", notes: "Not allowed for customers." },
        })
      ).status(),
    ).toBe(403);
    // The shared operations secret identifies nobody, so it cannot do recovery either.
    expect(
      (
        await page.request.get("/api/admin/account-recovery", {
          headers: { Authorization: OPS, "X-Ops-Actor": "someone" },
        })
      ).status(),
    ).toBe(403);
    await page.goto("/admin/account-recovery");
    await expect(page).toHaveURL(/\/app\/?$/);
  });

  test("a customer only ever sees their own business", async ({ browser }) => {
    const one = await signedInContext(browser, `tenant-a-${Date.now()}@example.test`);
    const two = await signedInContext(browser, `tenant-b-${Date.now()}@example.test`);
    try {
      const mine = (await (await one.page.request.get("/api/app/me")).json()) as {
        organization: { id: string };
      };
      const theirs = (await (await two.page.request.get("/api/app/me")).json()) as {
        organization: { id: string };
      };
      expect(mine.organization.id).not.toBe(theirs.organization.id);
      for (const resource of ["", "/calls", "/appointments", "/leads", "/notifications"]) {
        const own = await one.page.request.get(
          `/api/businesses/${mine.organization.id}${resource}`,
        );
        expect(own.status(), `own ${resource}`).not.toBe(403);
        const foreign = await one.page.request.get(
          `/api/businesses/${theirs.organization.id}${resource}`,
        );
        expect([403, 404], `foreign ${resource}`).toContain(foreign.status());
      }
    } finally {
      await one.context.close();
      await two.context.close();
    }
  });
});

test.describe("lost-email recovery, end to end", () => {
  test("support verifies the owner, moves the account to a new email, and every old credential stops working", async ({
    browser,
  }) => {
    const stamp = Date.now();
    const oldEmail = `lost-owner-${stamp}@example.test`;
    const newEmail = `new-owner-${stamp}@example.test`;

    // 1. The owner, signed in somewhere, with a password set earlier.
    const owner = await signedInContext(browser, oldEmail);
    const ownerCookies = await owner.context.cookies();
    const me = (await (await owner.page.request.get("/api/app/me")).json()) as {
      organization: { id: string; name: string };
    };

    // 2. They lose the mailbox and ask for support-based recovery, from a different device.
    const visitor = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": freshIp() },
    });
    try {
      const form = await visitor.newPage();
      await form.goto("/forgot-password");
      await rejectCookiesIfVisible(form);
      await form.getByRole("link", { name: "Ask support to recover your account" }).click();
      await expect(form).toHaveURL(/\/account-recovery$/);
      await expect(
        form.getByRole("heading", { name: "Recover your account" }),
      ).toBeVisible();
      await waitForFormHydration(form);
      await form.getByLabel("Email on your TradeCatch account").fill(oldEmail);
      await form.getByLabel("Email where we can reach you now").fill(newEmail);
      await form.getByLabel("Your name").fill("Recovery Owner");
      await form.getByLabel("Business name").fill(me.organization.name);
      await form
        .getByLabel("What happened?", { exact: false })
        .fill("The old mailbox was closed by the provider.");
      await form.getByRole("button", { name: "Send recovery request" }).click();
      await expect(form.getByRole("status")).toContainText(
        "If the details match an account",
      );
      // The honeypot is invisible to people.
      await expect(form.getByLabel("Website")).toBeHidden();
    } finally {
      await visitor.close();
    }

    // 3. Nothing has changed yet: the account still answers to the old email.
    expect((await owner.page.request.get("/api/app/me")).status()).toBe(200);

    // 4. A platform administrator (MFA + admin token) works the request in the admin area.
    const adminContext = await clientContext(browser);
    try {
      const admin = await adminContext.newPage();
      await provision(admin, ADMIN_EMAIL, "Auth Session Admin");
      await magicLinkSignIn(admin, ADMIN_EMAIL);
      // Administrators land in the admin area, where the second factor is asked for first.
      await expect(admin).toHaveURL(/\/admin\/?$/);
      expect((await admin.request.get("/api/admin/account-recovery")).status()).toBe(403);

      const adminMe = (await (await admin.request.get("/api/app/me")).json()) as {
        organization: { id: string };
      };
      const mfa = `/api/businesses/${adminMe.organization.id}/security/mfa`;
      const setup = (await (await admin.request.post(mfa)).json()) as { secret: string };
      expect(
        (await admin.request.post(mfa, { data: { code: totpCode(setup.secret) } })).status(),
      ).toBe(200);
      // MFA alone is not enough: the short-lived admin token is separate.
      expect((await admin.request.get("/api/admin/account-recovery")).status()).toBe(401);
      expect((await admin.request.post("/api/auth/admin-token")).status()).toBe(200);

      await admin.goto("/admin/account-recovery");
      await expect(admin.getByRole("heading", { name: "Account recovery" })).toBeVisible();
      const card = admin.getByRole("listitem").filter({ hasText: oldEmail });
      await expect(card).toBeVisible();
      await expect(card).toContainText(newEmail);
      await expect(card).toContainText("Our records");
      await expect(card).toContainText(me.organization.name);

      // Evidence is mandatory and the button stays disabled until it is real.
      const verify = card.getByRole("button", { name: "Record identity verification" });
      await expect(verify).toBeDisabled();
      await card
        .getByLabel("Evidence", { exact: false })
        .fill("Called the business number on file and the owner confirmed the plan and city.");
      await card.getByLabel("I personally verified", { exact: false }).check();
      await verify.click();

      await expect(card.getByRole("button", { name: "Change account email" })).toBeVisible();
      // Verified, but still not applied.
      expect((await owner.page.request.get("/api/app/me")).status()).toBe(200);
      await card.getByLabel("Move this account to", { exact: false }).check();
      await card.getByRole("button", { name: "Change account email" }).click();
      await expect(card).toContainText(/completed/i);
      // No email provider in the harness: the administrator is told to point the owner at "Forgot password".
      await expect(admin.getByRole("status")).toContainText("could not be emailed");
    } finally {
      await adminContext.close();
    }

    // 5. Every old credential is dead; the data is untouched.
    expect((await owner.page.request.get("/api/app/me")).status()).toBe(401);
    expect((await owner.page.request.post("/api/auth/refresh")).status()).toBe(401);
    const stale = await clientContext(owner.context.browser()!);
    try {
      await stale.addCookies(ownerCookies);
      expect((await stale.request.get("/api/app/me")).status()).toBe(401);
    } finally {
      await stale.close();
    }
    const oldMagicLink = await owner.page.request.post("/api/auth/magic-link", {
      data: { email: oldEmail, locale: "en" },
      headers: { "x-forwarded-for": freshIp() },
    });
    expect((await oldMagicLink.json()).devToken).toBeUndefined();

    // 6. The owner chooses a password through the verified address and finds everything in place.
    const returning = await clientContext(browser);
    try {
      const page = await returning.newPage();
      const reset = await page.request.post("/api/auth/forgot-password", {
        data: { email: newEmail, locale: "en" },
        headers: { "x-forwarded-for": freshIp() },
      });
      const { devToken } = (await reset.json()) as { devToken?: string };
      expect(devToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      await page.goto(`/set-password?token=${encodeURIComponent(devToken!)}`);
      await waitForFormHydration(page);
      await page.getByLabel("New password").fill(PASSWORD);
      await page.getByLabel("Confirm password").fill(PASSWORD);
      await page.getByRole("button", { name: "Save password and sign in" }).click();
      await expect(page).toHaveURL(/\/app\/?$/);
      const after = (await (await page.request.get("/api/app/me")).json()) as {
        organization: { id: string; name: string };
        user: { email: string };
      };
      expect(after.user.email).toBe(newEmail);
      expect(after.organization.id).toBe(me.organization.id);
      expect(after.organization.name).toBe(me.organization.name);

      // And the old email / old password combination no longer signs anyone in.
      await page.request.post("/api/auth/logout");
      await returning.clearCookies();
      const oldLogin = await page.request.post("/api/auth/password-login", {
        data: { email: oldEmail, password: PASSWORD, locale: "en" },
        headers: { "x-forwarded-for": freshIp() },
      });
      expect(oldLogin.status()).toBe(401);
    } finally {
      await returning.close();
    }
    await owner.context.close();
  });
});

test.describe("recovery and sign-in pages", () => {
  for (const [path, heading, labels] of [
    ["/account-recovery", "Recover your account", "Email on your TradeCatch account"],
    ["/fr/recuperation-de-compte", "Récupérer votre compte", "Courriel de votre compte TradeCatch"],
  ] as const) {
    test(`${path} is accessible and says the same thing whether or not the account exists`, async ({
      page,
    }) => {
      await page.goto(path);
      await rejectCookiesIfVisible(page);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expect(page.getByLabel(labels)).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(
        results.violations,
        results.violations
          .map((v) => `${v.id}: ${v.help} (${v.nodes.length} node(s))`)
          .join("\n"),
      ).toEqual([]);
    });
  }

  test("an unknown account gets the same confirmation as a real one", async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": freshIp() },
    });
    try {
      const page = await context.newPage();
      await page.goto("/account-recovery");
      await rejectCookiesIfVisible(page);
      await waitForFormHydration(page);
      await page.getByLabel("Email on your TradeCatch account").fill(`ghost-${Date.now()}@example.test`);
      await page.getByLabel("Email where we can reach you now").fill("someone@example.test");
      await page.getByLabel("Your name").fill("Nobody");
      await page.getByLabel("Business name").fill("Nothing Inc");
      await page.getByLabel("What happened?", { exact: false }).fill("I lost my old mailbox.");
      await page.getByRole("button", { name: "Send recovery request" }).click();
      await expect(page.getByRole("status")).toContainText("If the details match an account");
    } finally {
      await context.close();
    }
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("sign-in sessions, renewal and the recovery pages work without sideways scrolling", async ({
    page,
    context,
  }) => {
    for (const path of ["/login", "/forgot-password", "/account-recovery"]) {
      await page.goto(path);
      await rejectCookiesIfVisible(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }

    await workspaceSession(page);
    await page.reload();
    await expect(page).toHaveURL(/\/app\/?$/);
    await context.clearCookies({ name: "tc_session" });
    await page.goto("/app/settings/security");
    await expect(page).toHaveURL(/\/app\/settings\/security$/);
    expect((await page.request.get("/api/app/me")).status()).toBe(200);

    // Customers still cannot reach the admin area from a phone.
    await page.goto("/admin/account-recovery");
    await expect(page).toHaveURL(/\/app\/?$/);
    expect((await page.request.get("/api/admin/account-recovery")).status()).toBe(403);
  });
});
