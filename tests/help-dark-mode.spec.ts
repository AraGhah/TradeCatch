import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { HELP_ARTICLES } from "../src/product/support/help";
import { workspaceSession } from "./support/workspace-session";

/**
 * Regression guard for the Help page theming bug: headings, body copy, cards
 * and borders must use theme-aware tokens (text-heading/text-muted/
 * text-secondary/bg-surface/rgb(var(--ink-rgb))) so both themes stay
 * WCAG 2.2 AA compliant. Asserts dark mode AND re-asserts light mode so a fix
 * for one never silently regresses the other.
 */
async function setTheme(page: import("@playwright/test").Page, theme: "light" | "dark") {
  await page.addInitScript((value) => {
    try {
      if (value === "dark") localStorage.setItem("tc-theme", "dark");
      else localStorage.removeItem("tc-theme");
    } catch {
      /* storage may be unavailable in some contexts */
    }
  }, theme);
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

for (const theme of ["light", "dark"] as const) {
  test.describe(`help page contrast — ${theme} mode`, () => {
    test(`public catalog and article pages meet AA contrast (${theme})`, async ({
      page,
    }) => {
      await setTheme(page, theme);
      await page.goto("/help");
      await expect(page.locator("html")).toHaveClass(
        theme === "dark" ? /dark/ : /^((?!dark).)*$/,
      );
      await expect(
        page.getByRole("heading", { level: 1 }),
      ).toBeVisible();
      await expectNoContrastViolations(page);

      const article = HELP_ARTICLES.find((a) => a.id === "troubleshooting")!;
      await setTheme(page, theme);
      await page.goto(`/help/${article.id}`);
      await expect(
        page.getByRole("heading", { level: 1 }),
      ).toBeVisible();
      await expectNoContrastViolations(page);
    });

    test(`authenticated help catalog and article pages meet AA contrast (${theme})`, async ({
      page,
    }) => {
      await setTheme(page, theme);
      await workspaceSession(page, "en");
      await setTheme(page, theme);
      await page.goto("/app/help");
      await expect(
        page.getByRole("heading", { level: 1 }),
      ).toBeVisible();
      await expectNoContrastViolations(page);

      await setTheme(page, theme);
      await page.goto("/app/help/account");
      await expect(
        page.getByRole("heading", { name: "Expected result", exact: true }),
      ).toBeVisible();
      await expectNoContrastViolations(page);
    });
  });
}
