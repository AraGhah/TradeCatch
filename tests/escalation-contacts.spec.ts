import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function signIn(page: Page, locale: "en" | "fr") {
  const email = `escalation-${locale}-${randomUUID()}@example.invalid`;
  const provision = await page.request.post(
    "/api/missed-call/ops/provision-organization",
    {
      headers: {
        Authorization: "Bearer tradecatch-e2e-ops-secret-not-for-production",
        "X-Ops-Actor": "playwright-contacts",
      },
      data: {
        email,
        organizationName: "Escalation contact test",
        ownerName: "Alice Martin",
        locale,
        plan: "growth",
      },
    },
  );
  expect(provision.status()).toBe(201);
  const login = await page.request.post("/api/auth/magic-link", {
    data: { email, locale },
    headers: {
      "x-forwarded-for": `203.0.113.${180 + (test.info().workerIndex % 40)}`,
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
        locale === "en" ? "Confirm and sign in" : "Confirmer et me connecter",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/app\/?$/);
}

for (const locale of ["en", "fr"] as const) {
  test(`quiet-hours switch and minute values persist with server validation (${locale})`, async ({
    page,
  }) => {
    await signIn(page, locale);
    const isFr = locale === "fr";
    await page.goto(`${isFr ? "/fr" : ""}/app/settings/notifications`);
    const toggle = page.getByRole("switch", {
      name: isFr ? "Heures calmes" : "Quiet hours",
      exact: true,
    });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await page
      .getByLabel(isFr ? "Début des heures calmes" : "Quiet hours start", {
        exact: true,
      })
      .fill("20:17");
    await page
      .getByLabel(isFr ? "Fin des heures calmes" : "Quiet hours end", {
        exact: true,
      })
      .fill("08:37");
    const saved = page.waitForResponse(
      (r) =>
        r.url().includes("/notification-preferences") &&
        r.request().method() === "PUT",
    );
    await page
      .getByRole("button", { name: isFr ? "Enregistrer" : "Save", exact: true })
      .click();
    const response = await saved;
    expect(response.status()).toBe(200);
    const { preferences } = await response.json();
    expect(preferences).toMatchObject({
      quietEnabled: false,
      quietStart: "20:17",
      quietEnd: "08:37",
    });
    await page.reload();
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page
      .getByLabel(isFr ? "Fin des heures calmes" : "Quiet hours end", {
        exact: true,
      })
      .fill("20:17");
    await page
      .getByRole("button", { name: isFr ? "Enregistrer" : "Save", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      isFr ? "différents" : "different start and end",
    );
    const endpoint = `/api/businesses/${preferences.organizationId}/notification-preferences`;
    for (const quietStart of ["24:00", "12:60", "", "08:37"]) {
      expect(
        (
          await page.request.put(endpoint, {
            data: { ...preferences, quietEnabled: true, quietStart },
          })
        ).status(),
      ).toBe(400);
    }
    expect(
      (
        await page.request.put(
          "/api/businesses/another-org/notification-preferences",
          { data: preferences },
        )
      ).status(),
    ).toBe(403);
  });
  test(`employee dropdowns save IDs and recover from errors (${locale})`, async ({
    page,
  }) => {
    await signIn(page, locale);
    const isFr = locale === "fr";
    let rule = {
      enabled: true,
      primaryUserId: "employee-alice",
      secondaryUserId: undefined as string | undefined,
      emailEnabled: true,
      smsEnabled: true,
      acknowledgementRequired: true,
      delayMinutes: 15,
      maxAttempts: 2,
      afterHours: true,
    };
    let saveFails = false,
      loadFails = false;
    const bodies: (typeof rule)[] = [];
    await page.route("**/api/businesses/*/escalation-rules", async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        bodies.push(body);
        if (saveFails)
          return route.fulfill({
            status: 400,
            json: { error: "Choose different employees", code: "sameContact" },
          });
        rule = body;
        return route.fulfill({ json: { ok: true, rule } });
      }
      if (loadFails)
        return route.fulfill({ status: 503, json: { error: "unavailable" } });
      return route.fulfill({
        json: {
          ok: true,
          rule,
          contacts: [
            {
              userId: "employee-alice",
              name: "Alice Martin",
              role: "owner",
              verifiedPhoneE164: "+15145550101",
            },
            { userId: "employee-benoit", name: "Benoît Roy", role: "member" },
          ],
        },
      });
    });
    const url = `${isFr ? "/fr" : ""}/app/notifications/escalation`;
    await page.goto(url);
    const primary = page.getByRole("combobox", {
      name: isFr ? "Destinataire principal" : "Primary recipient",
    });
    const backup = page.getByRole("combobox", {
      name: isFr ? "Destinataire de secours" : "Backup recipient",
    });
    await expect(primary).toHaveValue("employee-alice");
    await expect(
      primary.locator("option").filter({ hasText: "Alice Martin" }),
    ).toHaveText(
      new RegExp(
        `Alice Martin.*${isFr ? "Propriétaire" : "Owner"}.*\\+15145550101.*${isFr ? "Téléphone vérifié" : "Verified phone"}`,
      ),
    );
    await expect(
      backup.locator("option").filter({ hasText: "Benoît Roy" }),
    ).toContainText(isFr ? "Aucun téléphone vérifié" : "No verified phone");
    await expect(page.locator('input[type="text"]')).toHaveCount(0);
    await backup.selectOption("employee-benoit");
    await page
      .getByRole("button", { name: isFr ? "Enregistrer" : "Save", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText(
      isFr ? "Enregistré." : "Saved.",
    );
    expect(bodies[0]).toMatchObject({
      primaryUserId: "employee-alice",
      secondaryUserId: "employee-benoit",
    });
    await page.reload();
    await expect(backup).toHaveValue("employee-benoit");
    saveFails = true;
    await page
      .getByRole("button", { name: isFr ? "Enregistrer" : "Save", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      isFr ? "employés différents" : "different primary and backup",
    );
    loadFails = true;
    await page.reload();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: isFr ? "Impossible de charger" : "Could not load" }),
    ).toContainText(isFr ? "Impossible de charger" : "Could not load");
    loadFails = false;
    await page
      .getByRole("button", {
        name: isFr ? "Actualiser" : "Refresh",
        exact: true,
      })
      .click();
    await expect(backup).toHaveValue("employee-benoit");
  });
}
