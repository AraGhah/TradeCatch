import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { readExportZip } from "./support/read-export-zip";

/**
 * Workspace pages added for the AI receptionist. The E2E harness has no linked
 * phone client, so these check the honest "not linked yet" state, the plan
 * gating, and accessibility — the linked flow is covered by unit tests
 * (profile service) and was exercised manually against a dev server.
 */

const OPS = {
  Authorization: "Bearer tradecatch-e2e-ops-secret-not-for-production",
  "X-Ops-Actor": "playwright-founder-gate",
};

async function signIn(page: Page, plan: "starter" | "growth") {
  // The localhost-only harness trusts these synthetic documentation addresses.
  // Each retry worker gets its own client quota; production limits stay intact.
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `198.51.100.${20 + (test.info().workerIndex % 200)}`,
  });
  const email = `ws-${plan}-${Date.now()}-${test.info().workerIndex}@example.test`;
  const provision = await page.request.post(
    "/api/missed-call/ops/provision-organization",
    {
      headers: OPS,
      data: {
        email,
        organizationName: `Workspace ${plan}`,
        ownerName: "Workspace Owner",
        locale: "en",
        plan,
      },
    },
  );
  expect(provision.status()).toBe(201);

  await page.goto("/login");
  await page
    .waitForFunction(
      () => Boolean(document.querySelector('div[style*="transform"]')),
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => undefined);
  await page.getByLabel("Work email").fill(email);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/auth/magic-link") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  expect((await response).status()).toBe(200);
  await page.getByRole("link", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(page).toHaveURL(/\/app(?:\/)?$/);
}

test.describe("receptionist workspace pages", () => {
  test("Starter: receptionist settings show the unlinked state and pass axe; email is Growth-only", async ({
    page,
  }) => {
    await signIn(page, "starter");

    await page.goto("/app/receptionist");
    await expect(
      page.getByRole("heading", {
        name: "Receptionist",
        level: 1,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(/phone client is not linked yet/i),
    ).toBeVisible();
    // No form is offered until a phone client is linked.
    await expect(
      page.getByRole("button", { name: "Save settings" }),
    ).toHaveCount(0);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map(
        (v) =>
          `${v.id}: ${v.help} ${JSON.stringify(v.nodes.map((n) => n.target))}`,
      ),
    ).toEqual([]);

    await page.goto("/app/settings/account");
    const me = await (await page.request.get("/api/app/me")).json();
    const orgId = me.organization.id;
    expect(
      (
        await page.request.get(
          "/api/businesses/another-business/account/export",
        )
      ).status(),
    ).toBe(403);
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export data", exact: true })
      .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^tradecatch-account-export-.*\.zip$/,
    );
    const path = await download.path();
    expect(path).toBeTruthy();
    const archive = readExportZip(await readFile(path!));
    expect(JSON.parse(archive["manifest.json"]).organizationId).toBe(orgId);
    expect(archive["README.txt"]).toContain("Excluded:");
    expect(archive["customers.csv"]).toBeTruthy();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Your account archive has downloaded" }),
    ).toBeVisible();
    await page.route(`**/api/businesses/${orgId}/account/export`, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "test failure" }),
      }),
    );
    await page
      .getByRole("button", { name: "Export data", exact: true })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Could not download your account archive" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Export data", exact: true }),
    ).toBeEnabled();
    await page.unroute(`**/api/businesses/${orgId}/account/export`);

    await page.goto("/app/email");
    await expect(
      page.getByText("Email automation is available on the Growth plan."),
    ).toBeVisible();
  });

  test("Growth: email automation page offers the auto-enroll setting (off by default) and passes axe", async ({
    page,
  }) => {
    await signIn(page, "growth");

    await page.goto("/app/email");
    await expect(
      page.getByRole("heading", { name: "Email follow-up automation" }),
    ).toBeVisible();
    const select = page.getByLabel("Sequence for new website leads");
    await expect(select).toBeVisible();
    await expect(select).toHaveValue("");
    await expect(
      page.getByText(/only if they gave an email address and consent/i),
    ).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map(
        (v) =>
          `${v.id}: ${v.help} ${JSON.stringify(v.nodes.map((n) => n.target))}`,
      ),
    ).toEqual([]);

    await page.goto("/billing");
    await expect(
      page.getByRole("heading", { name: "Billing", exact: true }),
    ).toBeVisible();
    const billingAccessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(billingAccessibility.violations.map((row) => row.id)).toEqual([]);
    await page.goto("/app/settings/account");
    const billing = page.getByRole("button", {
      name: "Open billing",
      exact: true,
    });
    await expect(billing).toBeVisible();
    await page.route("**/api/billing/portal", (route) =>
      route.fulfill({ status: 409, json: { code: "not_linked" } }),
    );
    await billing.click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "not linked to Stripe billing" }),
    ).toBeVisible();
    await expect(billing).toBeEnabled();
    await page.unroute("**/api/billing/portal");
    await page.route("**/api/billing/portal", (route) =>
      route.fulfill({ status: 503, json: { code: "unavailable" } }),
    );
    await billing.click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Billing could not be opened" }),
    ).toBeVisible();
    await expect(billing).toBeEnabled();
    await page.unroute("**/api/billing/portal");
    await page.route("https://billing.stripe.com/p/session/test_e2e", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<h1>Stripe test portal</h1>",
      }),
    );
    await page.route("**/api/billing/portal", (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({ locale: "en" });
      return route.fulfill({
        status: 200,
        json: { url: "https://billing.stripe.com/p/session/test_e2e" },
      });
    });
    await billing.click();
    await expect(page).toHaveURL(
      "https://billing.stripe.com/p/session/test_e2e",
    );
    await expect(
      page.getByRole("heading", { name: "Stripe test portal" }),
    ).toBeVisible();
  });

  test("owner API refuses unauthenticated access", async ({ request }) => {
    expect((await request.get("/api/app/receptionist")).status()).toBe(401);
    expect(
      (
        await request.post("/api/billing/portal", { data: { locale: "en" } })
      ).status(),
    ).toBe(401);
    expect((await request.get("/api/billing/portal")).status()).toBe(405);
    expect(
      (await request.put("/api/app/receptionist", { data: {} })).status(),
    ).toBe(401);
    // Ops route needs the bearer.
    expect(
      (
        await request.post("/api/receptionist/ops/profile", {
          data: {
            organizationId: "x",
            phoneNumberE164: "+14385597100",
            activated: true,
          },
        })
      ).status(),
    ).toBe(401);
  });
});
