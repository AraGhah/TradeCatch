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

  test("Done-for-You Website Service sits directly under the three plans, before enterprise and FAQs", async ({
    page,
  }) => {
    await page.goto("/pricing");
    await plans(page);
    const section = page.locator("#website-service");
    await expect(section).toBeVisible();
    await expect(section.getByRole("heading", { name: "Done-for-You Website Service" })).toBeVisible();
    await expect(section).toContainText("Starting at $349 CAD");
    await expect(section).toContainText("Starter, Growth and Receptionist Plus");

    // Order on the page: plan cards, then the website service, then the rest.
    const order = await page.evaluate(() => {
      const main = document.querySelector("main")!;
      const articles = [...main.querySelectorAll("article")];
      const lastPlan = articles[articles.length - 1]!;
      const website = document.querySelector("#website-service")!;
      const faq = [...main.querySelectorAll("h2")].find((h) => /question|faq/i.test(h.textContent ?? ""));
      const follows = (a: Element, b: Element) =>
        Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        websiteAfterPlans: follows(lastPlan, website),
        faqAfterWebsite: faq ? follows(website, faq) : null,
        sections: main.querySelectorAll("#website-service").length,
      };
    });
    expect(order.websiteAfterPlans).toBe(true);
    expect(order.faqAfterWebsite).not.toBe(false);
    // The old duplicate "Website Builder" block is gone.
    expect(order.sections).toBe(1);
    expect(await page.locator("main").innerText()).not.toMatch(/website builder/i);
  });

  test("each plan says a website is available, and the CTA leads to the request form", async ({
    page,
  }) => {
    await page.goto("/pricing");
    await plans(page);
    const mentions = page.getByRole("link", {
      name: "Need a website? Add our website service starting at $349.",
    });
    await expect(mentions).toHaveCount(3);
    for (const link of await mentions.all()) {
      await expect(link).toHaveAttribute("href", "#website-service");
    }

    const cta = page.locator("#website-service").getByRole("link", { name: "Get My Website Built" });
    await expect(cta).toHaveAttribute("href", "/website-request");
    await cta.click();
    await expect(page).toHaveURL(/\/website-request$/);
    await expect(page.getByRole("heading", { name: "Tell us what your website needs" })).toBeVisible();
    // The visitor chooses between the two requests; neither is assumed for them.
    const newSite = page.getByLabel("A new professional website");
    const improve = page.getByLabel("Improvements to my current website");
    await expect(newSite).not.toBeChecked();
    await expect(improve).not.toBeChecked();
    await improve.check();
    await expect(page.getByLabel(/Your current website/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Get My Website Built" })).toBeVisible();
    // It says plainly that this is not part of the subscription.
    await expect(page.locator("main")).toContainText("Starting at $349 CAD");
  });

  test("French: the website service and its request page", async ({ page }) => {
    await page.goto("/fr/tarifs");
    await plans(page);
    const section = page.locator("#website-service");
    await expect(section).toBeVisible();
    await expect(section).toContainText("349");
    const cta = section.getByRole("link").filter({ hasText: /site/i }).last();
    await cta.click();
    await expect(page).toHaveURL(/\/fr\/demande-site-web$/);
    await expect(page.locator("main h1")).toBeVisible();
  });

  test("Custom Voice Cloning is a Receptionist Plus exclusive, on the card and in the comparison table", async ({
    page,
  }) => {
    await page.goto("/pricing");
    await plans(page);
    const main = page.locator("main");
    const planCard = (name: string) =>
      main.locator("article").filter({
        has: page.getByRole("heading", { name, exact: true, level: 2 }),
      });

    const plus = planCard("Receptionist Plus");
    const callout = plus.getByTestId("plan-exclusive");
    await expect(callout).toContainText("Only on Receptionist Plus");
    await expect(callout).toContainText("Custom Voice Cloning");
    await expect(callout).toContainText(
      "Make your receptionist sound like you. Record your voice once, and let your receptionist answer customer calls using your voice.",
    );
    await expect(planCard("Growth").getByTestId("plan-exclusive")).toHaveCount(0);
    await expect(planCard("Starter").getByTestId("plan-exclusive")).toHaveCount(0);

    await expect(main.locator("table")).toContainText("Custom Voice Cloning (your own voice)");
    // Plans and prices are unchanged by it.
    await expect(plus).toContainText("$1,999.99");
    await expect(plus).toContainText("$949.99");
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
