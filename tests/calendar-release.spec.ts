import { expect, test } from "@playwright/test";
import { workspaceSession } from "./support/workspace-session";

for (const locale of ["en", "fr"] as const) {
  test(`unenrolled businesses cannot connect or select Google calendars (${locale})`, async ({
    page,
  }) => {
    await workspaceSession(page, locale);
    const loaded = page.waitForResponse((r) =>
      r.url().includes("/calendar/status"),
    );
    await page.goto(`${locale === "fr" ? "/fr" : ""}/app/settings/calendar`);
    const response = await loaded;
    expect(response.ok()).toBe(true);
    expect((await response.json()).availability).toMatchObject({
      googlePilot: false,
      outlook: "planned",
    });
    await expect(page.getByTestId("calendar-availability")).toContainText(
      locale === "fr" ? "pilote technique" : "technical pilot",
    );
    await expect(
      page.getByRole("button", { name: /Connect Google|Connecter Google/ }),
    ).toHaveCount(0);
    const base = response.url().replace(/\/status$/, "");
    for (const [path, method] of [
      ["connect", "post"],
      ["calendars", "get"],
      ["calendars", "post"],
    ] as const) {
      const denied = await page.request[method](`${base}/${path}`, {
        data: { calendarId: "primary", summary: "Test" },
      });
      expect(denied.status()).toBe(403);
      expect((await denied.json()).code).toBe("calendar_pilot_required");
    }
    await page.goto(`${locale === "fr" ? "/fr" : ""}/help/calendar`);
    await expect(page.getByRole("article")).toContainText(
      locale === "fr" ? "inscription distincte" : "separately enrolled",
    );
    await expect(page.getByRole("article")).toContainText("Outlook");
  });
}
