import { expect, test } from "@playwright/test";
import { workspaceSession } from "./support/workspace-session";

for (const locale of ["en", "fr"] as const) {
  test(`account changes confirm requests, preserve service and show durable status (${locale})`, async ({
    page,
  }) => {
    await workspaceSession(page, locale);
    const fr = locale === "fr";
    await page.goto(`${fr ? "/fr" : ""}/app/settings/account`);
    const suspend = page.getByRole("button", {
      name: fr ? "Demander une suspension" : "Request Suspension",
      exact: true,
    });
    const reactivate = page.getByRole("button", {
      name: fr ? "Demander une réactivation" : "Request Reactivation",
      exact: true,
    });
    const history = page.getByRole("region", {
      name: fr
        ? "Demandes de modification du compte"
        : "Account change requests",
    });
    await expect(history).toContainText(
      fr ? "Aucune demande récente" : "No recent account change requests",
    );
    let writes = 0;
    page.on("request", (r) => {
      if (r.url().includes("/account/lifecycle") && r.method() === "POST")
        writes++;
    });
    page.once("dialog", (dialog) => dialog.dismiss());
    await suspend.click();
    expect(writes).toBe(0);
    for (const button of [suspend, reactivate]) {
      page.once("dialog", async (dialog) => {
        expect(dialog.message()).toContain(
          fr
            ? "ne change pas immédiatement"
            : "does not change service status immediately",
        );
        await dialog.accept();
      });
      const response = page.waitForResponse(
        (r) =>
          r.url().includes("/account/lifecycle") &&
          r.request().method() === "POST",
      );
      await button.click();
      const result = await response;
      expect(result.ok()).toBe(true);
      const payload = await result.json();
      expect(payload.phoneDisconnected).toBe(false);
      expect(payload.request).toMatchObject({
        status: "requested",
        phoneRouting: "unchanged_until_transition",
      });
      await expect(history).toContainText(payload.request.id);
      await expect(history).toContainText(
        fr ? "En attente d’examen" : "Awaiting review",
      );
      await expect(history).toContainText(
        fr ? "Date d’effet : non planifiée" : "Effective date: not scheduled",
      );
    }
    await page.reload();
    await expect(history.getByRole("listitem")).toHaveCount(2);
    await expect(suspend).toBeEnabled();
    await page.route("**/account/lifecycle", (route) =>
      route.fulfill({ status: 503, body: "Unavailable" }),
    );
    page.once("dialog", (dialog) => dialog.accept());
    await suspend.click();
    await expect(
      page
        .getByRole("alert")
        .filter({
          hasText: fr ? "Impossible de confirmer" : "Could not confirm",
        }),
    ).toBeVisible();
    await expect(history.getByRole("listitem")).toHaveCount(2);
    await expect(suspend).toBeEnabled();
    await page.unroute("**/account/lifecycle");
    await page.route("**/account/lifecycle", (route) => route.abort("failed"));
    page.once("dialog", (dialog) => dialog.accept());
    await reactivate.click();
    await expect(
      page
        .getByRole("alert")
        .filter({
          hasText: fr ? "Impossible de confirmer" : "Could not confirm",
        }),
    ).toBeVisible();
    expect(
      (
        await page.request.post(
          "/api/businesses/unrelated-org/account/lifecycle",
          { data: { kind: "suspension" } },
        )
      ).status(),
    ).toBe(403);
  });
}
