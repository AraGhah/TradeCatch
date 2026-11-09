import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { waitForFormHydration } from "./support/hydration";

/**
 * "Get your link": the journey a customer actually takes. Runs against the
 * localhost-only harness (no database, no real payments); every account here is
 * a synthetic organization that exists only for this run.
 *
 * Optional database run: with a server started against a LOCAL throwaway PostgreSQL
 * and REFERRAL_VERIFY_DATABASE_URL set to that same database, each synthetic
 * organization is also given a "paid" setup checkout, because the real database
 * only hands a link to a business that has paid (the no-database harness waives
 * that). Never point it at a shared or production database.
 */

const OPS = {
  Authorization: "Bearer tradecatch-e2e-ops-secret-not-for-production",
  "X-Ops-Actor": "playwright-referral-link",
};
const LINK_PATTERN = /\/referral\?ref=[2-9A-HJKMNP-Z]{10}$/;

async function provision(page: Page) {
  const email = `referral-${randomUUID()}@example.invalid`;
  // Independent documentation-range identity per session: repeated logins in a
  // large suite must not exhaust one worker's quota.
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `2001:db8:${randomUUID().replaceAll("-", "").match(/.{4}/g)!.slice(0, 6).join(":")}`,
  });
  const created = await page.request.post(
    "/api/missed-call/ops/provision-organization",
    {
      headers: OPS,
      data: {
        email,
        organizationName: "Referral Plumbing",
        ownerName: "Referral Owner",
        locale: "en",
        plan: "essential",
      },
    },
  );
  expect(created.status()).toBe(201);
  const databaseUrl = process.env.REFERRAL_VERIFY_DATABASE_URL;
  if (databaseUrl) {
    const { organization } = (await created.json()) as {
      organization: { id: string };
    };
    const db = new Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      await db.query(
        `INSERT INTO tc_installation_checkouts (id, organization_id, plan, checkout_session_id, livemode, status)
         VALUES ($1, $2, 'essential', $3, false, 'paid')`,
        [`ic_${randomUUID()}`, organization.id, `cs_test_${randomUUID()}`],
      );
    } finally {
      await db.end();
    }
  }
  return email;
}

async function dismissCookies(page: Page) {
  const reject = page.getByRole("button", { name: "Reject non-essential" });
  try {
    await reject.waitFor({ state: "visible", timeout: 2_000 });
    await reject.click();
  } catch {
    // Already chosen in this browser context.
  }
}

/** Signs in through the real login page with the emailed-link route. */
async function signInThroughLoginPage(page: Page, email: string) {
  await waitForFormHydration(page);
  await page.getByLabel("Work email").fill(email);
  await page
    .getByRole("button", { name: "Email me a sign-in link instead" })
    .click();
  await page
    .getByRole("button", { name: "Email me a sign-in link", exact: true })
    .click();
  await page.getByRole("link", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
}

test.describe("referral link", () => {
  test("a signed-out customer signs in, lands back on the referral page and gets one saved, copyable link", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const email = await provision(page);

    // Straight to the referral page while signed out: sign in, then come back.
    await page.goto("/app/referrals");
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Freferrals$/);
    await dismissCookies(page);
    await signInThroughLoginPage(page, email);
    await expect(page).toHaveURL(/\/app\/referrals$/);

    const posts: string[] = [];
    page.on("request", (request) => {
      if (
        request.url().endsWith("/api/app/referrals/link") &&
        request.method() === "POST"
      ) {
        posts.push(request.url());
      }
    });

    // No link is made just by looking at the page.
    const getLink = page.getByTestId("referral-get-link");
    await expect(getLink).toBeVisible();
    await expect(page.locator("#referral-link")).toHaveCount(0);

    // Two fast clicks create one link.
    await getLink.dblclick();
    const field = page.locator("#referral-link");
    await expect(field).toBeVisible();
    const link = await field.inputValue();
    expect(link).toMatch(LINK_PATTERN);
    expect(link.startsWith("http://localhost:")).toBe(true);
    expect(posts).toHaveLength(1);

    // Copying says so, and the clipboard really holds the link.
    await page.getByTestId("referral-copy").click();
    await expect(page.getByTestId("referral-copy-status")).toHaveText(
      "Link copied to your clipboard.",
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      link,
    );

    // The link is the same after a reload, and asking again never makes a new one.
    await page.reload();
    await expect(page.locator("#referral-link")).toHaveValue(link);
    const again = await page.request.post("/api/app/referrals/link");
    expect(again.status()).toBe(200);
    expect(await again.json()).toMatchObject({
      ok: true,
      created: false,
      link,
    });

    // Only the signed-in customer can ask: no session, no link.
    const stranger = await page.context().browser()!.newContext();
    const denied = await stranger.request.post(
      `${new URL(page.url()).origin}/api/app/referrals/link`,
      { headers: { Origin: new URL(page.url()).origin } },
    );
    expect(denied.status()).toBe(401);
    await stranger.close();
  });

  test("a failed save shows an honest message and a retry, never a placeholder link", async ({
    page,
  }) => {
    const email = await provision(page);
    await page.goto("/app/referrals");
    await dismissCookies(page);
    await signInThroughLoginPage(page, email);
    await expect(page).toHaveURL(/\/app\/referrals$/);

    await page.route("**/api/app/referrals/link", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 503, json: { error: "storage_unavailable" } })
        : route.continue(),
    );
    const getLink = page.getByTestId("referral-get-link");
    await getLink.click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "We could not create your link" }),
    ).toContainText("nothing was saved");
    await expect(page.locator("#referral-link")).toHaveCount(0);
    await expect(getLink).toHaveText("Try again");
    await expect(getLink).toBeEnabled();

    // Even a "success" without a real link is refused.
    await page.unroute("**/api/app/referrals/link");
    await page.route("**/api/app/referrals/link", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 200,
            json: { ok: true, link: "/not-a-link" },
          })
        : route.continue(),
    );
    await getLink.click();
    await expect(
      page.getByRole("alert").filter({ hasText: "valid link" }),
    ).toContainText("none is shown");
    await expect(page.locator("#referral-link")).toHaveCount(0);

    // The service recovers and the same button now works.
    await page.unroute("**/api/app/referrals/link");
    await getLink.click();
    await expect(page.locator("#referral-link")).toHaveValue(LINK_PATTERN);
  });

  test("opening the link in a separate session carries the customer's code to the demo request", async ({
    page,
    browser,
  }) => {
    const email = await provision(page);
    await page.goto("/app/referrals");
    await dismissCookies(page);
    await signInThroughLoginPage(page, email);
    await page.getByTestId("referral-get-link").click();
    const link = await page.locator("#referral-link").inputValue();
    const code = new URL(link).searchParams.get("ref")!;

    // A different browser: no cookies, no storage, nothing shared with the customer.
    const visitor = await browser.newContext();
    const visitorPage = await visitor.newPage();
    const bodies: { referralCode?: string }[] = [];
    await visitorPage.route("**/api/book-audit", (route) => {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        json: { ok: true, leadSaved: true },
      });
    });
    await visitorPage.goto(link);
    await dismissCookies(visitorPage);
    await expect(visitorPage).toHaveURL(new RegExp(`/referral\\?ref=${code}$`));

    await visitorPage.goto("/book-audit");
    await visitorPage.locator("#audit-field-firstName").fill("Visitor");
    await visitorPage.locator("#audit-field-lastName").fill("Synthetic");
    await visitorPage.getByRole("button", { name: "Continue" }).click();
    await visitorPage.locator("#audit-field-company").fill("Fictional Roofing");
    await visitorPage.getByRole("button", { name: "Continue" }).click();
    await visitorPage.getByRole("radio", { name: /Roofing/ }).click();
    await visitorPage.getByRole("button", { name: "Continue" }).click();
    await visitorPage
      .locator("#audit-field-email")
      .fill("visitor@example.invalid");
    await visitorPage.locator("#audit-field-phone").fill("514-555-0100");
    await visitorPage.getByRole("button", { name: "Continue" }).click();
    await visitorPage.locator("#audit-field-city").fill("Laval");
    await visitorPage.getByRole("button", { name: "Continue" }).click();
    await visitorPage.locator("#audit-field-serviceConsent").check();
    await visitorPage.getByRole("button", { name: "Review answers" }).click();
    await visitorPage.locator('button[type="submit"]').click();
    await expect(
      visitorPage.getByRole("heading", {
        name: "Got it. Your demo request is in.",
      }),
    ).toBeVisible();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].referralCode).toBe(code);
    await visitor.close();
  });

  test("the French referral page also sends a signed-out customer to sign in and back", async ({
    page,
  }) => {
    await page.goto("/fr/app/parrainage");
    await expect(page).toHaveURL(
      /\/fr\/connexion\?next=%2Ffr%2Fapp%2Fparrainage$/,
    );
  });

  test("the public referral page shows the $50 and $75 rewards everywhere, with no unfilled placeholders", async ({
    page,
  }) => {
    await page.goto("/referral");
    await dismissCookies(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Refer a business. Earn $50 with Essential or $75 with Professional.",
    );
    const body = page.locator("main");
    await expect(body).toContainText("$50 for Essential, $75 for Professional");
    await expect(body).not.toContainText(/\{\w+\}/);
    await expect(body).not.toContainText("$65");

    await page.goto("/fr/parrainage");
    await expect(page.locator("main")).not.toContainText(/\{\w+\}/);
    await expect(page.locator("main")).toContainText("50");
    await expect(page.locator("main")).toContainText("75");
  });
});
