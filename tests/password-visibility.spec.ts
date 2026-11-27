import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import {
  expect,
  test as base,
  type Locator,
  type Page,
} from "@playwright/test";
import { waitForFormHydration } from "./support/hydration";

/**
 * KAN-23: the show/hide button on every password field (sign-in, choose/reset a
 * password, change password). PASS-nn ids follow the ticket's test table.
 */

const OPS = "Bearer tradecatch-e2e-ops-secret-not-for-production";
const PASSWORD = "Copper-Pipe-Kettle-82";

// Auth limits are keyed by client address; give each test its own so parallel
// specs cannot use up each other's password/reset quota.
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

/** The password input with this visible label (never the toggle button). */
const input = (page: Page, label: string) =>
  page.getByLabel(label, { exact: true });

/** The show/hide button that sits inside the same field as the labelled input. */
const toggle = (page: Page, label: string) =>
  input(page, label)
    .locator("xpath=..")
    .getByRole("button", { name: /^(Show|Hide|Afficher|Masquer) /i });

async function provision(page: Page, email: string) {
  const response = await page.request.post(
    "/api/missed-call/ops/provision-organization",
    {
      headers: { Authorization: OPS, "X-Ops-Actor": "playwright-visibility" },
      data: {
        email,
        organizationName: "Plomberie Oeil Ouvert",
        ownerName: "Visibility Owner",
        locale: "en",
        plan: "essential",
      },
    },
  );
  expect(response.status()).toBe(201);
}

/** Ask for a reset link and follow the local/dev link it hands back. */
async function openResetLink(page: Page, email: string) {
  await page.goto("/forgot-password");
  await rejectCookiesIfVisible(page);
  await waitForFormHydration(page);
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a reset link" }).click();
  await expect(page.getByRole("status")).toContainText(
    "If that email has an account",
  );
  await page.getByRole("link", { name: "Choose a new password" }).click();
  await waitForFormHydration(page);
}

/** Choose a password from the emailed link and land signed in on /app. */
async function chooseAccountPassword(page: Page, email: string) {
  await provision(page, email);
  await openResetLink(page, email);
  await input(page, "New password").fill(PASSWORD);
  await input(page, "Confirm password").fill(PASSWORD);
  await page
    .getByRole("button", { name: "Save password and sign in" })
    .click();
  await expect(page).toHaveURL(/\/app(?:\/)?$/);
}

const inputType = (field: Locator) => field.getAttribute("type");

test.describe("password visibility toggle", () => {
  test("PASS-01 the sign-in password is hidden by default, with one labelled toggle", async ({
    page,
  }) => {
    await page.goto("/login");
    await rejectCookiesIfVisible(page);
    await waitForFormHydration(page);

    const password = input(page, "Password");
    await expect(password).toHaveAttribute("type", "password");
    // The toggle is not part of the field's label: the label still names only the input.
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(1);

    const button = toggle(page, "Password");
    await expect(button).toHaveCount(1);
    await expect(button).toHaveAccessibleName("Show password");
    await expect(button).toHaveAttribute("type", "button");
    await expect(button).toHaveAttribute(
      "aria-controls",
      (await password.getAttribute("id")) ?? "",
    );
  });

  test("PASS-02 and PASS-03 clicking the eye shows the password, clicking again hides it", async ({
    page,
  }) => {
    await page.goto("/login");
    await rejectCookiesIfVisible(page);
    await waitForFormHydration(page);

    const password = input(page, "Password");
    const button = toggle(page, "Password");

    await button.click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(button).toHaveAccessibleName("Hide password");

    await button.click();
    await expect(password).toHaveAttribute("type", "password");
    await expect(button).toHaveAccessibleName("Show password");
  });

  test("PASS-04 toggling keeps what was typed, the caret and the focus in the field", async ({
    page,
  }) => {
    await page.goto("/login");
    await rejectCookiesIfVisible(page);
    await waitForFormHydration(page);

    const password = input(page, "Password");
    const button = toggle(page, "Password");
    await password.fill("Abcdef-123456");
    await password.focus();
    await password.evaluate((el: HTMLInputElement) =>
      el.setSelectionRange(3, 7),
    );

    await button.click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("Abcdef-123456");
    await expect(password).toBeFocused();
    expect(
      await password.evaluate((el: HTMLInputElement) => [
        el.selectionStart,
        el.selectionEnd,
      ]),
    ).toEqual([3, 7]);

    // Typing carries on at the caret after a toggle, in either direction.
    await password.evaluate((el: HTMLInputElement) =>
      el.setSelectionRange(3, 3),
    );
    await button.click();
    await expect(password).toHaveAttribute("type", "password");
    await page.keyboard.type("XY");
    await expect(password).toHaveValue("AbcXYdef-123456");
  });

  test("PASS-05 each password field toggles on its own (choose a password)", async ({
    page,
  }) => {
    const email = `visibility-pair-${Date.now()}@example.test`;
    await provision(page, email);
    await openResetLink(page, email);

    const first = input(page, "New password");
    const second = input(page, "Confirm password");
    await first.fill(PASSWORD);
    await second.fill(PASSWORD);

    await toggle(page, "New password").click();
    await expect(first).toHaveAttribute("type", "text");
    await expect(second).toHaveAttribute("type", "password");

    await toggle(page, "Confirm password").click();
    await expect(first).toHaveAttribute("type", "text");
    await expect(second).toHaveAttribute("type", "text");

    await toggle(page, "New password").click();
    await expect(first).toHaveAttribute("type", "password");
    await expect(second).toHaveAttribute("type", "text");
    await expect(first).toHaveValue(PASSWORD);
    await expect(second).toHaveValue(PASSWORD);
  });

  test("PASS-05 each password field toggles on its own (change password)", async ({
    page,
  }) => {
    await chooseAccountPassword(page, `visibility-settings-${Date.now()}@example.test`);
    await page.goto("/app/settings/security");
    await waitForFormHydration(page);

    const labels = ["Current password", "New password", "Confirm new password"];
    for (const label of labels) {
      await expect(input(page, label)).toHaveAttribute("type", "password");
      await expect(toggle(page, label)).toHaveAccessibleName("Show password");
    }

    await toggle(page, "New password").click();
    expect(await Promise.all(labels.map((l) => inputType(input(page, l))))).toEqual([
      "password",
      "text",
      "password",
    ]);
    // Same-named buttons are told apart by the field they belong to.
    await expect(toggle(page, "New password")).toHaveAccessibleDescription(
      "New password",
    );
    await expect(toggle(page, "Current password")).toHaveAccessibleName(
      "Show password",
    );
    await expect(toggle(page, "New password")).toHaveAccessibleName(
      "Hide password",
    );
  });

  test("PASS-06 the toggle works from the keyboard, shows focus and never submits the form", async ({
    page,
  }) => {
    await page.goto("/login");
    await rejectCookiesIfVisible(page);
    await waitForFormHydration(page);

    const submissions: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") submissions.push(request.url());
    });

    await page.getByLabel("Work email").fill("keyboard@example.test");
    const password = input(page, "Password");
    const button = toggle(page, "Password");
    await password.fill("Keyboard-Pass-77");
    await password.focus();

    // Tab from the field lands on the toggle and shows a focus ring.
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    // The ring fades in (Tailwind's `transition` includes box-shadow), so wait for the
    // finished 2px orange ring rather than reading it mid-animation.
    await expect
      .poll(() => button.evaluate((el) => getComputedStyle(el).boxShadow))
      .toContain("rgb(228, 118, 43) 0px 0px 0px 2px inset");

    await page.keyboard.press("Enter");
    await expect(password).toHaveAttribute("type", "text");
    await expect(button).toBeFocused();
    await expect(button).toHaveAccessibleName("Hide password");

    await page.keyboard.press("Space");
    await expect(password).toHaveAttribute("type", "password");
    await expect(button).toHaveAccessibleName("Show password");

    await page.keyboard.press("Space");
    await expect(password).toHaveAttribute("type", "text");
    await page.keyboard.press("Enter");
    await expect(password).toHaveAttribute("type", "password");

    // Nothing was sent and the page did not move: a toggle is not a submit.
    expect(submissions).toEqual([]);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("form").getByRole("alert")).toHaveCount(0);
    await expect(password).toHaveValue("Keyboard-Pass-77");
  });

  test("PASS-07 and PASS-08 sign in and choose a password with the password shown", async ({
    page,
  }) => {
    const email = `visibility-flow-${Date.now()}@example.test`;
    const traffic: string[] = [];
    page.on("request", (request) => {
      traffic.push(`${request.url()}\n${request.postData() ?? ""}`);
    });

    // PASS-08: the reset form works with both fields shown.
    await provision(page, email);
    await openResetLink(page, email);
    await toggle(page, "New password").click();
    await toggle(page, "Confirm password").click();
    await input(page, "New password").fill(PASSWORD);
    await input(page, "Confirm password").fill(PASSWORD);
    await expect(input(page, "New password")).toHaveAttribute("type", "text");
    await page
      .getByRole("button", { name: "Save password and sign in" })
      .click();
    await expect(page).toHaveURL(/\/app(?:\/)?$/);

    // PASS-07: sign in again, password shown, wrong first, then right.
    await page.request.post("/api/auth/logout");
    await page.context().clearCookies();
    await page.goto("/login");
    await waitForFormHydration(page);
    await page.getByLabel("Work email").fill(email);
    const password = input(page, "Password");
    await toggle(page, "Password").click();
    await password.fill("wrong-wrong-wrong");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText(
      "email and password do not match",
    );
    // A failed attempt does not hide or clear what the person is looking at.
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("wrong-wrong-wrong");

    await password.fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/app(?:\/)?$/);

    // The password only ever travelled in the two real submissions; toggling sent nothing.
    const withPassword = traffic.filter((entry) => entry.includes(PASSWORD));
    expect(withPassword.map((entry) => entry.split("\n")[0])).toEqual([
      expect.stringContaining("/api/auth/set-password"),
      expect.stringContaining("/api/auth/password-login"),
    ]);
  });

  test("PASS-07 the toggle never stores the password in the browser or sends it anywhere", async ({
    page,
  }) => {
    const secret = "Never-Stored-Anywhere-93";
    const sent: string[] = [];
    page.on("request", (request) => {
      sent.push(`${request.method()} ${request.url()} ${request.postData() ?? ""}`);
    });
    await page.goto("/login");
    await rejectCookiesIfVisible(page);
    await waitForFormHydration(page);
    const before = sent.length;

    await input(page, "Password").fill(secret);
    await toggle(page, "Password").click();
    await toggle(page, "Password").click();
    await toggle(page, "Password").click();

    expect(sent.slice(before).filter((entry) => entry.includes(secret))).toEqual([]);
    expect(sent.slice(before).filter((entry) => !entry.startsWith("GET "))).toEqual([]);
    const stored = await page.evaluate(() => {
      const dump = (storage: Storage) =>
        Object.keys(storage).map((key) => `${key}=${storage.getItem(key)}`);
      return [...dump(localStorage), ...dump(sessionStorage), document.cookie];
    });
    expect(stored.join("\n")).not.toContain(secret);
  });

  test("PASS-10 a reload or a page-cache restore brings the password back hidden", async ({
    page,
  }) => {
    await page.goto("/login");
    await rejectCookiesIfVisible(page);
    await waitForFormHydration(page);

    await input(page, "Password").fill("Reload-Me-4455");
    await toggle(page, "Password").click();
    await expect(input(page, "Password")).toHaveAttribute("type", "text");

    // A page stored in the back/forward cache fires pagehide: it must be hidden by then.
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expect(input(page, "Password")).toHaveAttribute("type", "password");
    await expect(toggle(page, "Password")).toHaveAccessibleName("Show password");

    await toggle(page, "Password").click();
    await expect(input(page, "Password")).toHaveAttribute("type", "text");
    await page.reload();
    await waitForFormHydration(page);
    await expect(input(page, "Password")).toHaveAttribute("type", "password");
    await expect(toggle(page, "Password")).toHaveAccessibleName("Show password");
  });

  test("the French sign-in page has French labels", async ({ page }) => {
    await page.goto("/fr/connexion");
    await rejectCookiesIfVisible(page);
    await waitForFormHydration(page);
    const button = toggle(page, "Mot de passe");
    await expect(button).toHaveAccessibleName("Afficher le mot de passe");
    await button.click();
    await expect(input(page, "Mot de passe")).toHaveAttribute("type", "text");
    await expect(button).toHaveAccessibleName("Masquer le mot de passe");
  });

  test("the password field has no automatically detectable WCAG A/AA violations, hidden or shown", async ({
    page,
  }) => {
    await page.goto("/login");
    await rejectCookiesIfVisible(page);
    await waitForFormHydration(page);
    for (const shown of [false, true]) {
      if (shown) await toggle(page, "Password").click();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        results.violations,
        results.violations
          .map((v) => `${v.id}: ${v.help} (${v.nodes.length} node(s))`)
          .join("\n"),
      ).toEqual([]);
    }
  });
});

test.describe("password visibility toggle on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("PASS-09 the icon sits inside the field, is easy to tap and works by touch", async ({
    page,
  }) => {
    await page.goto("/login");
    await rejectCookiesIfVisible(page);
    await waitForFormHydration(page);

    const password = input(page, "Password");
    const button = toggle(page, "Password");
    const fieldBox = (await password.boundingBox())!;
    const buttonBox = (await button.boundingBox())!;

    // Inside the field's right edge, filling its height, and a 44 px touch target.
    expect(buttonBox.x).toBeGreaterThanOrEqual(fieldBox.x);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(
      fieldBox.x + fieldBox.width + 0.5,
    );
    expect(buttonBox.y).toBeGreaterThanOrEqual(fieldBox.y - 0.5);
    expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(
      fieldBox.y + fieldBox.height + 0.5,
    );
    expect(buttonBox.width).toBeGreaterThanOrEqual(44);
    expect(buttonBox.height).toBeGreaterThanOrEqual(44);
    // Typed text stops before the icon instead of running under it.
    const paddingRight = await password.evaluate((el) =>
      parseFloat(getComputedStyle(el).paddingRight),
    );
    expect(paddingRight).toBeGreaterThanOrEqual(buttonBox.width);
    // No sideways scrolling on a phone.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    await password.fill("Phone-Pass-2468");
    await button.tap();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("Phone-Pass-2468");
    await expect(button).toHaveAccessibleName("Hide password");
    await button.tap();
    await expect(password).toHaveAttribute("type", "password");
  });

  test("PASS-09 the icon still fits on a very narrow phone", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/login");
    await rejectCookiesIfVisible(page);
    await waitForFormHydration(page);
    const fieldBox = (await input(page, "Password").boundingBox())!;
    const buttonBox = (await toggle(page, "Password").boundingBox())!;
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(
      fieldBox.x + fieldBox.width + 0.5,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});
