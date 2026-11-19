import { expect, test, type Page } from "@playwright/test";
import { signInAs, workspaceSession } from "./support/workspace-session";

/**
 * KAN-18 in a real browser: the plan a customer sees on the website is the plan
 * and price they see in the dashboard, it survives a refresh and a fresh
 * login, no screen still says Growth / Starter / Receptionist Plus, and the
 * Professional calendar is only reachable on Professional.
 *
 * This harness runs on the in-memory store with no Stripe or Postgres, so it
 * proves the plan, price and feature half. The Stripe-synced half (status, next
 * charge, upgrades, cancellations, concurrent webhooks) is covered on real SQL
 * in tests/unit/plan-sync.test.ts (PLAN-05..08, 11, 12).
 */

const RETIRED = /\b(Growth|Starter|Receptionist Plus|Réceptionniste Plus)\b/;

const PATHS = {
  en: { pricing: "/pricing", billing: "/billing", settings: "/app/settings", calendar: "/app/settings/calendar", referrals: "/app/referrals" },
  fr: { pricing: "/fr/tarifs", billing: "/fr/facturation", settings: "/fr/app/parametres", calendar: "/fr/app/parametres/calendrier", referrals: "/fr/app/parrainage" },
} as const;

const PLAN = {
  essential: { name: "Essential", en: "$249.99", fr: /249,99\s?\$/ },
  professional: { name: "Professional", en: "$349.99", fr: /349,99\s?\$/ },
} as const;

/** The plan card on the pricing page: heading, then the first "$N" amount it shows. */
async function websitePrice(page: Page, locale: "en" | "fr", name: string) {
  await page.goto(PATHS[locale].pricing);
  const card = page.locator("main article").filter({
    has: page.getByRole("heading", { name, exact: true, level: 2 }),
  });
  await expect(card).toBeVisible();
  return card.innerText();
}

for (const locale of ["en", "fr"] as const) {
  for (const plan of ["essential", "professional"] as const) {
    test.describe(`${plan} (${locale})`, () => {
      test(`PLAN-0${plan === "essential" ? 1 : 2}/03/04: the dashboard names the plan and shows the same monthly price as the website`, async ({ page }) => {
        const expected = PLAN[plan];
        const pricingText = await websitePrice(page, locale, expected.name);
        if (locale === "en") expect(pricingText).toContain(expected.en);
        else expect(pricingText).toMatch(expected.fr);

        await workspaceSession(page, locale, plan);

        // Billing page.
        await page.goto(PATHS[locale].billing);
        const billing = page.locator("body");
        await expect(billing).toContainText(expected.name);
        await expect(billing).toContainText(locale === "en" ? expected.en : expected.fr);
        const billingText = await billing.innerText();
        expect(billingText).not.toMatch(RETIRED);
        // The other plan's name is not on this customer's card.
        const other = plan === "essential" ? "Professional" : "Essential";
        expect(billingText).not.toContain(other + ":");

        // Account settings: same name, same price.
        await page.goto(PATHS[locale].settings);
        const settingsPlan = page.locator("section").filter({ has: page.getByText(expected.name, { exact: true }) }).first();
        await expect(settingsPlan).toContainText(locale === "en" ? expected.en : expected.fr);
      });

      test("PLAN-08: the plan survives a refresh and a fresh login", async ({ page }) => {
        const { email, clientIp } = await workspaceSession(page, locale, plan);
        const expected = PLAN[plan];
        const check = async () => {
          await page.goto(PATHS[locale].billing);
          await expect(page.locator("body")).toContainText(expected.name);
          await expect(page.locator("body")).toContainText(locale === "en" ? expected.en : expected.fr);
        };
        await check();
        await page.reload();
        await check();

        // A brand-new session, as after signing out and back in.
        await page.context().clearCookies();
        await signInAs(page, email, clientIp, locale);
        await check();
        await page.goto(PATHS[locale].settings);
        await expect(page.getByText(expected.name, { exact: true }).first()).toBeVisible();
      });

      test("PLAN-10: the calendar is only reachable on Professional", async ({ page }) => {
        await workspaceSession(page, locale, plan);
        const api = await page.request.get("/api/app/bookings");
        await page.goto(PATHS[locale].settings);
        const calendarLink = page.locator(`a[href$="${PATHS[locale].calendar}"]`);
        await page.goto(PATHS[locale].calendar);
        if (plan === "professional") {
          expect(api.status()).toBe(200);
          await page.goto(PATHS[locale].settings);
          await expect(calendarLink).toHaveCount(1);
        } else {
          expect(api.status()).toBe(402);
          expect(((await api.json()) as { upgrade: string }).upgrade).toBe("professional");
          // Someone who follows an old calendar link gets the readable refusal, not a calendar.
          await expect(page.getByRole("heading", { level: 1 })).toContainText(
            locale === "en" ? "Appointments come with Professional" : "Les rendez-vous sont inclus avec Professional",
          );
          await page.goto(PATHS[locale].settings);
          await expect(calendarLink).toHaveCount(0);
          // Essential is pointed at Professional, with its price.
          await expect(page.locator("body")).toContainText(locale === "en" ? "$349.99" : /349,99\s?\$/);
        }
      });
    });
  }

  test(`PLAN-05/09: a customer on a retired plan sees a public name and no retired label (${locale})`, async ({ page }) => {
    // growth -> Professional, starter -> Essential, per src/lib/plan-names.ts.
    for (const [legacy, publicName] of [
      ["growth", "Professional"],
      ["starter", "Essential"],
    ] as const) {
      await workspaceSession(page, locale, legacy);
      await page.goto(PATHS[locale].billing);
      await expect(page.locator("body")).toContainText(publicName);
      for (const path of [PATHS[locale].billing, PATHS[locale].settings, PATHS[locale].referrals, locale === "fr" ? "/fr" : "/"]) {
        await page.goto(path);
        const text = await page.locator("body").innerText();
        expect(text, `${legacy} on ${path}`).not.toMatch(RETIRED);
      }
      // A retired plan keeps the price it was sold at: the card must not claim
      // the catalog price of the plan it is labelled with ("Essential: $249.99").
      await page.goto(PATHS[locale].billing);
      const billing = await page.locator("body").innerText();
      expect(billing).not.toMatch(new RegExp(`${publicName}\\s*:\\s*[\\d$]`));
      await page.context().clearCookies();
    }
  });
}

test("PLAN-09: no customer-facing page names a retired plan, in either language", async ({ page }) => {
  const pages = {
    en: ["/", "/pricing", "/how-it-works", "/faq", "/about", "/industries", "/receptionist", "/one-pager", "/book-audit"],
    fr: ["/fr", "/fr/tarifs"],
  };
  for (const [locale, paths] of Object.entries(pages)) {
    for (const path of paths) {
      const response = await page.goto(path);
      if (!response || response.status() >= 400) continue; // a route this site does not have
      const text = await page.locator("body").innerText();
      expect(text, `${locale} ${path}`).not.toMatch(RETIRED);
    }
  }
});
