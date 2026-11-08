import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { waitForFormHydration } from "./support/hydration";

const OPS = "Bearer tradecatch-e2e-ops-secret-not-for-production";
const PASSWORD = "Copper-Pipe-Kettle-82";

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
  const response = await page.request.post(
    "/api/missed-call/ops/provision-organization",
    {
      headers: { Authorization: OPS, "X-Ops-Actor": "playwright-password" },
      data: {
        email,
        organizationName: "Plomberie Mot de Passe",
        ownerName: "Password Owner",
        locale: "en",
        plan: "essential",
      },
    },
  );
  expect(response.status()).toBe(201);
}

/** Asks for a reset link on the page and follows the local/dev link it hands back. */
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
}

test.describe("customer passwords", () => {
  test("public sign-up does not exist and an unknown email gets the same answer", async ({
    page,
  }) => {
    await page.goto("/login");
    await rejectCookiesIfVisible(page);
    await expect(
      page.getByRole("link", { name: /sign.?up|register|create (an )?account/i }),
    ).toHaveCount(0);

    const unknown = `nobody-${Date.now()}@example.invalid`;
    await page.goto("/forgot-password");
    await waitForFormHydration(page);
    await page.getByLabel("Work email").fill(unknown);
    await page.getByRole("button", { name: "Email me a reset link" }).click();
    await expect(page.getByRole("status")).toContainText(
      "If that email has an account",
    );
    // Nothing to follow for an address that has no account.
    await expect(
      page.getByRole("link", { name: "Choose a new password" }),
    ).toHaveCount(0);
  });

  test("a customer chooses a password, signs out, signs in again and can change it", async ({
    page,
  }) => {
    const email = `password-owner-${Date.now()}@example.test`;
    await provision(page, email);

    // Choose a password from the emailed link; too weak first, then a good one.
    await openResetLink(page, email);
    await expect(
      page.getByRole("heading", { name: "Choose a new password" }),
    ).toBeVisible();
    await waitForFormHydration(page);
    const token = new URL(page.url()).searchParams.get("token") ?? "";
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await page.getByLabel("New password").fill("password123");
    await page.getByLabel("Confirm password").fill("password123");
    await page.getByRole("button", { name: "Save password and sign in" }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText(
      "too easy to guess",
    );

    await page.getByLabel("New password").fill(PASSWORD);
    await page.getByLabel("Confirm password").fill("Something-Else-99");
    await page.getByRole("button", { name: "Save password and sign in" }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText(
      "do not match",
    );

    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Save password and sign in" }).click();
    await expect(page).toHaveURL(/\/app(?:\/)?$/);

    // The same link cannot be used a second time, even with a good password.
    const replay = await page.request.post("/api/auth/set-password", {
      data: { token, password: "Another-Good-Pass-31", locale: "en" },
    });
    expect(replay.status()).toBe(400);
    expect(await replay.json()).toEqual({ error: "invalid_link" });

    // Sign out, then sign in with the new password.
    const logout = await page.request.post("/api/auth/logout");
    expect(logout.ok()).toBe(true);
    await page.context().clearCookies();
    await page.goto("/login");
    await waitForFormHydration(page);
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("wrong-wrong-wrong");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText(
      "email and password do not match",
    );
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/app(?:\/)?$/);

    // Change it from the security settings.
    await page.goto("/app/settings/security");
    await waitForFormHydration(page);
    await page.getByLabel("Current password").fill(PASSWORD);
    await page.getByLabel("New password", { exact: true }).fill("Maple-Wrench-Lantern-47");
    await page.getByLabel("Confirm new password").fill("Maple-Wrench-Lantern-47");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Password changed" }),
    ).toBeVisible();
  });

  test("a used or invented link shows a clear message and offers a new one", async ({
    page,
  }) => {
    await page.goto(`/set-password?token=${"A".repeat(43)}`);
    await expect(page.getByText("invalid, expired, or already used").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Request a new link" }),
    ).toBeVisible();
    await expect(page.getByLabel("New password")).toHaveCount(0);
    await page.goto("/set-password");
    await expect(
      page.getByRole("link", { name: "Request a new link" }),
    ).toBeVisible();
  });

  test("the French pages use French addresses and French words", async ({
    page,
  }) => {
    await page.goto("/fr/connexion");
    await rejectCookiesIfVisible(page);
    await expect(page.getByLabel("Mot de passe", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Mot de passe oublié?" }).click();
    await expect(page).toHaveURL(/\/fr\/mot-de-passe-oublie$/);
    await expect(
      page.getByRole("heading", { name: "Réinitialiser votre mot de passe" }),
    ).toBeVisible();
    await page.goto("/fr/definir-mot-de-passe");
    await expect(
      page.getByRole("link", { name: "Demander un nouveau lien" }),
    ).toBeVisible();
  });

  test("a failed emailed sign-in link explains itself instead of showing a blank form", async ({
    page,
  }) => {
    await page.goto("/login?error=Invalid%20or%20expired%20link.");
    await expect(page.locator("form").getByRole("alert").first()).toContainText(
      "invalid or has already been used",
    );
  });

  for (const path of ["/login", "/forgot-password", "/set-password", "/fr/connexion"]) {
    test(`${path} has no automatically detectable WCAG A/AA violations`, async ({
      page,
    }) => {
      await page.goto(path);
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
});
