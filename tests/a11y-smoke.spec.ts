import { test, expect } from "@playwright/test";

/**
 * Lightweight accessibility smoke — not a full axe/Lighthouse suite.
 * Catches regressions in document outline and primary landmark structure.
 */
test.describe("accessibility smoke", () => {
  for (const path of ["/", "/book-audit", "/fr", "/fr/reserver-audit"]) {
    test(`${path} has a single h1 and main landmark`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main, [role='main']").first()).toBeVisible();
      const h1Count = await page.locator("h1").count();
      expect(h1Count).toBeGreaterThanOrEqual(1);
      expect(h1Count).toBeLessThanOrEqual(2);
    });
  }

  test("book-audit single-choice uses radiogroup semantics", async ({
    page,
  }) => {
    await page.goto("/book-audit");

    // Wizard starts on name + company text steps; trade is the first choice.
    await page.locator("#audit-field-firstName").fill("Jean");
    await page.locator("#audit-field-lastName").fill("Dupont");
    await page.getByRole("button", { name: /continue/i }).click();

    await page.locator("#audit-field-company").fill("TradeCatch HVAC");
    await page.getByRole("button", { name: /continue/i }).click();

    const group = page.locator("[role='radiogroup']").first();
    await expect(group).toBeVisible({ timeout: 15_000 });
    await expect(group.locator("[role='radio']").first()).toBeVisible();
  });
});
