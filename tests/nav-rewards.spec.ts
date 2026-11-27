import { expect, test, type Page } from "@playwright/test";
import en from "../src/messages/en.json";
import fr from "../src/messages/fr.json";

/**
 * The desktop header's referral item reads "Rewards" / "Récompenses", still
 * opens the referral page, and every desktop nav item stays on one line from
 * the width the desktop nav appears (1080px) up.
 */
const LOCALES = {
  en: { path: "/", label: en.nav.referral, old: "Referral program" },
  fr: { path: "/fr", label: fr.nav.referral, old: "Programme de parrainage" },
} as const;
const WIDTHS = [1080, 1180, 1280, 1440, 1920] as const;

async function open(page: Page, path: string, lang: string) {
  // A visit to /fr stores the locale; without this, "/" would then open in French.
  await page.context().clearCookies();
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
}

function desktopNav(page: Page) {
  return page.locator("header nav").filter({ has: page.locator("a[href$='referral'], a[href$='parrainage'], a[href*='referral']") }).first();
}

for (const [locale, copy] of Object.entries(LOCALES)) {
  test(`${locale}: the referral item reads "${copy.label}" and still opens the referral page`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, copy.path, locale);
    const nav = desktopNav(page);
    await expect(nav).toBeVisible();
    const item = nav.getByRole("link", { name: copy.label, exact: true });
    await expect(item).toBeVisible();
    await expect(nav.getByText(copy.old)).toHaveCount(0);

    // Same destination as before the rename (the localized referral route).
    const href = await item.getAttribute("href");
    await Promise.all([page.waitForURL((url) => url.pathname === href), item.click()]);
    await expect(page).toHaveURL((url) => url.pathname === href);
    // The referral page itself is unchanged: its own title still says "program".
    await expect(page.getByText(copy.old).first()).toBeVisible();
  });

  test(`${locale}: every desktop nav item stays on one line`, async ({ page }) => {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await open(page, copy.path, locale);
      const nav = desktopNav(page);
      await expect(nav).toBeVisible();
      const report = await nav.evaluate((el) => {
        const bar = el.closest("header")!.getBoundingClientRect();
        // The menu items: Services, How it works, Industries, Pricing, Rewards.
        const items = [...el.querySelectorAll<HTMLElement>("a")];
        const wrapped = items
          .filter((node) => {
            const text = node.textContent?.trim();
            if (!text) return false;
            // The label's own text nodes only (not the underline bar or the
            // loading hint): wrapped text has boxes on more than one line.
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
            const tops = new Set<number>();
            for (let t = walker.nextNode(); t; t = walker.nextNode()) {
              if (!t.textContent?.trim()) continue;
              const range = document.createRange();
              range.selectNodeContents(t);
              for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top));
            }
            return tops.size > 1;
          })
          .map((node) => node.textContent?.trim());
        const menu = [...el.querySelectorAll("a")].map((a) => Math.round(a.getBoundingClientRect().top));
        const boxes = items.map((node) => node.getBoundingClientRect());
        const overlaps = boxes.some((a, i) =>
          boxes.some((b, j) => j > i && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1 && !items[i].contains(items[j]) && !items[j].contains(items[i])),
        );
        return {
          wrapped,
          menuRows: new Set(menu).size,
          overlaps,
          navOverflow: el.scrollWidth - el.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          withinHeader: boxes.every((r) => r.top >= bar.top && r.bottom <= bar.bottom),
        };
      });
      const where = `${locale} at ${width}px`;
      expect(report.wrapped, where).toEqual([]);
      expect(report.menuRows, where).toBe(1);
      expect(report.overlaps, where).toBe(false);
      expect(report.navOverflow, where).toBeLessThanOrEqual(0);
      expect(report.pageOverflow, where).toBeLessThanOrEqual(0);
      expect(report.withinHeader, where).toBe(true);
      if (width === 1080 || width === 1440) {
        await page.locator("header").screenshot({ path: `test-results/nav-rewards-${locale}-${width}.png` });
      }
    }
  });
}
