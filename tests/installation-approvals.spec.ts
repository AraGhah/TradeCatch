import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { totpCode } from "../src/product/security/totp";
import { workspaceSession } from "./support/workspace-session";

test("ordinary customer owners cannot manage installation approvals", async ({
  page,
}) => {
  await workspaceSession(page);
  expect((await page.request.get("/api/admin/installations")).status()).toBe(
    403,
  );
  expect(
    (
      await page.request.post("/api/admin/installations", {
        data: {
          action: "register",
          label: "Not an admin",
          origin: "https://example.test",
          reason: "Unauthorized test",
        },
      })
    ).status(),
  ).toBe(403);
});

for (const locale of ["en", "fr"] as const) {
  test(`installation approval authorization and safe actions (${locale})`, async ({
    page,
  }, info) => {
    const fr = locale === "fr";
    const endpoint = "/api/admin/installations";
    expect((await page.request.get(endpoint)).status()).toBe(401);
    expect(
      (
        await page.request.post(endpoint, {
          headers: {
            Authorization:
              "Bearer tradecatch-e2e-ops-secret-not-for-production",
            "X-Ops-Actor": "installation-test",
          },
          data: {},
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post("/api/installations/verify", { data: {} })
      ).status(),
    ).toBe(401);
    const verifyHeaders = { Authorization: `Bearer ${"x".repeat(43)}` };
    expect(
      (
        await page.request.post("/api/installations/verify", {
          headers: verifyHeaders,
          data: {
            installationId: crypto.randomUUID(),
            origin: "https://*.example.test",
          },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await page.request.post("/api/installations/verify", {
          headers: verifyHeaders,
          data: {
            installationId: crypto.randomUUID(),
            origin: "https://example.test",
          },
        })
      ).status(),
    ).toBe(503);
    expect(
      (
        await page.request.post("/api/installations/verify", {
          headers: verifyHeaders,
          data: { padding: "x".repeat(2000) },
        })
      ).status(),
    ).toBe(413);
    const email = `installation-admin-${locale}@example.test`;
    const provision = await page.request.post(
      "/api/missed-call/ops/provision-organization",
      {
        headers: {
          Authorization: "Bearer tradecatch-e2e-ops-secret-not-for-production",
          "X-Ops-Actor": "installation-test",
        },
        data: {
          email,
          organizationName: "Synthetic Installation Admin",
          ownerName: "Test Administrator",
          locale,
          plan: "growth",
        },
      },
    );
    expect(provision.status()).toBe(201);
    const login = await page.request.post("/api/auth/magic-link", {
      data: { email, locale },
      headers: { "x-forwarded-for": `192.0.2.${fr ? 218 : 219}` },
    });
    const body = await login.json();
    expect(body.devToken).toBeTruthy();
    await page.goto(
      `/api/auth/callback?token=${encodeURIComponent(body.devToken)}&locale=${locale}`,
    );
    await page
      .getByRole("button", {
        name: fr ? "Confirmer et me connecter" : "Confirm and sign in",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/app\/?$/);
    expect((await page.request.get(endpoint)).status()).toBe(403);
    const me = await (await page.request.get("/api/app/me")).json();
    const mfa = `/api/businesses/${me.organization.id}/security/mfa`;
    const setup = await (await page.request.post(mfa)).json();
    expect(
      (
        await page.request.post(mfa, { data: { code: totpCode(setup.secret) } })
      ).status(),
    ).toBe(200);
    expect((await page.request.get(endpoint)).status()).toBe(401);
    expect((await page.request.post("/api/auth/admin-token")).status()).toBe(
      200,
    );
    expect((await page.request.get(endpoint)).status()).toBe(503); // no DB, not empty success
    const crossSite = await page.request.post(endpoint, {
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
      data: {},
    });
    expect(crossSite.status()).toBe(403);

    const domainId = crypto.randomUUID(),
      installationId = crypto.randomUUID();
    let status = "pending",
      revision = 0,
      failLoad = true,
      failAction = false,
      reads = 0;
    const credential = "t".repeat(43);
    await page.route("**/api/admin/installations", async (route) => {
      if (route.request().method() === "GET") {
        reads++;
        if (failLoad)
          return route.fulfill({ status: 503, json: { error: "unavailable" } });
        return route.fulfill({
          json: {
            ok: true,
            enforcement: "off",
            audit: [],
            domains: [
              {
                id: domainId,
                installationId,
                label: "Fictional installation",
                origin: "https://approved.example.test",
                status,
                revision,
                updatedAt: new Date().toISOString(),
              },
            ],
          },
        });
      }
      if (failAction)
        return route.fulfill({
          status: 409,
          json: { error: "Stale decision" },
        });
      const command = route.request().postDataJSON();
      if (command.action === "decide") {
        status = command.status;
        revision++;
      }
      return route.fulfill({
        json: {
          ok: true,
          domainId,
          installationId,
          ...(command.action === "register" ? { credential } : {}),
        },
      });
    });
    await page.goto(fr ? "/fr/admin/installations" : "/admin/installations");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      fr ? "Approbation des installations" : "Installation approvals",
    );
    await expect(
      page
        .getByRole("alert")
        .filter({
          hasText: fr ? "n’a pas pu être chargé" : "could not be loaded",
        }),
    ).toContainText(fr ? "n’a pas pu être chargé" : "could not be loaded");
    await expect(
      page.getByText(
        fr ? "Aucun domaine enregistré." : "No domains registered.",
        { exact: true },
      ),
    ).toHaveCount(0);
    failLoad = false;
    await page
      .getByRole("button", { name: fr ? "Réessayer" : "Retry", exact: true })
      .click();
    const row = page.locator(`[data-domain-id="${domainId}"]`);
    await expect(row).toContainText("https://approved.example.test");
    await page
      .getByLabel(
        fr ? "Motif / preuve d’inventaire" : "Reason / inventory evidence",
        { exact: true },
      )
      .fill("Verified fictional ownership for test");
    failAction = true;
    const before = reads;
    await row
      .getByRole("button", { name: fr ? "Approuver" : "Approve", exact: true })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: fr ? "Échec" : "Change failed" }),
    ).toContainText(fr ? "Échec" : "Change failed");
    expect(reads).toBe(before);
    await expect(row).toContainText(fr ? "En attente" : "Pending");
    failAction = false;
    await row
      .getByRole("button", { name: fr ? "Approuver" : "Approve", exact: true })
      .click();
    await expect(row).toContainText(fr ? "Approuvé" : "Approved");
    await row
      .getByRole("button", { name: fr ? "Révoquer" : "Revoke", exact: true })
      .click();
    await expect(row).toContainText(fr ? "Révoqué" : "Revoked");
    failLoad = true;
    await page
      .getByRole("button", { name: fr ? "Actualiser" : "Refresh", exact: true })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({
          hasText: fr ? "n’a pas pu être chargé" : "could not be loaded",
        }),
    ).toBeVisible();
    await expect(row).toContainText("https://approved.example.test");
    failLoad = false;
    await page
      .getByRole("button", { name: fr ? "Réessayer" : "Retry", exact: true })
      .click();
    await page
      .getByLabel(fr ? "Nom de l’installation" : "Installation name", {
        exact: true,
      })
      .fill("New fixture");
    await page
      .getByLabel(fr ? "Origine exacte" : "Exact origin", { exact: true })
      .fill("https://new.example.test");
    await page
      .getByRole("button", {
        name: fr
          ? "Enregistrer un domaine en attente"
          : "Register pending domain",
        exact: true,
      })
      .click();
    await expect(page.getByText(credential, { exact: true })).toBeVisible();
    await page
      .getByRole("button", {
        name: fr ? "Effacer le secret" : "Clear credential",
        exact: true,
      })
      .click();
    await expect(page.getByText(credential, { exact: true })).toHaveCount(0);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`installations-${locale}.png`),
      fullPage: true,
    });
  });
}
