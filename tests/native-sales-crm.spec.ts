import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { totpCode } from "../src/product/security/totp";

test("platform sales dashboard requires MFA and an admin token, renders safely, and recovers from errors", async ({
  page,
}, testInfo) => {
  const email = "sales-admin@example.test";
  const provision = await page.request.post(
    "/api/missed-call/ops/provision-organization",
    {
      headers: {
        Authorization: "Bearer tradecatch-e2e-ops-secret-not-for-production",
        "X-Ops-Actor": "sales-dashboard-test",
      },
      data: {
        email,
        organizationName: "Sales Admin Fixture",
        ownerName: "Sales Administrator",
        locale: "en",
        plan: "growth",
      },
    },
  );
  expect(provision.status()).toBe(201);
  const login = await page.request.post("/api/auth/magic-link", {
    data: { email, locale: "en" },
  });
  const { devToken } = await login.json();
  expect(devToken).toBeTruthy();
  await page.goto(
    `/api/auth/callback?token=${encodeURIComponent(devToken)}&locale=en`,
  );
  await page
    .getByRole("button", { name: "Confirm and sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/?$/);
  expect((await page.request.get("/api/admin/sales-leads")).status()).toBe(403);
  const me = await (await page.request.get("/api/app/me")).json();
  const endpoint = `/api/businesses/${me.organization.id}/security/mfa`;
  const setup = await page.request.post(endpoint);
  expect(setup.status()).toBe(200);
  const { secret } = await setup.json();
  const verified = await page.request.post(endpoint, {
    data: { code: totpCode(secret) },
  });
  expect(verified.status()).toBe(200);
  expect((await page.request.get("/api/admin/sales-leads")).status()).toBe(401);
  expect((await page.request.post("/api/auth/admin-token")).status()).toBe(200);
  // Fully authenticated access reaches the real storage guard, with no database
  // in the browser harness. PostgreSQL records are verified by integration tests.
  expect((await page.request.get("/api/admin/sales-leads")).status()).toBe(503);

  let fails = false;
  await page.route("**/api/admin/sales-leads*", (route) => {
    if (fails)
      return route.fulfill({ status: 503, json: { error: "unavailable" } });
    const current = Number(
      new URL(route.request().url()).searchParams.get("page"),
    );
    return route.fulfill({
      json: {
        ok: true,
        page: current,
        hasMore: current === 1,
        leads:
          current === 1
            ? [
                {
                  id: "bal_sales_fixture",
                  company: "Synthetic Sales Company",
                  firstName: "Alex",
                  lastName: "Martin",
                  email: "alex@example.invalid",
                  phone: "+15145550101",
                  city: "Laval",
                  trade: "Plumbing",
                  language: "fr",
                  mainProblem: '<img src=x onerror="alert(1)">',
                  stage: "new",
                  createdAt: "2026-10-23T15:00:00.000Z",
                },
              ]
            : [],
      },
    });
  });
  await page.goto("/admin/sales");
  await expect(
    page.getByRole("heading", { name: "TradeCatch sales leads", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: /Synthetic Sales Company/ }),
  ).toBeVisible();
  await expect(
    page.getByText('<img src=x onerror="alert(1)">', { exact: false }),
  ).toBeVisible();
  await expect(page.locator("table img")).toHaveCount(0);
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByText("No sales leads yet.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();
  fails = true;
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Sales leads could not be loaded." }),
  ).toContainText("Sales leads could not be loaded.");
  fails = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByText("alex@example.invalid", { exact: true }),
  ).toBeVisible();
  await page.goto("/fr/admin/sales");
  await expect(
    page.getByRole("heading", { name: "Prospects de TradeCatch", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("alex@example.invalid", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("native-sales-crm.png"),
    fullPage: true,
  });
});
