import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const email = "contact@tradecatch.ca";

for (const locale of ["en", "fr"] as const) {
  const fr = locale === "fr";
  const title = fr ? "Contacter TradeCatch" : "Contact TradeCatch";
  const copy = fr ? "Copier l’adresse courriel" : "Copy email address";
  const gmail = fr ? "Ouvrir Gmail (nouvel onglet)" : "Open Gmail (new tab)";
  const close = fr ? "Fermer" : "Close";

  for (const mobile of [false, true]) {
    for (const path of fr ? ["/fr", "/fr/a-propos"] : ["/", "/about"]) {
      test(`email contact choices (${path}, mobile=${mobile})`, async ({
        page,
        context,
      }) => {
        await page.setViewportSize(
          mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
        );
        // Test browser behavior without changing the user's real clipboard or
        // sending anything to Google (or submitting an email).
        await page.addInitScript(() => {
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              writeText: async (value: string) => {
                document.documentElement.dataset.copiedEmail = value;
              },
            },
          });
        });
        await context.route("https://mail.google.com/**", (route) =>
          route.fulfill({
            status: 200,
            body: "Synthetic Gmail compose destination",
          }),
        );
        await page.goto(path);
        await page
          .getByRole("button", {
            name: fr ? "Refuser les non essentiels" : "Reject non-essential",
            exact: true,
          })
          .click();

        // Both the founder/about CTA and the shared footer use the same flow.
        const links = page.locator(
          'a[aria-haspopup="dialog"][href^="https://mail.google.com/"]',
        );
        await expect(links).toHaveCount(2);
        for (const link of await links.all()) {
          await link.click();
          const dialog = page.getByRole("dialog", { name: title });
          await expect(dialog).toBeVisible();
          await expect(dialog.getByRole("textbox")).toHaveValue(email);
          await expect(
            dialog.getByRole("link", {
              name: fr ? "Ouvrir l’application de courriel" : "Open email app",
              exact: true,
            }),
          ).toHaveAttribute("href", `mailto:${encodeURIComponent(email)}`);
          await dialog.getByRole("button", { name: copy }).click();
          await expect(dialog.getByRole("status")).toHaveText(
            fr ? "Adresse courriel copiée." : "Email address copied.",
          );
          await expect(page.locator("html")).toHaveAttribute(
            "data-copied-email",
            email,
          );
          await expect(
            new AxeBuilder({ page })
              .include("dialog[open]")
              .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
              .analyze()
              .then((result) => result.violations),
          ).resolves.toEqual([]);

          const popupReady = page.waitForEvent("popup");
          await dialog.getByRole("link", { name: gmail, exact: true }).click();
          const popup = await popupReady;
          await popup.waitForLoadState();
          const destination = new URL(popup.url());
          expect(destination.origin).toBe("https://mail.google.com");
          expect(destination.searchParams.get("to")).toBe(email);
          await popup.close();

          await page.keyboard.press("Escape");
          await expect(dialog).not.toBeVisible();
          await expect(link).toBeFocused();
        }

        // Clipboard permissions can be denied on phones or managed browsers.
        await page.evaluate(() =>
          Object.defineProperty(navigator, "clipboard", {
            value: {
              writeText: async () => {
                throw new Error("Denied");
              },
            },
          }),
        );
        await links.last().click();
        const dialog = page.getByRole("dialog", { name: title });
        await dialog.getByRole("button", { name: copy }).click();
        await expect(dialog.getByRole("status")).toContainText(
          fr ? "copiez-la manuellement" : "copy it manually",
        );
        await expect(dialog.getByRole("textbox")).toBeFocused();
        expect(
          await dialog
            .getByRole("textbox")
            .evaluate(
              (input: HTMLInputElement) =>
                input.selectionEnd! - input.selectionStart!,
            ),
        ).toBe(email.length);
        await dialog.getByRole("button", { name: close, exact: true }).click();
        await expect(dialog).not.toBeVisible();
      });
    }
  }

  test(`email contact has a no-JavaScript browser fallback (${locale})`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      baseURL,
    });
    try {
      await context.route("https://mail.google.com/**", (route) =>
        route.fulfill({
          status: 200,
          body: "Synthetic Gmail compose destination",
        }),
      );
      const page = await context.newPage();
      await page.goto(fr ? "/fr" : "/");
      const link = page.locator('footer a[aria-haspopup="dialog"]');
      await expect(link).toBeVisible();
      expect(
        new URL((await link.getAttribute("href"))!).searchParams.get("to"),
      ).toBe(email);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      const popupReady = page.waitForEvent("popup");
      await link.click();
      const popup = await popupReady;
      await popup.waitForLoadState();
      expect(new URL(popup.url()).searchParams.get("to")).toBe(email);
    } finally {
      await context.close();
    }
  });
}
