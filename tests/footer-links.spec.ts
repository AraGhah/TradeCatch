import { expect, test } from "@playwright/test";

for (const locale of ["en", "fr"] as const) {
  test(`${locale}: footer links to Terms, not the removed cancellation policy`, async ({
    page,
    request,
  }) => {
    await page.goto(locale === "fr" ? "/fr" : "/");
    const footer = page.locator("footer");
    await expect(footer).toBeVisible();
    await expect(
      footer.locator(
        'a[href*="cancellation-refund-policy"], a[href*="politique-annulation-remboursement"]',
      ),
    ).toHaveCount(0);
    const terms =
      locale === "fr" ? "/fr/conditions-utilisation" : "/terms-of-service";
    await expect(footer.locator(`a[href="${terms}"]`)).toHaveCount(1);
    expect((await request.get(terms)).status()).toBe(200);
  });
}
