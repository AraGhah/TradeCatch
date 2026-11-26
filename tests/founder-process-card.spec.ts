import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import en from "../src/messages/en.json";
import fr from "../src/messages/fr.json";

/**
 * The founder section's process card ("Who you're actually hiring"). It once
 * rendered as an empty box: `.tc-card` is unlayered CSS, so its light
 * background beat the `bg-navy` utility and hid the white text. These checks
 * read what the browser actually paints, not the class names.
 */
const COPY = { en: en.home.founder, fr: fr.home.founder } as const;
// The founder section is part of the desktop home (lg and up).
const WIDTHS = [1024, 1280, 1536] as const;

function card(page: Page) {
  return page.locator("ol[aria-labelledby='founder-process-label']").locator("xpath=..");
}

async function showCard(page: Page, path: string) {
  // A visit to /fr stores the locale; without this, "/" would then open in French.
  await page.context().clearCookies();
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("lang", path === "/fr" ? "fr" : "en");
  const box = card(page);
  await box.scrollIntoViewIfNeeded();
  await expect(box).toBeVisible();
  // Let the section's reveal transition finish before reading colors.
  await expect
    .poll(async () => box.evaluate((el) => Number(getComputedStyle(el.closest("section")!).opacity)))
    .toBe(1);
  return box;
}

for (const locale of ["en", "fr"] as const) {
  const copy = COPY[locale];
  const path = locale === "en" ? "/" : "/fr";

  test(`${locale}: the process card shows four numbered steps and the founder's signature on navy`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const box = await showCard(page, path);

    // Painted navy, not the light card surface.
    const bg = await box.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe("rgb(12, 20, 30)");

    await expect(box.getByText(copy.workLabel, { exact: true })).toBeVisible();
    const steps = box.locator("ol > li");
    await expect(steps).toHaveCount(4);
    for (const [i, step] of copy.work.entries()) {
      const item = steps.nth(i);
      await expect(item.getByText(String(i + 1).padStart(2, "0"), { exact: true })).toBeVisible();
      await expect(item.getByText(step.title, { exact: true })).toBeVisible();
      await expect(item.getByText(step.body, { exact: true })).toBeVisible();
      // The step number is the orange accent.
      const number = item.getByText(String(i + 1).padStart(2, "0"), { exact: true });
      expect(await number.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(228, 118, 43)");
    }
    await expect(box.getByText(copy.name, { exact: true })).toBeVisible();
    await expect(box.getByText(copy.role, { exact: true })).toBeVisible();
    // No photograph in the card.
    await expect(box.locator("img, picture, svg image")).toHaveCount(0);

    // The list is named by the card label, and the numbers are not read twice.
    await expect(page.getByRole("list", { name: copy.workLabel })).toHaveCount(1);
    await expect(steps.first().locator("[aria-hidden]")).toHaveCount(1);
  });

  test(`${locale}: the process card meets AA contrast`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await showCard(page, path);
    const results = await new AxeBuilder({ page })
      .include("ol[aria-labelledby='founder-process-label']")
      .include("#founder-process-label")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      results.violations,
      results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`).join("\n"),
    ).toEqual([]);
  });
}

test("the card stays inside its column, sits level with the text and never overflows", async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/fr"]) {
      const box = await showCard(page, path);
      const geometry = await box.evaluate((el) => {
        const column = el.parentElement!;
        const text = column.children[1] as HTMLElement;
        const r = el.getBoundingClientRect();
        const t = text.getBoundingClientRect();
        const overflowing = [...el.querySelectorAll("*")].some(
          (node) => (node as HTMLElement).scrollWidth > (node as HTMLElement).clientWidth + 1 && getComputedStyle(node).overflowX === "visible" && (node as HTMLElement).clientWidth > 0,
        );
        return {
          cardRight: r.right,
          textLeft: t.left,
          cardCenter: r.top + r.height / 2,
          textCenter: t.top + t.height / 2,
          cardHeight: r.height,
          textHeight: t.height,
          overflowing,
          scroll: el.scrollWidth - el.clientWidth,
        };
      });
      const where = `${path} at ${width}px`;
      expect(geometry.cardRight, where).toBeLessThanOrEqual(geometry.textLeft);
      expect(geometry.scroll, where).toBeLessThanOrEqual(0);
      expect(geometry.overflowing, where).toBe(false);
      // Vertically centred against the text column (balanced, not top-heavy).
      expect(Math.abs(geometry.cardCenter - geometry.textCenter), where).toBeLessThan(4);
      await page.screenshot({ path: `test-results/founder-card-${path === "/" ? "en" : "fr"}-${width}.png`, clip: await sectionClip(page) });
    }
  }
});

async function sectionClip(page: Page) {
  const section = card(page).locator("xpath=ancestor::section[1]");
  const r = (await section.boundingBox())!;
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}
