import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Pricing page: two plans only (Essential and Professional), the same one-time
 * setup fee on both, CAD everywhere, the first monthly charge one month after
 * setup, and the optional website service that is never added automatically.
 */

async function settle(page: Page) {
  // Cards slide in with a transform; wait until the plan cards are in the DOM.
  await page.locator("main article").first().waitFor({ state: "visible" });
}

function planCard(page: Page, name: string) {
  return page.locator("main article").filter({
    has: page.getByRole("heading", { name, exact: true, level: 2 }),
  });
}

test.describe("pricing page", () => {
  test("English: two plans with the agreed prices, in CAD, with setup and monthly shown apart", async ({
    page,
  }) => {
    await page.goto("/pricing");
    await settle(page);
    const main = page.locator("main");

    await expect(main.locator("article")).toHaveCount(2);

    const essential = planCard(page, "Essential");
    await expect(essential).toContainText("$1,999.99");
    await expect(essential).toContainText("$249");
    await expect(essential).toContainText(
      "Your first $249 monthly charge comes one month after setup.",
    );

    const professional = planCard(page, "Professional");
    await expect(professional).toContainText("$1,999.99");
    await expect(professional).toContainText("$349");
    await expect(professional).toContainText(
      "Your first $349 monthly charge comes one month after setup.",
    );

    // Currency and billing order are stated once, high on the page.
    await expect(main).toContainText("All prices are in Canadian dollars");
    await expect(main).toContainText(
      "Your first monthly charge comes one month later.",
    );

    // The retired plans and their prices are gone from the page.
    for (const legacy of ["Starter", "Growth", "Receptionist Plus"]) {
      await expect(
        page.getByRole("heading", { name: legacy, exact: true }),
      ).toHaveCount(0);
    }
    const text = await main.innerText();
    expect(text).not.toMatch(/\$949\.99|\$1,499\.99|\$649\.99|\$799\.99|\$300\.00/);
    expect(text).not.toMatch(/voice cloning|call transfer|free month/i);
  });

  test("French: the same prices in Québec format", async ({ page }) => {
    await page.goto("/fr/tarifs");
    await settle(page);
    const main = page.locator("main");
    await expect(main.locator("article")).toHaveCount(2);
    // Québec format uses a non-breaking space before "$" and in thousands.
    const text = (await main.innerText()).replace(/[  ]/g, " ");

    expect(text).toContain("1 999,99 $");
    expect(text).toContain("249 $");
    expect(text).toContain("349 $");
    expect(text).toContain("699,99 $");
    expect(text).toContain("Tous les prix sont en dollars canadiens");
    expect(text).not.toMatch(/949,99|1 499,99|649,99|799,99/);
    expect(text).not.toMatch(/mois gratuit/i);
  });

  test("Professional says scheduling is switched on after testing until the operator confirms it is verified", async ({
    page,
  }) => {
    await page.goto("/pricing");
    await settle(page);
    await expect(planCard(page, "Professional")).toContainText(
      "switched on for your business once it has been tested",
    );
    await expect(planCard(page, "Essential")).not.toContainText(
      "switched on for your business",
    );
  });

  test("the optional website service sits under the plans, is priced once and is never automatic", async ({
    page,
  }) => {
    await page.goto("/pricing");
    await settle(page);
    const section = page.locator("#website-service");
    await expect(section).toBeVisible();
    await expect(
      section.getByRole("heading", { name: "Done-for-You Website Service" }),
    ).toBeVisible();
    await expect(section).toContainText("$699.99 CAD");
    await expect(section).toContainText("Available with Essential or Professional.");
    await expect(section).toContainText("Never added to your order automatically");

    // Order on the page: plan cards, then the website service.
    const websiteAfterPlans = await page.evaluate(() => {
      const articles = [...document.querySelectorAll("main article")];
      const lastPlan = articles[articles.length - 1]!;
      const website = document.querySelector("#website-service")!;
      return Boolean(
        lastPlan.compareDocumentPosition(website) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(websiteAfterPlans).toBe(true);

    // Each plan points at the add-on without adding it.
    const mentions = page.getByRole("link", {
      name: "Need a website? Add our website service for $699.99.",
    });
    await expect(mentions).toHaveCount(2);
    for (const link of await mentions.all()) {
      await expect(link).toHaveAttribute("href", "#website-service");
    }

    const cta = section.getByRole("link", { name: "Get My Website Built" });
    await expect(cta).toHaveAttribute("href", "/website-request");
    await cta.click();
    await expect(page).toHaveURL(/\/website-request$/);
    await expect(
      page.getByRole("heading", { name: "Tell us what your website needs" }),
    ).toBeVisible();
    // The visitor chooses between the two requests; neither is assumed for them.
    const newSite = page.getByLabel("A new professional website");
    const improve = page.getByLabel("Improvements to my current website");
    await expect(newSite).not.toBeChecked();
    await expect(improve).not.toBeChecked();
    await improve.check();
    await expect(page.getByLabel(/Your current website/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Get My Website Built" }),
    ).toBeVisible();
    await expect(page.locator("main")).toContainText("$699.99 CAD");
  });

  test("French: the website service and its request page", async ({ page }) => {
    await page.goto("/fr/tarifs");
    await settle(page);
    const section = page.locator("#website-service");
    await expect(section).toBeVisible();
    await expect(section).toContainText("699,99 $ CAD");
    await section
      .getByRole("link", { name: "Faire créer mon site web" })
      .click();
    await expect(page).toHaveURL(/\/fr\/demande-site-web$/);
    await expect(page.locator("main h1")).toBeVisible();
  });

  test("the comparison table shows only what the two plans really differ on", async ({
    page,
  }) => {
    await page.goto("/pricing");
    await settle(page);
    const table = page.locator("#compare table");
    await expect(table).toBeVisible();
    const text = await table.innerText();
    expect(text).toMatch(/Essential/);
    expect(text).toMatch(/Professional/);
    expect(text).not.toMatch(/voice clon|transfer|bulk|CRM|multi-location/i);
  });

  for (const path of ["/pricing", "/fr/tarifs"]) {
    test(`${path} has no WCAG A/AA violations in the plans and the website service`, async ({
      page,
    }) => {
      await page.goto(path);
      await settle(page);
      await page.locator("#website-service").scrollIntoViewIfNeeded();
      const results = await new AxeBuilder({ page })
        .include("main")
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
