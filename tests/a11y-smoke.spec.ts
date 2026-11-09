import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Lightweight accessibility smoke — not a full axe/Lighthouse suite.
 * Catches regressions in document outline and primary landmark structure.
 */
test.describe("accessibility smoke", () => {
  for (const path of [
    "/",
    "/book-audit",
    "/fr",
    "/fr/reserver-audit",
    "/website-request",
    "/fr/demande-site-web",
  ]) {
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

    // The first field autofocuses once React hydrates and attaches its
    // onChange listener; waiting for focus avoids filling the input before
    // hydration completes, which would leave Continue stuck disabled.
    const firstName = page.locator("#audit-field-firstName");
    await expect(firstName).toBeFocused();

    // Wizard starts on name + company text steps; trade is the first choice.
    await firstName.fill("Jean");
    await page.locator("#audit-field-lastName").fill("Dupont");
    await page.getByRole("button", { name: /continue/i }).click();

    await page.locator("#audit-field-company").fill("TradeCatch HVAC");
    await page.getByRole("button", { name: /continue/i }).click();

    const group = page.locator("[role='radiogroup']").first();
    await expect(group).toBeVisible({ timeout: 15_000 });
    await expect(group.locator("[role='radio']").first()).toBeVisible();
  });

  for (const path of [
    "/",
    "/book-audit",
    "/pricing",
    "/login",
    "/fr",
    "/fr/reserver-audit",
  ]) {
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
          .map(
            (violation) =>
              `${violation.id}: ${violation.help} (${violation.nodes.length} node(s))`,
          )
          .join("\n"),
      ).toEqual([]);
    });
  }
});

/**
 * The homepage below 1024px is a separate composition (HomeMobile), so the
 * desktop-width checks above never see it. These cover phone and tablet width:
 * AA text contrast, plus a keyboard pass that every tab stop shows a focus ring
 * and that tappable rows are at least 24 CSS px tall (WCAG 2.2, 2.5.8).
 */
const SMALL_SCREENS = {
  phone: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
} as const;

for (const [device, viewport] of Object.entries(SMALL_SCREENS)) {
  test.describe(`${device} width (${viewport.width}px)`, () => {
    test.use({ viewport });

    for (const path of ["/", "/fr", "/receptionist"]) {
      test(`${path} text meets AA contrast`, async ({ page }) => {
        await page.goto(path);
        await page.evaluate(() =>
          document
            .querySelectorAll("[data-reveal]")
            .forEach((el) => el.classList.add("is-visible")),
        );
        const results = await new AxeBuilder({ page })
          .withRules(["color-contrast"])
          .analyze();
        expect(
          results.violations.flatMap((violation) =>
            violation.nodes.map(
              (node) =>
                `${node.target.join(" ")}: ${String(
                  (node.any[0]?.data as { contrastRatio?: number } | undefined)
                    ?.contrastRatio ?? "?",
                )}`,
            ),
          ),
        ).toEqual([]);
      });
    }

    for (const path of ["/", "/fr"]) {
      test(`${path} keyboard focus is visible and rows are tappable`, async ({
        page,
      }) => {
        await page.goto(path);
        await page.evaluate(() =>
          document
            .querySelectorAll("[data-reveal]")
            .forEach((el) => el.classList.add("is-visible")),
        );

        // The desktop composition stays in the DOM (display: none) below lg.
        const rows = page.locator("main details > summary:visible");
        const rowCount = await rows.count();
        expect(rowCount).toBeGreaterThan(0);
        for (let i = 0; i < rowCount; i++) {
          const box = await rows.nth(i).boundingBox();
          expect(box?.height ?? 0, `row ${i} height`).toBeGreaterThanOrEqual(
            24,
          );
        }

        const withoutRing: string[] = [];
        let stops = 0;
        for (let i = 0; i < 80; i++) {
          await page.keyboard.press("Tab");
          const stop = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return {
              label: (
                el.getAttribute("aria-label") ||
                el.textContent ||
                el.tagName
              )
                .trim()
                .replace(/\s+/g, " ")
                .slice(0, 40),
              visible: rect.width > 0 && rect.height > 0,
              ring:
                (style.outlineStyle !== "none" &&
                  parseFloat(style.outlineWidth) > 0) ||
                style.boxShadow !== "none",
            };
          });
          if (!stop) break;
          stops += 1;
          if (!stop.visible || !stop.ring) withoutRing.push(stop.label);
        }
        expect(stops).toBeGreaterThan(15);
        expect(withoutRing).toEqual([]);
      });
    }
  });
}
