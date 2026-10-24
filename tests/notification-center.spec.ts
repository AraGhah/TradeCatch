import { expect, test } from "@playwright/test";
import { workspaceSession } from "./support/workspace-session";

for (const locale of ["en", "fr"] as const) {
  test(`notification loading, retry, stale data and failed actions (${locale})`, async ({
    page,
  }) => {
    await workspaceSession(page, locale);
    const fr = locale === "fr";
    let mode: "error" | "success" | "invalid" | "network" = "error";
    let reads = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/businesses/*/notifications?*", async (route) => {
      reads++;
      if (reads === 1) await gate;
      if (mode === "network") return route.abort("failed");
      if (mode === "error")
        return route.fulfill({ status: 503, body: "Unavailable" });
      if (mode === "invalid")
        return route.fulfill({ json: { unexpected: [] } });
      return route.fulfill({
        json: {
          notifications: [
            {
              id: "demo-alert",
              title: "A retained notification",
              message: "Synthetic notification",
              priority: "normal",
              type: "system",
              createdAt: "2026-10-20T12:00:00.000Z",
            },
          ],
        },
      });
    });
    await page.goto(`${fr ? "/fr" : ""}/app/notifications`);
    await expect(page.getByRole("status")).toHaveText(
      fr ? "Chargement des alertes…" : "Loading notifications…",
    );
    const empty = page.getByText(
      fr
        ? "Aucune alerte pour ces filtres."
        : "No notifications match these filters.",
      { exact: true },
    );
    await expect(empty).toHaveCount(0);
    release!();
    const retry = page.getByRole("button", {
      name: fr ? "Réessayer" : "Retry",
      exact: true,
    });
    await expect(retry).toBeVisible();
    await expect(empty).toHaveCount(0);
    mode = "success";
    await retry.click();
    const notification = page.getByText(/· A retained notification/);
    await expect(notification).toBeVisible();
    const refresh = page.getByRole("button", {
      name: fr ? "Actualiser" : "Refresh",
      exact: true,
    });
    for (const failure of ["error", "invalid", "network"] as const) {
      mode = failure;
      await refresh.click();
      await expect(retry).toBeVisible();
      await expect(notification).toBeVisible();
      await expect(
        page.getByText(
          fr ? /précédemment chargées/ : /previously loaded notifications/,
        ),
      ).toBeVisible();
      mode = "success";
      await retry.click();
      await expect(retry).toHaveCount(0);
    }
    await page.route("**/api/businesses/*/notifications/*", (route) =>
      route.fulfill({ status: 403, json: { error: "Forbidden" } }),
    );
    const before = reads;
    for (const name of fr
      ? ["Marquer comme lue", "Prendre en charge", "Tout marquer comme lu"]
      : ["Mark as read", "Acknowledge", "Mark all as read"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(
        page
          .getByRole("alert")
          .filter({
            hasText: fr ? "Impossible d’enregistrer." : "Could not save.",
          }),
      ).toBeVisible();
      expect(reads).toBe(before);
    }
  });

  test(`only the newest notification filter request wins (${locale})`, async ({
    page,
  }) => {
    await workspaceSession(page, locale);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/businesses/*/notifications?*", async (route) => {
      const q = new URL(route.request().url()).searchParams.get("q");
      if (q === "older") await gate;
      await route
        .fulfill({
          json: {
            notifications: q
              ? [
                  {
                    id: q,
                    title: q,
                    message: "Demo",
                    priority: "normal",
                    type: "system",
                    createdAt: "2026-10-20T12:00:00Z",
                  },
                ]
              : [],
          },
        })
        .catch(() => undefined);
    });
    await page.goto(`${locale === "fr" ? "/fr" : ""}/app/notifications`);
    await expect(
      page.getByText(
        locale === "fr"
          ? "Aucune alerte pour ces filtres."
          : "No notifications match these filters.",
        { exact: true },
      ),
    ).toBeVisible();
    const search = page.getByRole("textbox", {
      name: locale === "fr" ? "Chercher" : "Search",
      exact: true,
    });
    await search.fill("older");
    await expect(page.getByRole("status")).toBeVisible();
    await search.fill("newer");
    await expect(page.getByText(/· newer/)).toBeVisible();
    release!();
    await expect(page.getByText(/· older/)).toHaveCount(0);
  });
}
