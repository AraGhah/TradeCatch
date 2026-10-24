import { expect, test } from "@playwright/test";
import { workspaceSession } from "./support/workspace-session";

for (const locale of ["en", "fr"] as const) {
  test(`inbox actions handle HTTP and network failures without refreshing (${locale})`, async ({
    page,
  }) => {
    await workspaceSession(page, locale);
    const key = await page.request.post("/api/app/api-keys", { data: {} });
    expect(key.ok()).toBe(true);
    const { token } = await key.json();
    const lead = await page.request.post("/api/website-leads", {
      headers: { "x-tradecatch-key": token },
      data: {
        name: "Inbox test customer",
        message: "Please call back",
        sendOpeningSms: false,
      },
    });
    expect(lead.ok()).toBe(true);
    await page.goto(`${locale === "fr" ? "/fr" : ""}/app/inbox`);
    const item = page
      .getByRole("listitem")
      .filter({ hasText: "Inbox test customer" });
    await expect(item).toBeVisible();
    let refreshes = 0;
    const pathname = new URL(page.url()).pathname;
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === pathname &&
        request.headers()["rsc"] === "1" &&
        !request.headers()["next-router-prefetch"]
      )
        refreshes++;
    });
    let fail = true;
    await page.route("**/api/app/inbox", (route) =>
      fail
        ? route.fulfill({ status: 503, body: "Service unavailable" })
        : route.continue(),
    );
    const actions =
      locale === "fr"
        ? [
            ["Prendre", "prendre"],
            ["Reprendre", "reprendre"],
            ["Résoudre", "résoudre"],
          ]
        : [
            ["Claim", "claim"],
            ["Take over", "take over"],
            ["Resolve", "resolve"],
          ];
    for (const [button, verb] of actions) {
      await item.getByRole("button", { name: button, exact: true }).click();
      await expect(item.getByRole("alert")).toContainText(verb);
      await expect(
        item.getByRole("button", { name: button, exact: true }),
      ).toBeEnabled();
    }
    expect(refreshes).toBe(0);
    await page.unroute("**/api/app/inbox");
    await page.route("**/api/app/inbox", (route) => route.abort("failed"));
    await item
      .getByRole("button", { name: actions[0][0], exact: true })
      .click();
    await expect(item.getByRole("alert")).toContainText(actions[0][1]);
    expect(refreshes).toBe(0);
    await page.unroute("**/api/app/inbox");
    fail = false;
    await item
      .getByRole("button", { name: actions[2][0], exact: true })
      .click();
    await expect(item.getByRole("button")).toHaveCount(0);
    expect(refreshes).toBeGreaterThan(0);
  });
}
