import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

/** Synthetic, isolated organization in the localhost-only E2E harness. */
export async function workspaceSession(page: Page, locale: "en" | "fr" = "en") {
  const email = `workspace-${randomUUID()}@example.invalid`;
  // Independent documentation-range identity per session, not per worker:
  // repeated logins in a large suite must not exhaust one worker's quota.
  const clientIp = `2001:db8:${randomUUID().replaceAll("-", "").match(/.{4}/g)!.slice(0, 6).join(":")}`;
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
      "x-forwarded-for": clientIp,
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
