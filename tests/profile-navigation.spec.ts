import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { ADMINS, freshIp, provisionOrganization, signInWithMagicLink } from "./support/admin-session";
import { waitForFormHydration } from "./support/hydration";
import { workspaceSession } from "./support/workspace-session";

/**
 * KAN-25: the header's profile icon, and the sign-in redirects around it.
 *
 * NAV-01..NAV-12 are the acceptance scenarios. NAV-13..NAV-15 cover what the
 * icon relies on: the sign-in page's own redirect, loops, and that nothing
 * secret reaches the page. Administrator identities adm-24..adm-29 come from
 * the harness list in playwright.config.ts; each test that needs one has its
 * own, because a business can only be provisioned once per server run.
 */

// Every client without its own forwarded address shares one rate-limit bucket
// with every other spec running in parallel: give each test a private one.
const test = base.extend({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": freshIp() });
  },
});

const PASSWORD = "Copper-Pipe-Kettle-82";

// The icon's session check has a client-side time limit, and the first requests to a
// freshly started server are slow (routes load on first use, and several workers start
// at once). Touch the routes this spec depends on once, so that no test pays for it.
test.beforeAll(async ({ playwright }, testInfo) => {
  const origin = testInfo.project.use.baseURL;
  const warm = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { "x-forwarded-for": freshIp() },
  });
  for (const path of ["/", "/fr", "/login", "/fr/connexion", "/api/auth/session", "/app", "/admin"]) {
    await warm.get(path, { timeout: 90_000, maxRedirects: 0 }).catch(() => undefined);
  }
  await warm.dispose();
});

/** The one profile icon in the page header. */
const accountIcon = (page: Page) => page.locator("header a[data-account-state]");

async function expectIcon(
  page: Page,
  state: "anonymous" | "signed_in",
  name: string,
  href: string,
) {
  const icon = accountIcon(page);
  await expect(icon).toHaveAttribute("data-account-state", state);
  await expect(icon).toHaveAccessibleName(name);
  await expect(icon).toHaveAttribute("href", href);
  return icon;
}

async function signInAdmin(page: Page, id: string) {
  const email = ADMINS.super(id);
  await provisionOrganization(page.request, {
    email,
    organizationName: `Profile Nav Admin ${id}`,
  });
  await signInWithMagicLink(page, email, "en", /\/admin\/?$/);
  return email;
}

/** Gives an account a password through the same reset flow a person uses. Leaves the browser signed out. */
async function choosePassword(page: Page, email: string): Promise<string> {
  const headers = { "x-forwarded-for": freshIp() };
  const forgot = await page.request.post("/api/auth/forgot-password", {
    data: { email, locale: "en" },
    headers,
  });
  const { devToken } = await forgot.json();
  expect(devToken, "dev reset token").toBeTruthy();
  const saved = await page.request.post("/api/auth/set-password", {
    data: { token: devToken, password: PASSWORD, locale: "en" },
    headers,
  });
  expect(saved.status()).toBe(200);
  const { next } = (await saved.json()) as { next: string };
  expect((await page.request.post("/api/auth/logout")).ok()).toBe(true);
  await page.context().clearCookies();
  return next;
}

async function passwordSignIn(page: Page, email: string, path = "/login") {
  await page.goto(path);
  await waitForFormHydration(page);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
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

const cookieNames = async (page: Page) =>
  (await page.context().cookies()).map((cookie) => cookie.name);

/**
 * Pages in the workspace render before React attaches to them; a click in that gap does
 * nothing. Wait until the element has its handlers (the same test as `support/hydration`,
 * for a button found by role, with the same 15 s allowance: the workspace is a large
 * bundle and four browsers share the machine).
 */
const waitUntilHydrated = (locator: Locator) =>
  expect
    .poll(() => locator.evaluate((el) => Object.keys(el).some((key) => key.startsWith("__reactProps"))), {
      timeout: 15_000,
    })
    .toBe(true);

/** The pages the main frame has been on, in order, without the repeats that same-page history updates cause. */
function trackVisits(page: Page): string[] {
  const visited: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    const path = new URL(frame.url()).pathname;
    if (visited.at(-1) !== path) visited.push(path);
  });
  return visited;
}

test.describe("profile icon: where it sends each kind of visitor", () => {
  test("NAV-01 a signed-out visitor who clicks the icon reaches the sign-in page (English and French)", async ({ page }) => {
    await page.goto("/");
    const icon = await expectIcon(page, "anonymous", "Login", "/login");
    await icon.click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();

    await page.goto("/fr");
    const french = await expectIcon(page, "anonymous", "Connexion", "/fr/connexion");
    await french.click();
    await expect(page).toHaveURL(/\/fr\/connexion$/);
  });

  test("NAV-02 a signed-in customer who clicks the icon reaches their own dashboard", async ({ page }) => {
    await workspaceSession(page);
    await page.goto("/");
    const icon = await expectIcon(page, "signed_in", "My dashboard", "/app");
    await icon.click();
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    await workspaceSession(page, "fr");
    await page.goto("/fr");
    const french = await expectIcon(page, "signed_in", "Mon tableau de bord", "/fr/app");
    await french.click();
    await expect(page).toHaveURL(/\/fr\/app\/?$/, { timeout: 20_000 });
  });

  test("NAV-03 a signed-in administrator who clicks the icon reaches the admin dashboard", async ({ page }) => {
    await signInAdmin(page, "24");
    await page.goto("/");
    const icon = await expectIcon(page, "signed_in", "Admin dashboard", "/admin");
    await icon.click();
    // The first administrator page a fresh server renders is slow (large bundle, second-factor gate).
    await expect(page).toHaveURL(/\/admin\/?$/, { timeout: 20_000 });
    await expect(page.getByRole("navigation", { name: "TradeCatch Admin" })).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("profile icon: sessions that end", () => {
  test("NAV-04 a session that ended on the server sends the click to sign-in and clears what the browser kept", async ({ page }) => {
    await workspaceSession(page);
    await page.goto("/");
    const icon = await expectIcon(page, "signed_in", "My dashboard", "/app");

    // End the session on the server, as signing out in another tab does, then put the
    // browser's now-dead cookies back: the page still shows its old, signed-in icon.
    const kept = await page.context().cookies();
    expect(kept.map((cookie) => cookie.name)).toEqual(expect.arrayContaining(["tc_session", "tc_refresh"]));
    expect((await page.request.post("/api/auth/logout")).ok()).toBe(true);
    await page.context().clearCookies();
    await page.context().addCookies(kept);
    await expect(icon).toHaveAttribute("data-account-state", "signed_in");

    await icon.click();
    await expect(page).toHaveURL(/\/login$/);
    // The invalid sign-in is cleared, not left to bounce the person around.
    const names = await cookieNames(page);
    expect(names).not.toContain("tc_session");
    expect(names).not.toContain("tc_refresh");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  });

  test("NAV-04 cookies the browser let expire send the click to sign-in too", async ({ page }) => {
    await workspaceSession(page);
    await page.goto("/");
    const icon = await expectIcon(page, "signed_in", "My dashboard", "/app");
    await page.context().clearCookies();
    await icon.click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("NAV-04 an expired access token alone does not sign anyone out: the refresh token keeps them in", async ({ page }) => {
    await workspaceSession(page);
    // The 15-minute access cookie is gone; the 14-day refresh cookie remains.
    await page.context().clearCookies({ name: "tc_session" });
    await page.goto("/");
    const icon = await expectIcon(page, "signed_in", "My dashboard", "/app");
    await icon.click();
    await expect(page).toHaveURL(/\/app\/?$/);
    expect(await cookieNames(page)).toContain("tc_session");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("NAV-04 the same holds for an administrator whose access token expired", async ({ page }) => {
    await signInAdmin(page, "25");
    await page.context().clearCookies({ name: "tc_session" });
    await page.goto("/");
    const icon = await expectIcon(page, "signed_in", "Admin dashboard", "/admin");
    await icon.click();
    await expect(page).toHaveURL(/\/admin\/?$/);
  });

  test("NAV-05 nothing is decided while the session is still being checked", async ({ page }) => {
    await workspaceSession(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let asked = 0;
    await page.route("**/api/auth/session*", async (route) => {
      asked += 1;
      await gate;
      await route.continue();
    });

    await page.goto("/");
    const icon = accountIcon(page);
    await expect(icon).toHaveAttribute("data-account-state", "loading");
    await expect(icon).toHaveAccessibleName("Account");

    await icon.click();
    await expect(icon).toHaveAttribute("aria-busy", "true");
    // Well past any redirect a premature click could cause: still on the same page,
    // and above all not on the sign-in page.
    await page.waitForTimeout(800);
    await expect(page).toHaveURL(/localhost:\d+\/$/);

    release();
    await expect(page).toHaveURL(/\/app\/?$/);
    expect(asked, "the click shared the check already running").toBe(1);
  });

  test("NAV-05 a signed-out visitor who clicks during the check still ends on sign-in, after it", async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/auth/session*", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/");
    await accountIcon(page).click();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/localhost:\d+\/$/);
    release();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("NAV-05 when the check cannot be completed the link falls back to sign-in, and the sign-in page still recognises a signed-in customer", async ({ page }) => {
    await workspaceSession(page);
    await page.route("**/api/auth/session*", (route) =>
      route.fulfill({ status: 503, json: { state: "unavailable" } }),
    );
    await page.goto("/");
    const icon = accountIcon(page);
    await expect(icon).toHaveAttribute("data-account-state", "unavailable");
    await icon.click();
    // /login itself sends a signed-in customer on, so an outage never shows them a login form.
    await expect(page).toHaveURL(/\/app\/?$/);
  });
});

test.describe("authorization and sign-in redirects", () => {
  test("NAV-06 a customer who opens an admin route is denied, on the page and on the API", async ({ page }) => {
    await workspaceSession(page);
    // The icon never offers the admin dashboard to a customer. (Checked first: opening a
    // French page sets the language cookie, which would make "/" the French home page.)
    await page.goto("/");
    await expectIcon(page, "signed_in", "My dashboard", "/app");

    for (const path of ["/admin", "/admin/payments", "/admin/audit-logs", "/fr/admin"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/(fr\/)?app\/?$/);
      await expect(page.getByRole("navigation", { name: "TradeCatch Admin" }), path).toHaveCount(0);
    }
    for (const url of ["/api/admin/me", "/api/admin/overview", "/api/admin/businesses", "/api/admin/audit-logs"]) {
      expect((await page.request.get(url)).status(), url).toBe(403);
    }
  });

  test("NAV-06 a signed-out visitor who opens an admin route is sent to sign in, and the admin API refuses them", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
    const status = (await page.request.get("/api/admin/me")).status();
    expect([401, 403]).toContain(status);
  });

  test("NAV-07 a customer's sign-in lands on their dashboard, honouring only a safe destination", async ({ page }) => {
    const email = `nav-customer-${Date.now()}@example.test`;
    await provisionOrganization(page.request, { email, organizationName: "Nav Customer Plumbing" });
    expect(await choosePassword(page, email)).toBe("/app");

    await passwordSignIn(page, email);
    await expect(page).toHaveURL(/\/app\/?$/);

    // A page they were heading to is honoured; another site, or an admin page, never is.
    const attempt = async (next: string) => {
      const response = await page.request.post("/api/auth/password-login", {
        data: { email, password: PASSWORD, locale: "en", next },
        headers: { "x-forwarded-for": freshIp() },
      });
      expect(response.status()).toBe(200);
      return ((await response.json()) as { next: string }).next;
    };
    expect(await attempt("/app/leads")).toBe("/app/leads");
    for (const unsafe of ["https://evil.example/app", "//evil.example", "/admin", "/admin/payments", "/login"]) {
      expect(await attempt(unsafe), unsafe).toBe("/app");
    }
  });

  test("NAV-07 an administrator's sign-in, by password and by emailed link, lands on the admin dashboard", async ({ page }) => {
    const email = ADMINS.super("26");
    await provisionOrganization(page.request, { email, organizationName: "Profile Nav Admin 26" });
    expect(await choosePassword(page, email)).toBe("/admin");

    await passwordSignIn(page, email);
    await expect(page).toHaveURL(/\/admin\/?$/);

    await page.request.post("/api/auth/logout");
    await page.context().clearCookies();
    await signInWithMagicLink(page, email, "en", /\/admin\/?$/);
  });

  test("NAV-07 an emailed-link sign-in on the French site lands on the French dashboard", async ({ page }) => {
    await workspaceSession(page, "fr");
    await expect(page).toHaveURL(/\/fr\/app\/?$/);
  });

  test("NAV-08 refreshing a signed-in page keeps the session, and the icon still knows", async ({ page }) => {
    await workspaceSession(page);
    const before = (await page.context().cookies()).find((cookie) => cookie.name === "tc_session")!.value;
    await page.reload();
    await expect(page).toHaveURL(/\/app\/?$/);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    expect((await page.context().cookies()).find((cookie) => cookie.name === "tc_session")!.value).toBe(before);

    await page.goto("/");
    await expectIcon(page, "signed_in", "My dashboard", "/app");
    await page.reload();
    await expectIcon(page, "signed_in", "My dashboard", "/app");
  });

  test("NAV-08 the same for an administrator", async ({ page }) => {
    await signInAdmin(page, "27");
    await page.reload();
    await expect(page).toHaveURL(/\/admin\/?$/);
    await page.goto("/");
    await expectIcon(page, "signed_in", "Admin dashboard", "/admin");
  });

  test("NAV-09 after signing out, the icon leads to sign-in again", async ({ page }) => {
    await workspaceSession(page);
    const signOut = page.getByRole("button", { name: "Sign out" });
    await waitUntilHydrated(signOut);
    await signOut.click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await cookieNames(page)).not.toContain("tc_session");

    await page.goto("/");
    const icon = await expectIcon(page, "anonymous", "Login", "/login");
    await icon.click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    expect((await page.request.get("/api/app/me")).status()).toBe(401);
  });
});

test.describe("profile icon on a phone and on a desktop", () => {
  // Around every point where the header changes (385 and 420, 1080) as well as the usual phone sizes.
  const widths = [320, 340, 360, 375, 384, 385, 390, 393, 412, 419, 420, 430, 768, 1079, 1080, 1440];

  for (const width of widths) {
    test(`NAV-10 one icon, inside the screen and clear of its neighbours, at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      const icon = await expectIcon(page, "anonymous", "Login", "/login");
      // Exactly one control, never a second one hidden or visible somewhere else.
      await expect(page.locator("a[data-account-state]")).toHaveCount(1);
      await expect(icon).toBeVisible();

      const boxes = await page.evaluate(() => {
        const rect = (el: Element) => {
          const { x, y, width: w, height: h } = el.getBoundingClientRect();
          return { x, y, w, h };
        };
        const header = document.querySelector("header")!;
        const visible = (el: Element) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== "hidden";
        };
        const controls = [...header.querySelectorAll("a, button")].filter(visible);
        return {
          viewport: window.innerWidth,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          controls: controls.map((el) => ({
            label: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "",
            ...rect(el),
          })),
        };
      });
      expect(boxes.overflow, "no sideways scrolling").toBeLessThanOrEqual(0);
      for (const control of boxes.controls) {
        // Inside the page's own side padding (20px on a phone), not pressed against the edge.
        expect(control.x, control.label).toBeGreaterThanOrEqual(19);
        expect(control.x + control.w, control.label).toBeLessThanOrEqual(boxes.viewport - 19);
      }
      // The small demo button stays in the bar until the header has no room for it, and is
      // never squeezed into a two-line pill (it is a single line, as the original header's
      // button was wherever it fit). Tailwind's max-[385px] means "narrower than 385px".
      const demo = boxes.controls.find((control) => control.label === "Book demo");
      if (width >= 385 && width < 1080) {
        expect(demo, "demo button").toBeTruthy();
        expect(demo!.h, "demo button is one line, not a tall wrapped pill").toBeLessThanOrEqual(48);
        expect(demo!.w, "demo button is not squeezed").toBeGreaterThanOrEqual(80);
      }
      if (width < 385) expect(demo, "demo button leaves the bar to make room").toBeUndefined();
      // No two controls overlap.
      for (const [i, a] of boxes.controls.entries()) {
        for (const b of boxes.controls.slice(i + 1)) {
          const overlaps =
            a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
          expect(overlaps, `${a.label} overlaps ${b.label}`).toBe(false);
        }
      }
      // A comfortable touch target.
      const mine = boxes.controls.find((control) => control.label === "Login")!;
      expect(mine.w).toBeGreaterThanOrEqual(40);
      expect(mine.h).toBeGreaterThanOrEqual(40);

      await icon.click();
      await expect(page).toHaveURL(/\/login$/);
    });
  }

  test("NAV-10 on a phone the icon works for a signed-in customer and an administrator", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await workspaceSession(page);
    await page.goto("/");
    await (await expectIcon(page, "signed_in", "My dashboard", "/app")).click();
    await expect(page).toHaveURL(/\/app\/?$/);

    await page.context().clearCookies();
    await signInAdmin(page, "28");
    await page.goto("/");
    await (await expectIcon(page, "signed_in", "Admin dashboard", "/admin")).click();
    await expect(page).toHaveURL(/\/admin\/?$/);
  });

  test("NAV-10 the mobile menu has one account entry, and it matches the icon", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await expectIcon(page, "anonymous", "Login", "/login");
    await page.getByRole("button", { name: "Menu" }).click();
    const menu = page.getByRole("dialog");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("link", { name: "Login", exact: true })).toHaveCount(1);
    await menu.getByRole("link", { name: "Login", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);

    await workspaceSession(page);
    await page.goto("/");
    await expectIcon(page, "signed_in", "My dashboard", "/app");
    await page.getByRole("button", { name: "Menu" }).click();
    const signedInMenu = page.getByRole("dialog");
    // A signed-in person is not offered "Login" anywhere.
    await expect(signedInMenu.getByRole("link", { name: "Login", exact: true })).toHaveCount(0);
    await expect(signedInMenu.getByRole("link", { name: "My dashboard", exact: true })).toHaveCount(1);
    await signedInMenu.getByRole("link", { name: "My dashboard", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/?$/);
  });

  test("NAV-10 it also works in French on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/fr");
    await (await expectIcon(page, "anonymous", "Connexion", "/fr/connexion")).click();
    await expect(page).toHaveURL(/\/fr\/connexion$/);
  });

  test("NAV-11 the icon can be reached and used with the keyboard alone, with a visible focus ring and a name", async ({ page }) => {
    await page.goto("/");
    await rejectCookiesIfVisible(page);
    const icon = await expectIcon(page, "anonymous", "Login", "/login");
    expect(await icon.evaluate((el) => getComputedStyle(el).boxShadow)).toBe("none");

    for (let presses = 0; presses < 40; presses += 1) {
      await page.keyboard.press("Tab");
      if (await icon.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(icon).toBeFocused();
    // A real, visible ring (not "outline: none" with nothing in its place).
    const ring = await icon.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(ring).not.toBe("none");
    expect(ring).toMatch(/rgba?\(/);

    // Role and name, as a screen reader gets them.
    await expect(page.getByRole("link", { name: "Login", exact: true })).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("NAV-11 keyboard use works for a signed-in customer, and shift-tab leaves the icon", async ({ page }) => {
    await workspaceSession(page);
    await page.goto("/");
    await rejectCookiesIfVisible(page);
    const icon = await expectIcon(page, "signed_in", "My dashboard", "/app");
    await icon.focus();
    await expect(icon).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(icon).not.toBeFocused();
    await page.keyboard.press("Tab");
    await expect(icon).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/?$/);
  });

  for (const [label, size] of [
    ["desktop", { width: 1280, height: 800 }],
    ["phone", { width: 375, height: 667 }],
  ] as const) {
    test(`NAV-11 the header passes an automated accessibility scan on ${label}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto("/");
      await expectIcon(page, "anonymous", "Login", "/login");
      const results = await new AxeBuilder({ page })
        .include("header")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.length}`)).toEqual([]);
    });
  }

  test("NAV-12 repeated rapid clicks make one check and one trip, with no errors or loops", async ({ page }) => {
    await workspaceSession(page);
    const checks: string[] = [];
    const errors: string[] = [];
    const visited = trackVisits(page);
    page.on("request", (request) => {
      if (request.url().includes("/api/auth/session")) checks.push(request.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");
    const icon = await expectIcon(page, "signed_in", "My dashboard", "/app");
    expect(checks).toHaveLength(1);

    await icon.click({ clickCount: 15, delay: 0 });
    await expect(page).toHaveURL(/\/app\/?$/);
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(/\/app\/?$/);

    expect(errors).toEqual([]);
    expect(checks, "one check on load, one for all the clicks").toHaveLength(2);
    expect(visited).toEqual(["/", "/app"]);
  });

  test("NAV-12 a burst of scripted clicks, signed out, ends once on sign-in and stays there", async ({ page }) => {
    const errors: string[] = [];
    const visited = trackVisits(page);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    const icon = await expectIcon(page, "anonymous", "Login", "/login");
    await icon.evaluate((el) => {
      for (let i = 0; i < 40; i += 1) (el as HTMLElement).click();
    });
    await expect(page).toHaveURL(/\/login$/);
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(/\/login$/);
    expect(errors).toEqual([]);
    expect(visited).toEqual(["/", "/login"]);
  });
});

test.describe("the sign-in page does not bounce people around", () => {
  test("NAV-13 a signed-in customer opening the sign-in page goes straight to their dashboard, once", async ({ page }) => {
    await workspaceSession(page);
    const redirects: string[] = [];
    page.on("response", (response) => {
      if (response.status() >= 300 && response.status() < 400) redirects.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });

    await page.goto("/login");
    await expect(page).toHaveURL(/\/app\/?$/);
    expect(redirects.length, redirects.join(", ")).toBeLessThanOrEqual(1);

    // Their intended page is honoured; another site and an admin page are not.
    await page.goto("/login?next=%2Fapp%2Fleads");
    await expect(page).toHaveURL(/\/app\/leads$/);
    for (const next of ["https%3A%2F%2Fevil.example%2Fapp", "%2Fadmin", "%2F%2Fevil.example"]) {
      await page.goto(`/login?next=${next}`);
      await expect(page, next).toHaveURL(/\/app\/?$/);
    }
    // A waiting message (a rejected link) is still shown, not skipped.
    await page.goto("/login?error=Invalid%20or%20expired%20link.");
    await expect(page).toHaveURL(/\/login\?error=/);
    await expect(page.getByRole("alert").first()).toBeVisible();

    // Last, because opening a French page sets the language cookie for the rest of the visit.
    await page.goto("/fr/connexion");
    await expect(page).toHaveURL(/\/fr\/app\/?$/);
  });

  test("NAV-13 a signed-in administrator opening the sign-in page goes to the admin dashboard", async ({ page }) => {
    await signInAdmin(page, "29");
    await page.goto("/login");
    await expect(page).toHaveURL(/\/admin\/?$/);
  });

  test("NAV-13 a signed-out visitor still gets the form, and a protected page remembers where they were going", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();

    await page.goto("/app/leads");
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fleads$/);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  });

  test("NAV-14 there is no redirect loop between sign-in, the account pages and the dashboards", async ({ page }) => {
    // Signed in: login -> app, and app stays.
    await workspaceSession(page);
    const hops = async (start: string) => {
      const seen: string[] = [];
      let url = start;
      for (let hop = 0; hop < 6; hop += 1) {
        const response = await page.request.get(url, { maxRedirects: 0 });
        seen.push(`${response.status()} ${url}`);
        const location = response.headers()["location"];
        if (response.status() < 300 || response.status() >= 400 || !location) return seen;
        url = new URL(location, "http://localhost").pathname + new URL(location, "http://localhost").search;
      }
      throw new Error(`redirect loop: ${seen.join(" -> ")}`);
    };
    for (const start of ["/login", "/app", "/admin", "/fr/connexion"]) {
      expect((await hops(start)).length, start).toBeLessThanOrEqual(3);
    }

    // Signed out: app -> refresh -> login, and login stays.
    await page.request.post("/api/auth/logout");
    await page.context().clearCookies();
    for (const start of ["/login", "/app", "/admin", "/app/leads"]) {
      expect((await hops(start)).length, start).toBeLessThanOrEqual(4);
    }
  });

  test("NAV-15 nothing secret reaches the page: no token in the page, its storage, its links or the session answer", async ({ page }) => {
    await workspaceSession(page);
    await page.goto("/");
    const icon = await expectIcon(page, "signed_in", "My dashboard", "/app");
    const cookies = await page.context().cookies();
    const secrets = cookies.filter((cookie) => cookie.name.startsWith("tc_")).map((cookie) => cookie.value);
    expect(secrets.length).toBeGreaterThanOrEqual(2);

    const html = await page.content();
    const storage = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]));
    for (const secret of secrets) {
      expect(html).not.toContain(secret);
      expect(storage).not.toContain(secret);
    }
    expect(storage).not.toContain("tc_");
    expect(await icon.getAttribute("href")).toBe("/app");

    const answer = await page.request.get("/api/auth/session");
    expect(answer.status()).toBe(200);
    expect(answer.headers()["cache-control"]).toMatch(/no-store/);
    const body = (await answer.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["destination", "role", "state"]);
    const text = JSON.stringify(body);
    for (const secret of secrets) expect(text).not.toContain(secret);
    expect(text).not.toContain("@");
  });
});
