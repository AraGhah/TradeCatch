import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ hasTouch: true });

test.beforeEach(async ({ page, browserName, baseURL }) => {
  if (browserName !== "webkit") return;
  // WebKit upgrades even localhost assets under production CSP. The isolated
  // harness serves HTTP, not TLS; remove only that directive in test responses.
  // Production headers and all other CSP protections remain unchanged.
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (
      request.resourceType() !== "document" ||
      new URL(request.url()).origin !== new URL(baseURL!).origin
    )
      return route.continue();
    const response = await route.fetch();
    const headers = response.headers();
    if (headers["content-security-policy"])
      headers["content-security-policy"] = headers["content-security-policy"]
        .split(";")
        .filter((directive) => directive.trim() !== "upgrade-insecure-requests")
        .join(";");
    await route.fulfill({ response, headers });
  });
});

const viewports = {
  desktop: { width: 1440, height: 1000 },
  narrowPhone: { width: 360, height: 780 },
  phone: { width: 390, height: 844 },
  landscape: { width: 844, height: 390 },
};

for (const [device, viewport] of Object.entries(viewports)) {
  test.describe(device, () => {
    test.use({ viewport, hasTouch: device !== "desktop" });
    for (const locale of ["en", "fr"] as const) {
      test(`navigation, video, keyboard and form (${locale})`, async ({
        page,
      }, testInfo) => {
        test.setTimeout(90000);
        const fr = locale === "fr";
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(fr ? "/fr" : "/");
        await page
          .getByRole("button", {
            name: fr ? "Refuser les non essentiels" : "Reject non-essential",
            exact: true,
          })
          .click();
        const fits = () =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          );
        await expect.poll(fits).toBe(true);
        const menu = page.getByRole("button", { name: "Menu", exact: true });
        if (await menu.isVisible()) {
          await menu.click();
          await expect(page.getByRole("dialog")).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(menu).toHaveAttribute("aria-expanded", "false");
        }
        const hrefs = await page
          .locator("header a[href]")
          .evaluateAll((links) =>
            [
              ...new Set(links.map((link) => link.getAttribute("href")!)),
            ].filter((href) => href.startsWith("/") && !href.startsWith("//")),
          );
        for (const href of hrefs)
          expect((await page.request.get(href)).ok(), href).toBe(true);
        expect(hrefs.length).toBeGreaterThan(0);
        await page
          .getByRole("button", {
            name: fr ? "Voir la démo vidéo" : "Watch the 90-second demo",
            exact: true,
          })
          .first()
          .click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        const video = dialog.locator("video");
        await expect(video).toHaveAttribute("controls", "");
        await expect(video).toHaveAttribute("playsinline", "");
        await expect
          .poll(() =>
            video.evaluate((element: HTMLVideoElement) => element.readyState),
          )
          .toBeGreaterThanOrEqual(1);
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
        await expect
          .poll(() =>
            video.evaluate((element: HTMLVideoElement) => element.currentTime),
          )
          .toBeGreaterThanOrEqual(4.5);
        expect(
          await video.evaluate((element: HTMLVideoElement) => element.paused),
        ).toBe(true);
        const track = dialog.locator("track[kind=captions]");
        const captions = await page.request.get(
          (await track.getAttribute("src"))!,
        );
        expect(captions.ok()).toBe(true);
        expect(await captions.text()).toContain("WEBVTT");
        await dialog.locator("summary").click();
        await expect(dialog).toContainText(fr ? "fictive" : "fictional");
        await dialog.getByRole("link").last().scrollIntoViewIfNeeded();
        await expect.poll(fits).toBe(true);
        await dialog.screenshot({
          path: testInfo.outputPath(`video-${locale}.png`),
        });
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();

        await page.goto(fr ? "/fr/reserver-audit" : "/book-audit");
        // Await the form's client draft effect, not just server-rendered inputs.
        // WebKit can fill SSR fields before React attaches input handlers.
        await expect
          .poll(() =>
            page.evaluate(() =>
              sessionStorage.getItem("tradecatch-book-audit-draft"),
            ),
          )
          .not.toBeNull();
        const next = page.getByRole("button", {
          name: fr ? "Continuer" : "Continue",
          exact: true,
        });
        await page.locator("#audit-field-firstName").fill("Mobile");
        await page.locator("#audit-field-lastName").fill("Test");
        await next.click();
        await page
          .locator("#audit-field-company")
          .fill("Fictional Test Company");
        await next.click();
        const radios = page.getByRole("radio");
        await radios.first().focus();
        await page.keyboard.press("ArrowRight");
        await expect(radios.nth(1)).toBeChecked();
        await expect(radios.nth(1)).toBeFocused();
        await next.click();
        await page.locator("#audit-field-email").fill("mobile@example.invalid");
        await page.locator("#audit-field-phone").fill("514-555-0100");
        await expect.poll(fits).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`contact-${locale}.png`),
          fullPage: true,
        });
        const accessibility = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(accessibility.violations).toEqual([]);
        await next.click();
        await page.locator("#audit-field-city").fill("Laval");
        await next.click();
        await page.locator("#audit-field-serviceConsent").check();
        await page
          .getByRole("button", {
            name: fr ? "Réviser les réponses" : "Review answers",
            exact: true,
          })
          .click();
        await page.route("**/api/book-audit", (route) =>
          route.fulfill({ json: { ok: true, leadSaved: true } }),
        );
        await page
          .getByRole("button", {
            name: fr ? "Soumettre la demande" : "Submit request",
            exact: true,
          })
          .click();
        await expect(page.getByRole("heading", { level: 1 })).toContainText(
          fr ? "demande" : "audit request is in",
        );
        await expect.poll(fits).toBe(true);
        expect(errors).toEqual([]);
      });
    }
  });
}

for (const locale of ["en", "fr"] as const) {
  test(`touch interaction with receptionist demo (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      for (const key of ["SpeechRecognition", "webkitSpeechRecognition"])
        Object.defineProperty(window, key, {
          value: undefined,
          configurable: true,
        });
    });
    await page.goto(locale === "fr" ? "/fr/receptionniste" : "/receptionist");
    const reject = page.getByRole("button", {
      name:
        locale === "fr" ? "Refuser les non essentiels" : "Reject non-essential",
      exact: true,
    });
    await reject.click();
    const demo = page.locator("#try-it");
    await demo.scrollIntoViewIfNeeded();
    await demo
      .getByRole("button", {
        name:
          locale === "fr"
            ? /Pendant les heures d'ouverture/i
            : /During business hours/,
      })
      .tap();
    await expect(demo.getByRole("log")).toContainText(
      locale === "fr" ? /Plomberie|plomberie/ : /Plumbing/,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  });
}
