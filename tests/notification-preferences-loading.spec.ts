import { expect, test } from "@playwright/test";
import { workspaceSession } from "./support/workspace-session";

for (const locale of ["en", "fr"] as const) {
  test(`notification preferences recover from failed loads and saves (${locale})`, async ({
    page,
  }) => {
    await workspaceSession(page, locale);
    const fr = locale === "fr";
    let mode = "blocked";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/notification-preferences", async (route) => {
      if (mode === "blocked") await gate;
      if (mode === "network" || route.request().method() === "PUT")
        return route.abort("failed");
      if (mode === "invalid")
        return route.fulfill({ json: { preferences: {} } });
      if (mode === "success") return route.continue();
      return route.fulfill({ status: 503, body: "Unavailable" });
    });
    await page.goto(`${fr ? "/fr" : ""}/app/settings/notifications`);
    await expect(
      page
        .getByRole("status")
        .filter({
          hasText: fr
            ? "Chargement des préférences"
            : "Loading notification preferences",
        }),
    ).toBeVisible();
    mode = "error";
    release();
    const retry = page
      .getByRole("alert")
      .getByRole("button", { name: fr ? "Réessayer" : "Retry", exact: true });
    await expect(retry).toBeVisible();
    for (const failure of ["network", "invalid"]) {
      mode = failure;
      await retry.click();
      await expect(retry).toBeVisible();
    }
    mode = "success";
    await retry.click();
    const form = page
      .locator("form")
      .filter({ has: page.locator('select option[value="assigned"]') });
    await expect(form).toBeVisible();
    const language = form
      .locator("select")
      .filter({ has: page.locator('option[value="fr"]') });
    await language.selectOption("fr");
    const save = form.getByRole("button", {
      name: fr ? "Enregistrer" : "Save",
      exact: true,
    });
    await save.click();
    await expect(form.getByRole("status")).toContainText(
      fr ? "Impossible" : "Could not",
    );
    await expect(save).toBeEnabled();
    await expect(language).toHaveValue("fr");
  });
}
