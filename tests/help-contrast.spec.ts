import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { HELP_ARTICLES } from "../src/product/support/help";
import { workspaceSession } from "./support/workspace-session";

/**
 * Regression guard for the Help pages: headings, body copy, cards and borders
 * must use the site's theme tokens so the light theme stays WCAG 2.2 AA
 * compliant. TradeCatch ships a light theme only: a leftover "dark" preference
 * saved by an older visit must be ignored, not applied.
 */
async function leaveOldDarkPreference(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("tc-theme", "dark");
    } catch {
      /* storage may be unavailable in some contexts */
    }
  });
}

async function expectNoContrastViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2aa", "wcag21aa"])
    .analyze();
  const contrastViolations = results.violations.filter(
    (v) => v.id === "color-contrast",
  );
  expect(
    contrastViolations,
    contrastViolations
      .map((v) => `${v.id}: ${v.help} (${v.nodes.length} node(s))`)
      .join("\n"),
  ).toEqual([]);
}

test.describe("help page contrast (light theme)", () => {
  test("public catalog and article pages meet AA contrast and ignore an old dark preference", async ({
    page,
  }) => {
    await leaveOldDarkPreference(page);
    await page.goto("/help");
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoContrastViolations(page);

    const article = HELP_ARTICLES.find((a) => a.id === "troubleshooting")!;
    await page.goto(`/help/${article.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoContrastViolations(page);
  });

  test("authenticated help catalog and article pages meet AA contrast", async ({
    page,
  }) => {
    await leaveOldDarkPreference(page);
    await workspaceSession(page, "en");
    await page.goto("/app/help");
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoContrastViolations(page);

    await page.goto("/app/help/account");
    await expect(
      page.getByRole("heading", { name: "Expected result", exact: true }),
    ).toBeVisible();
    await expectNoContrastViolations(page);
  });
});
