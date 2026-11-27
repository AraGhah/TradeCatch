import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { PlanId } from "../../src/product/saas/entitlements";

/**
 * Synthetic, isolated organization in the localhost-only E2E harness. Any plan
 * id can be provisioned; `growth` stays the default so existing specs are
 * unaffected.
 */
export async function workspaceSession(
  page: Page,
  locale: "en" | "fr" = "en",
  plan: PlanId = "growth",
) {
  const email = `workspace-${randomUUID()}@example.invalid`;
  // Independent documentation-range identity per session, not per worker:
  // repeated logins in a large suite must not exhaust one worker's quota.
  const clientIp = `2001:db8:${randomUUID().replaceAll("-", "").match(/.{4}/g)!.slice(0, 6).join(":")}`;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": clientIp });
  const provision = await page.request.post(
    "/api/missed-call/ops/provision-organization",
    {
      headers: {
        Authorization: "Bearer tradecatch-e2e-ops-secret-not-for-production",
        "X-Ops-Actor": "playwright-workspace",
        "x-forwarded-for": clientIp,
      },
      data: {
        email,
        organizationName: "Example Plumbing",
        ownerName: "Demo Owner",
        locale,
        plan,
      },
    },
  );
  expect(provision.status()).toBe(201);
  await signInAs(page, email, clientIp, locale);
  return { email, clientIp };
}

/** Signs in again as an existing workspace user (a fresh session). */
export async function signInAs(
  page: Page,
  email: string,
  clientIp: string,
  locale: "en" | "fr" = "en",
) {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": clientIp });
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
