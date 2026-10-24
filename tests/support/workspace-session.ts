import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

/** Synthetic, isolated organization in the localhost-only E2E harness. */
export async function workspaceSession(page: Page, locale: "en" | "fr" = "en") {
  const email = `workspace-${randomUUID()}@example.invalid`;
  const provision = await page.request.post(
    "/api/missed-call/ops/provision-organization",
    {
      headers: {
        Authorization: "Bearer tradecatch-e2e-ops-secret-not-for-production",
        "X-Ops-Actor": "playwright-workspace",
      },
      data: {
        email,
        organizationName: "Example Plumbing",
        ownerName: "Demo Owner",
        locale,
        plan: "growth",
      },
    },
  );
  expect(provision.status()).toBe(201);
  const login = await page.request.post("/api/auth/magic-link", {
    data: { email, locale },
    headers: {
      "x-forwarded-for": `192.0.2.${10 + (test.info().workerIndex % 200)}`,
    },
  });
  const { devToken } = await login.json();
  expect(devToken).toBeTruthy();
  await page.goto(
    `/api/auth/callback?token=${encodeURIComponent(devToken)}&locale=${locale}`,
  );
  await page
    .getByRole("button", {
      name:
        locale === "fr" ? "Confirmer et me connecter" : "Confirm and sign in",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/app\/?$/);
}
