import { test, expect } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 360, height: 780 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });
    for (const fr of [false, true]) {
      test(`live public pages, no submission (${fr ? "fr" : "en"})`, async ({
        page,
      }) => {
        // Fail closed if a regression tries to write to any API during this smoke.
        await page.route("**/api/**", async (route) => {
          if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method()))
            return route.abort("blockedbyclient");
          return route.continue();
        });
        await page.goto(fr ? "/fr" : "/");
        await page
          .getByRole("button", {
            name: fr ? "Refuser les non essentiels" : "Reject non-essential",
            exact: true,
          })
          .click();
        const fits = () =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          );
        await expect.poll(fits).toBe(true);
        const menu = page.getByRole("button", { name: "Menu", exact: true });
        if (await menu.isVisible()) {
          await menu.click();
          await expect(page.getByRole("dialog")).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(menu).toHaveAttribute("aria-expanded", "false");
        }
        const links = await page
          .locator("header a[href]")
          .evaluateAll((elements) =>
            [
              ...new Set(
                elements.map((element) => element.getAttribute("href")!),
              ),
            ].filter((href) => href.startsWith("/") && !href.startsWith("//")),
          );
        if (viewport.width === 1440) {
          for (const href of links) {
            const response = await page.request.get(href);
            expect
              .soft(response.ok(), `${href}: HTTP ${response.status()}`)
              .toBe(true);
          }
        }
        await page
          .getByRole("button", {
            name: fr ? "Voir la démo vidéo" : "Watch the 90-second demo",
            exact: true,
          })
          .first()
          .click();
        const dialog = page.getByRole("dialog");
        const video = dialog.locator("video");
        await video.evaluate(async (element: HTMLVideoElement) => {
          element.muted = true;
          await element.play();
        });
        await expect
          .poll(() =>
            video.evaluate((element: HTMLVideoElement) => element.currentTime),
          )
          .toBeGreaterThan(0.3);
        await video.evaluate((element: HTMLVideoElement) => {
          element.pause();
          element.currentTime = 5;
        });
        await expect.soft
          .poll(() =>
            video.evaluate((element: HTMLVideoElement) => element.currentTime),
          )
          .toBeGreaterThanOrEqual(4.5);
        const captions = await page.request.get(
          (await dialog.locator("track[kind=captions]").getAttribute("src"))!,
        );
        expect(captions.ok()).toBe(true);
        expect(await captions.text()).toContain("WEBVTT");
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await page.goto(fr ? "/fr/reserver-audit" : "/book-audit");
        await expect
          .poll(() =>
            page.evaluate(() =>
              sessionStorage.getItem("tradecatch-book-audit-draft"),
            ),
          )
          .not.toBeNull();
        await page.locator("#audit-field-firstName").fill("ReadOnly");
        await page.locator("#audit-field-lastName").fill("BrowserCheck");
        await expect(page.locator("#audit-field-firstName")).toHaveValue(
          "ReadOnly",
        );
        await expect(page.locator("#audit-field-lastName")).toHaveValue(
          "BrowserCheck",
        );
        await expect.poll(fits).toBe(true);
        // Deliberately do not advance, submit, create a lead, or send mail.
      });
    }
  });
}
