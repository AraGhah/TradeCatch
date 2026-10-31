import { expect, test } from "@playwright/test";

// A page is linked from the header or the footer, never both. The phone number
// is contact info rather than navigation, and phones only see it in the footer.
for (const locale of ["en", "fr"] as const) {
  test(`${locale}: header and footer do not repeat each other's links`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(locale === "fr" ? "/fr" : "/");
    const hrefs = (selector: string) =>
      page
        .locator(selector)
        .evaluateAll((links) =>
          links.map((link) => link.getAttribute("href") ?? ""),
        );
    const header = (await hrefs("header a[href]")).filter(
      (href) => href.startsWith("/") && href !== "/" && href !== "/fr",
    );
    const footer = await hrefs("footer a[href]");
    expect(header.length).toBeGreaterThan(3);
    expect(header.filter((href) => footer.includes(href))).toEqual([]);
  });
}

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
