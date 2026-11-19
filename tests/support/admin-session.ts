import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { totpCode } from "../../src/product/security/totp";

export const OPS_SECRET = "tradecatch-e2e-ops-secret-not-for-production";

/**
 * Administrator identities the e2e server knows (TRADECATCH_ADMIN_EMAILS in
 * playwright.config.ts). Roles are assigned there, never by a request.
 */
export const ADMINS = {
  super: (id: string) => `adm-${id}@example.test`,
  support: "adm-support@example.test",
  readOnly: "adm-readonly@example.test",
} as const;

/** An independent documentation-range client address, so rate-limit budgets never collide. */
export function freshIp(): string {
  return `2001:db8:${randomUUID().replaceAll("-", "").match(/.{4}/g)!.slice(0, 6).join(":")}`;
}

export const opsHeaders = (actor = "playwright-admin-console") => ({
  Authorization: `Bearer ${OPS_SECRET}`,
  "X-Ops-Actor": actor,
});

export function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

/** Creates the organization (and owner) for `email` through the ops route. */
export async function provisionOrganization(
  request: APIRequestContext,
  input: { email: string; organizationName: string; ownerName?: string; locale?: "en" | "fr"; plan?: string },
) {
  const response = await request.post("/api/missed-call/ops/provision-organization", {
    headers: opsHeaders(),
    data: {
      email: input.email,
      organizationName: input.organizationName,
      ownerName: input.ownerName ?? "Console Test Owner",
      locale: input.locale ?? "en",
      plan: input.plan ?? "growth",
    },
  });
  expect(response.status()).toBe(201);
}

/** Magic-link sign-in for an account that already exists. Leaves the page on its landing URL. */
export async function signInWithMagicLink(
  page: Page,
  email: string,
  locale: "en" | "fr" = "en",
  expectedUrl: RegExp = /\/(fr\/)?(app|admin)\/?$/,
) {
  const login = await page.request.post("/api/auth/magic-link", {
    data: { email, locale },
    headers: { "x-forwarded-for": freshIp() },
  });
  const { devToken } = await login.json();
  expect(devToken, "dev login token").toBeTruthy();
  await page.goto(`/api/auth/callback?token=${encodeURIComponent(devToken)}&locale=${locale}`);
  await page
    .getByRole("button", {
      name: locale === "fr" ? "Confirmer et me connecter" : "Confirm and sign in",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(expectedUrl);
}

export type AdminHandle = {
  email: string;
  organizationId: string;
  mfaSecret: string;
  /** A second, fresh sign-in as the same administrator (new session, MFA again). */
  signInAgain: (target?: Page) => Promise<void>;
};

/**
 * A real administrator session: a platform-admin identity, a verified second
 * factor and the short-lived admin token, exactly as an operator gets them.
 * Every request this page makes carries its own client address.
 */
export async function adminSession(
  page: Page,
  email: string,
  locale: "en" | "fr" = "en",
): Promise<AdminHandle> {
  const ip = freshIp();
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": ip });
  await provisionOrganization(page.request, {
    email,
    organizationName: `Admin Test ${uniqueSuffix()}`,
    ownerName: "Test Administrator",
    locale,
  });
  await signInWithMagicLink(page, email, locale, /\/(fr\/)?admin\/?$/);
  const me = await (await page.request.get("/api/app/me")).json();
  const organizationId: string = me.organization.id;
  const mfa = `/api/businesses/${organizationId}/security/mfa`;
  const setup = await (await page.request.post(mfa)).json();
  const mfaSecret: string = setup.secret;
  expect((await page.request.post(mfa, { data: { code: totpCode(mfaSecret) } })).status()).toBe(200);
  expect((await page.request.post("/api/auth/admin-token")).status()).toBe(200);

  const signInAgain = async (target: Page = page) => {
    // Leave the old console first. Once signed out it sends its own tab to the sign-in page
    // (correctly), and that redirect can abort the navigation below if the two overlap.
    await target.goto("about:blank");
    await target.context().setExtraHTTPHeaders({ "x-forwarded-for": freshIp() });
    await signInWithMagicLink(target, email, locale, /\/(fr\/)?admin\/?$/);
    const again = await (await target.request.get("/api/app/me")).json();
    // The code used at enrollment is already spent (a code cannot be replayed), so use the
    // next 30-second step, which the server also accepts.
    const verify = await target.request.post(`/api/businesses/${again.organization.id}/security/mfa`, {
      data: { code: totpCode(mfaSecret, Date.now() + 30_000) },
    });
    expect(verify.status()).toBe(200);
    expect((await target.request.post("/api/auth/admin-token")).status()).toBe(200);
  };
  return { email, organizationId, mfaSecret, signInAgain };
}

/** Everything the console serves, so denial can be asserted across the whole surface. */
export const CONSOLE_READ_ENDPOINTS = [
  "/api/admin/me",
  "/api/admin/overview",
  "/api/admin/businesses",
  "/api/admin/subscriptions",
  "/api/admin/payments",
  "/api/admin/website-requests",
  "/api/admin/audit-logs",
  "/api/admin/health",
] as const;
