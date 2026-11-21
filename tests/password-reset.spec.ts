import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { waitForFormHydration } from "./support/hydration";

/**
 * KAN-27: password reset links, against the real built server.
 * RESET-13 is the phone flow. The other criteria (expiry to the millisecond,
 * database failure, log contents, store races) are in the unit tests, where the
 * clock and the failures can be controlled; here we check what only a browser
 * and the real server can show: the fragment link, the reload, the headers, what
 * the page asks the network for, and the same rules over real HTTP.
 */

const OPS = "Bearer tradecatch-e2e-ops-secret-not-for-production";
const PASSWORD = "Copper-Pipe-Kettle-82";
const NEXT_PASSWORD = "Maple-Wrench-Lantern-47";
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const EXPIRED_EN = "This password reset link has expired or has already been used.";

// Reset limits are keyed by client address and by account. Every test gets its
// own address and its own accounts so parallel specs cannot spend each other's.
const freshIp = () =>
  `2001:db8:${randomUUID().replaceAll("-", "").match(/.{4}/g)!.slice(0, 6).join(":")}`;
const test = base.extend({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": freshIp() });
  },
});

async function rejectCookiesIfVisible(page: Page) {
  const reject = page.getByRole("button", { name: "Reject non-essential" });
  try {
    await reject.waitFor({ state: "visible", timeout: 2_000 });
    await reject.click();
  } catch {
    // A prior choice in this browser context legitimately means no banner.
  }
}

async function provision(page: Page, email: string) {
  const response = await page.request.post("/api/missed-call/ops/provision-organization", {
    headers: { Authorization: OPS, "X-Ops-Actor": "playwright-password-reset" },
    data: {
      email,
      organizationName: "Plomberie Reinitialisation",
      ownerName: "Reset Owner",
      locale: "en",
      plan: "essential",
    },
  });
  expect(response.status()).toBe(201);
}

/** Asks for a reset link over HTTP; the local harness hands the link back. */
async function requestToken(
  page: Page,
  email: string,
  locale: "en" | "fr" = "en",
): Promise<string> {
  const response = await page.request.post("/api/auth/forgot-password", {
    data: { email, locale },
    headers: { "x-forwarded-for": freshIp() },
  });
  expect(response.status()).toBe(200);
  const { devToken } = (await response.json()) as { devToken?: string };
  expect(devToken).toMatch(TOKEN_SHAPE);
  return devToken!;
}

const newEmail = (label: string) => `reset-${label}-${Date.now()}-${randomUUID().slice(0, 6)}@example.test`;

async function ownerWithPassword(page: Page, label: string) {
  const email = newEmail(label);
  await provision(page, email);
  const token = await requestToken(page, email);
  const set = await page.request.post("/api/auth/set-password", {
    data: { token, password: PASSWORD, locale: "en" },
  });
  expect(set.status()).toBe(200);
  return email;
}

async function otherContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: process.env.TRADECATCH_E2E_BASE_URL ?? "http://localhost:3100",
    extraHTTPHeaders: { "x-forwarded-for": freshIp() },
  });
}

test.describe("RESET-13 reset on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("request, open the emailed link, refresh, choose a password, signed in", async ({
    page,
  }) => {
    const email = newEmail("phone");
    await provision(page, email);

    await page.goto("/login");
    await rejectCookiesIfVisible(page);
    await page.getByRole("link", { name: "Forgot your password?" }).tap();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await waitForFormHydration(page);
    await page.getByLabel("Work email").fill(email);
    await page.getByRole("button", { name: "Email me a reset link" }).tap();
    await expect(page.getByRole("status")).toContainText("If that email has an account");

    // The emailed link: HTTPS-style address, the secret in the fragment only.
    await page.getByRole("link", { name: "Choose a new password" }).tap();
    await expect(page).toHaveURL(/\/set-password#token=[A-Za-z0-9_-]{43}$/);
    expect(new URL(page.url()).search).toBe("");
    await expect(page.getByLabel("New password")).toBeVisible();

    // A refresh on a phone must not lose the link.
    await page.reload();
    await expect(page).toHaveURL(/\/set-password#token=/);
    await expect(page.getByLabel("New password")).toBeVisible();
    await waitForFormHydration(page);

    // Nothing spills sideways; every control fits the narrow screen.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    for (const control of [
      page.getByLabel("New password"),
      page.getByLabel("Confirm password"),
      page.getByRole("button", { name: "Save password and sign in" }),
    ]) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }

    await page.getByLabel("New password").fill(NEXT_PASSWORD);
    await page.getByLabel("Confirm password").fill(NEXT_PASSWORD);
    await page.getByRole("button", { name: "Save password and sign in" }).tap();
    await expect(page).toHaveURL(/\/app\/?$/);
    expect((await page.request.get("/api/app/me")).status()).toBe(200);

    // And the same link is dead on the same phone afterwards.
    const used = await page.request.post("/api/auth/set-password", {
      data: { token: "A".repeat(43), password: PASSWORD, locale: "en" },
    });
    expect(used.status()).toBe(400);
  });

  test("a link in the older ?token= form still works and is moved out of the address", async ({
    page,
  }) => {
    const email = newEmail("legacy");
    await provision(page, email);
    const token = await requestToken(page, email);

    await page.goto(`/set-password?token=${encodeURIComponent(token)}`);
    await expect(page.getByLabel("New password")).toBeVisible();
    const link = new URL(page.url());
    expect(link.search).toBe("");
    expect(link.hash).toBe(`#token=${token}`);

    await waitForFormHydration(page);
    await page.getByLabel("New password").fill(NEXT_PASSWORD);
    await page.getByLabel("Confirm password").fill(NEXT_PASSWORD);
    await page.getByRole("button", { name: "Save password and sign in" }).tap();
    await expect(page).toHaveURL(/\/app\/?$/);
  });

  test("an expired or used link says so and 'Request a New Link' leads to a fresh one", async ({
    page,
  }) => {
    const email = newEmail("used");
    await provision(page, email);
    const first = await requestToken(page, email);
    const second = await requestToken(page, email); // supersedes the first

    await page.goto(`/set-password#token=${first}`);
    await expect(page.getByText(EXPIRED_EN).first()).toBeVisible();
    await expect(page.getByLabel("New password")).toHaveCount(0);
    await page.getByRole("link", { name: "Request a New Link" }).tap();
    await expect(page).toHaveURL(/\/forgot-password$/);

    // The newer link is still good.
    await page.goto(`/set-password#token=${second}`);
    await expect(page.getByLabel("New password")).toBeVisible();
  });

  test("the choose-a-password page has no automatically detectable WCAG A/AA violations", async ({
    page,
  }) => {
    const email = newEmail("axe");
    await provision(page, email);
    const token = await requestToken(page, email);
    await page.goto(`/set-password#token=${token}`);
    await expect(page.getByLabel("New password")).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations,
      results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`).join("\n"),
    ).toEqual([]);
  });
});

test.describe("the reset link over real HTTP", () => {
  test("RESET-06: a newer link replaces the older one", async ({ page }) => {
    const email = newEmail("supersede");
    await provision(page, email);
    const first = await requestToken(page, email);
    const second = await requestToken(page, email);

    const stale = await page.request.post("/api/auth/set-password", {
      data: { token: first, password: NEXT_PASSWORD, locale: "en" },
    });
    expect(stale.status()).toBe(400);
    expect(await stale.json()).toEqual({ error: "invalid_link" });
    const fresh = await page.request.post("/api/auth/set-password", {
      data: { token: second, password: NEXT_PASSWORD, locale: "en" },
    });
    expect(fresh.status()).toBe(200);
  });

  test("RESET-05: invented and malformed links change nothing", async ({ page }) => {
    const email = await ownerWithPassword(page, "invented");
    const real = await requestToken(page, email);
    for (const token of ["A".repeat(43), "short", `${real}x`, real.slice(0, 42), "!".repeat(43)]) {
      const res = await page.request.post("/api/auth/set-password", {
        data: { token, password: NEXT_PASSWORD, locale: "en" },
      });
      expect([400, 422]).toContain(res.status());
      expect(res.headers()["set-cookie"]).toBeUndefined();
      // Wrong-shaped input is refused outright (400); anything shaped like a link
      // but not live answers `valid: false`. Neither ever says `valid: true`.
      const check = await page.request.post("/api/auth/set-password/check", { data: { token } });
      expect([200, 400]).toContain(check.status());
      expect(await check.json()).not.toMatchObject({ valid: true });
      if (check.status() === 200) expect(await check.json()).toEqual({ valid: false });
    }
    const login = await page.request.post("/api/auth/password-login", {
      data: { email, password: PASSWORD, locale: "en" },
    });
    expect(login.status()).toBe(200);
    // The real link survived all of that.
    const check = await page.request.post("/api/auth/set-password/check", { data: { token: real } });
    expect(await check.json()).toEqual({ valid: true, kind: "reset" });
  });

  test("RESET-09: five simultaneous submissions, exactly one succeeds", async ({ page }) => {
    const email = await ownerWithPassword(page, "race");
    const token = await requestToken(page, email);
    const passwords = [
      NEXT_PASSWORD,
      "Birch-Tundra-Violet-33",
      "Pine-Garnet-Ocean-58",
      "Slate-Orchid-Meadow-71",
      "Cedar-Anvil-Harbour-19",
    ];
    const results = await Promise.all(
      passwords.map((password) =>
        page.request.post("/api/auth/set-password", { data: { token, password, locale: "en" } }),
      ),
    );
    expect(results.map((r) => r.status()).sort()).toEqual([200, 400, 400, 400, 400]);

    let winners = 0;
    for (const password of passwords) {
      const login = await page.request.post("/api/auth/password-login", {
        data: { email, password, locale: "en" },
        headers: { "x-forwarded-for": freshIp() },
      });
      if (login.status() === 200) winners += 1;
    }
    expect(winners).toBe(1);
  });

  test("RESET-10: finishing a reset signs out every other session", async ({ page, browser }) => {
    const email = await ownerWithPassword(page, "sessions");
    // `page` is signed in from choosing its password; a second device signs in too.
    const phone = await otherContext(browser);
    try {
      const login = await phone.request.post("/api/auth/password-login", {
        data: { email, password: PASSWORD, locale: "en" },
      });
      expect(login.status()).toBe(200);
      expect((await phone.request.get("/api/app/me")).status()).toBe(200);
      expect((await page.request.get("/api/app/me")).status()).toBe(200);

      const token = await requestToken(page, email);
      const done = await page.request.post("/api/auth/set-password", {
        data: { token, password: NEXT_PASSWORD, locale: "en" },
      });
      expect(done.status()).toBe(200);

      // The other device is out, access and refresh both; the finishing browser is in.
      expect((await phone.request.get("/api/app/me")).status()).toBe(401);
      expect((await phone.request.post("/api/auth/refresh")).status()).toBe(401);
      expect((await page.request.get("/api/app/me")).status()).toBe(200);

      const old = await phone.request.post("/api/auth/password-login", {
        data: { email, password: PASSWORD, locale: "en" },
      });
      expect(old.status()).toBe(401);
    } finally {
      await phone.close();
    }
  });

  test("RESET-08: asking too often is slowed down, for unknown addresses too", async ({ page }) => {
    // An account that has not asked for anything yet: all five requests are left.
    const known = newEmail("limit");
    await provision(page, known);
    const unknown = `nobody-${randomUUID().slice(0, 8)}@example.test`;
    for (const email of [known, unknown]) {
      const statuses: number[] = [];
      let retryAfter: string | undefined;
      for (let i = 0; i < 7; i += 1) {
        // A different address each time: only the per-account budget can stop this.
        const res = await page.request.post("/api/auth/forgot-password", {
          data: { email, locale: "en" },
          headers: { "x-forwarded-for": freshIp() },
        });
        statuses.push(res.status());
        if (res.status() === 429) retryAfter = res.headers()["retry-after"];
      }
      expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
      expect(statuses.slice(5)).toEqual([429, 429]);
      expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
    }
  });

  test("the page and its answers are never cached, never leak a referrer, and stay out of search", async ({
    page,
  }) => {
    for (const path of ["/set-password", "/fr/definir-mot-de-passe"]) {
      const res = await page.request.get(path);
      expect(res.status()).toBe(200);
      const headers = res.headers();
      expect(headers["referrer-policy"]).toBe("no-referrer");
      expect(headers["cache-control"]).toMatch(/no-store/);
      expect(headers["x-robots-tag"]).toMatch(/noindex/);
    }
    // Scoped to the secret page: the rest of the site keeps its normal policy.
    const other = await page.request.get("/forgot-password");
    expect(other.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");

    for (const [path, body] of [
      ["/api/auth/set-password/check", { token: "A".repeat(43) }],
      ["/api/auth/set-password", { token: "A".repeat(43), password: NEXT_PASSWORD, locale: "en" }],
      ["/api/auth/forgot-password", { email: "x@example.test", locale: "en" }],
    ] as const) {
      const res = await page.request.post(path, { data: body });
      expect(res.headers()["cache-control"], path).toMatch(/no-store/);
    }
  });

  test("opening the link asks only this site for anything, and the secret appears nowhere but the request body", async ({
    page,
  }) => {
    const email = newEmail("network");
    await provision(page, email);
    const token = await requestToken(page, email);

    const requested: { url: string; method: string; body: string | null }[] = [];
    const consoleLines: string[] = [];
    page.on("request", (request) =>
      requested.push({ url: request.url(), method: request.method(), body: request.postData() }),
    );
    page.on("console", (message) => consoleLines.push(message.text()));
    page.on("pageerror", (error) => consoleLines.push(error.message));

    await page.goto(`/set-password#token=${token}`);
    await expect(page.getByLabel("New password")).toBeVisible();
    await page.waitForLoadState("networkidle");

    const origin = new URL(page.url()).origin;
    for (const request of requested) {
      if (request.url.startsWith("data:") || request.url.startsWith("blob:")) continue;
      expect(new URL(request.url).origin, request.url).toBe(origin);
      expect(request.url, "the secret is never in an address").not.toContain(token);
    }
    // The one place it travels is the body of the check, a POST to this site.
    const checks = requested.filter((r) => r.url.endsWith("/api/auth/set-password/check"));
    expect(checks).toHaveLength(1);
    expect(checks[0]!.method).toBe("POST");
    expect(checks[0]!.body).toContain(token);
    expect(consoleLines.join("\n")).not.toContain(token);
    // No analytics tag loads on this page, even before any consent decision.
    expect(requested.some((r) => /googletagmanager|google-analytics/.test(r.url))).toBe(false);
  });

  test("the French pages: French form, French expired message, French way to ask again", async ({
    page,
  }) => {
    const email = newEmail("fr");
    await provision(page, email);
    const token = await requestToken(page, email, "fr");
    await page.goto(`/fr/definir-mot-de-passe#token=${token}`);
    await expect(page.getByLabel("Nouveau mot de passe", { exact: true })).toBeVisible();

    await page.goto(`/fr/definir-mot-de-passe#token=${"B".repeat(43)}`);
    await expect(
      page
        .getByText("Ce lien de réinitialisation du mot de passe a expiré ou a déjà été utilisé.")
        .first(),
    ).toBeVisible();
    await page.getByRole("link", { name: "Demander un nouveau lien" }).click();
    await expect(page).toHaveURL(/\/fr\/mot-de-passe-oublie$/);
  });

  test("pasting a newer link into the tab that is already open checks the new link", async ({
    page,
  }) => {
    const email = newEmail("paste");
    await provision(page, email);
    const stale = await requestToken(page, email);
    const live = await requestToken(page, email); // supersedes `stale`

    await page.goto(`/set-password#token=${stale}`);
    await expect(page.getByText(EXPIRED_EN).first()).toBeVisible();
    // Same page, different fragment: the browser does not reload.
    await page.goto(`/set-password#token=${live}`);
    await expect(page.getByLabel("New password")).toBeVisible();
    await expect(page.getByText(EXPIRED_EN)).toHaveCount(0);
    // And back to the dead one.
    await page.goto(`/set-password#token=${stale}`);
    await expect(page.getByText(EXPIRED_EN).first()).toBeVisible();
    await expect(page.getByLabel("New password")).toHaveCount(0);
  });

  test("a link that cannot be checked is reported as a problem, never as an expired link", async ({
    page,
  }) => {
    const email = newEmail("outage");
    await provision(page, email);
    const token = await requestToken(page, email);
    await page.route("**/api/auth/set-password/check", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }),
    );
    await page.goto(`/set-password#token=${token}`);
    await expect(page.getByText(/could not check your link/i)).toBeVisible();
    await expect(page.getByText(EXPIRED_EN)).toHaveCount(0);

    // Once the outage is over, one tap on "Try again" gets the form.
    await page.unroute("**/api/auth/set-password/check");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByLabel("New password")).toBeVisible();
  });
});
