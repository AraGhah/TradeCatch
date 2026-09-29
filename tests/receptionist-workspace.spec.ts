import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByRole("link", { name: "Open workspace" }).click();
  await expect(page).toHaveURL(/\/app(?:\/)?$/);
}

test.describe("receptionist workspace pages", () => {
  test("Starter: receptionist settings show the unlinked state and pass axe; email is Growth-only", async ({
    page,
  }) => {
    await signIn(page, "starter");

    await page.goto("/app/receptionist");
    await expect(
      page.getByRole("heading", { name: "AI receptionist settings" }),
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
  });

  test("owner API refuses unauthenticated access", async ({ request }) => {
    expect((await request.get("/api/app/receptionist")).status()).toBe(401);
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
