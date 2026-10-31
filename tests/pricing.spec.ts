import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Pricing page: the agreed prices, the "what is one job worth" calculator
 * (plain arithmetic on the visitor's own number) and the link into the live
 * receptionist demo.
 */

async function plans(page: Page) {
  // Wait for the locale template to settle (see receptionist-demo.spec.ts).
  await page
    .waitForFunction(
      () => Boolean(document.querySelector("#worth-it")?.closest('div[style*="transform"]')),
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => undefined);
}

test.describe("pricing page", () => {
  test("English: shows the agreed prices and the real step-up between plans", async ({
    page,
  }) => {
    await page.goto("/pricing");
    await plans(page);
    const main = page.locator("main");

    // Match plan cards by their h2 name. Starter's body says "SMS receptionist",
    // so a loose hasText("Receptionist") incorrectly picks that card first.
    const planCard = (name: string) =>
      main.locator("article").filter({
        has: page.getByRole("heading", { name, exact: true, level: 2 }),
      });

    const receptionist = planCard("Receptionist Plus");
    await expect(receptionist).toContainText("$1,999.99");
    await expect(receptionist).toContainText("$949.99");
    await expect(receptionist).toContainText("$300.00 a month");
    await expect(receptionist).toContainText("$500.00 more at installation");

    const growth = planCard("Growth");
    await expect(growth).toContainText("$1,499.99");
    await expect(growth).toContainText("$649.99");
    await expect(growth).toContainText("$300.00 a month");

    const starter = planCard("Starter");
    await expect(starter).toContainText("$799.99");
    await expect(starter).toContainText("$349.99");

    // Old figures are gone everywhere on the page.
    const text = await main.innerText();
    expect(text).not.toMatch(/\$350\b|\$750\b/);
  });

  test("French: shows the agreed prices in Québec format", async ({ page }) => {
    await page.goto("/fr/tarifs");
    await plans(page);
    const main = page.locator("main");
    const text = (await main.innerText()).replace(/ /g, " ");

    expect(text).toContain("1 999,99 $");
    expect(text).toContain("949,99 $");
    expect(text).toContain("649,99 $");
    expect(text).toContain("349,99 $");
    expect(text).not.toMatch(/\b350 \$|\b750 \$/);
  });

  test("the receptionist card links to the live demo in the visitor's language", async ({
    page,
  }) => {
    await page.goto("/pricing");
    const en = page.getByRole("link", { name: "Talk to it yourself" });
    await expect(en).toHaveAttribute("href", "/receptionist#try-it");

    await page.goto("/fr/tarifs");
    const fr = page.getByRole("link", { name: "Parlez-lui vous-même" });
    await expect(fr).toHaveAttribute("href", "/fr/receptionniste#try-it");

    await fr.click();
    await expect(page).toHaveURL(/\/fr\/receptionniste#try-it$/);
    await expect(page.locator("#try-it")).toBeVisible();
  });

  test("calculator: one job covers a plan for a number of months, from the visitor's own figure", async ({
    page,
  }) => {
    await page.goto("/pricing");
    await plans(page);
    const section = page.locator("#worth-it");
    await section.scrollIntoViewIfNeeded();

    const input = section.getByLabel("Average job value (CAD)");
    const rows = section.getByRole("listitem");
    // Example figure: $1,500 / each monthly fee.
    await expect(rows.filter({ hasText: "Starter" })).toContainText("4.3 months");
    await expect(rows.filter({ hasText: "Growth" })).toContainText("2.3 months");
    await expect(rows.filter({ hasText: "Receptionist" })).toContainText("1.6 months");

    await input.fill("3,000");
    await expect(rows.filter({ hasText: "Starter" })).toContainText("8.6 months");
    await expect(rows.filter({ hasText: "Receptionist" })).toContainText("3.2 months");

    // A job worth less than the fee covers only part of a month.
    await input.fill("500");
    await expect(rows.filter({ hasText: "Receptionist" })).toContainText("53% of a month");

    await input.fill("abc");
    await expect(section.getByText("Enter an amount above zero.")).toBeVisible();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(rows.filter({ hasText: "Starter" })).toContainText("—");

    await expect(section.getByText(/not a promise that any plan recovers/i)).toBeVisible();
  });

  test("calculator: French figures in Québec format", async ({ page }) => {
    await page.goto("/fr/tarifs");
    await plans(page);
    const section = page.locator("#worth-it");
    await section.scrollIntoViewIfNeeded();
    const input = section.getByLabel(/Valeur moyenne d’un contrat/);
    await input.fill("1 500,50");
    const rows = section.getByRole("listitem");
    await expect(rows.filter({ hasText: "Starter" })).toContainText("4,3 mois");
  });

  for (const path of ["/pricing", "/fr/tarifs"]) {
    test(`${path} has no WCAG A/AA violations in the calculator and plans`, async ({
      page,
    }) => {
      await page.goto(path);
      await plans(page);
      await page.locator("#worth-it").scrollIntoViewIfNeeded();
      const results = await new AxeBuilder({ page })
        .include("#worth-it")
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
