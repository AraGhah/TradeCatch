import { expect, test, type Page } from "@playwright/test";

async function reviewRequest(page: Page) {
  await page.goto("/book-audit");
  const reject = page.getByRole("button", { name: "Reject non-essential" });
  // Every test starts in a fresh browser context. Wait for the hydrated
  // consent banner before typing; otherwise hydration can replace early input.
  await expect(reject).toBeVisible();
  await reject.click();
  await page.locator("#audit-field-firstName").fill("TC002");
  await page.locator("#audit-field-lastName").fill("Synthetic");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("#audit-field-company").fill("Fictional Staging Plumbing");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: /Plumbing/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("#audit-field-email").fill("tc002@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("#audit-field-phone").fill("514-555-0100");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("#audit-field-city").fill("Laval");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("#audit-field-serviceConsent").check();
  await page.getByRole("button", { name: "Review answers" }).click();
}

test("confirmation acknowledges storage while notifications are pending", async ({
  page,
}) => {
  await page.route("**/api/book-audit", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ok: true,
        leadSaved: true,
        notificationsDelivered: false,
        notificationsStatus: "pending",
      },
    }),
  );
  await reviewRequest(page);
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(
    page.getByRole("heading", { name: "Got it. Your audit request is in." }),
  ).toBeVisible();
  await expect(page.getByText(/Your request is safely saved/)).toBeVisible();
  await expect(
    page.getByText(/Email confirmation may arrive later/),
  ).toBeVisible();
});

for (const body of [{ ok: true }, { ok: true, leadSaved: false }]) {
  test(`does not confirm a response without saved-lead evidence: ${JSON.stringify(body)}`, async ({
    page,
  }) => {
    await page.route("**/api/book-audit", (route) =>
      route.fulfill({ status: 200, json: body }),
    );
    await reviewRequest(page);
    await page.getByRole("button", { name: "Submit request" }).click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "We couldn't submit your audit request" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Got it. Your audit request is in." }),
    ).not.toBeVisible();
  });
}
