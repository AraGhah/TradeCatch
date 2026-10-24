import { expect, test } from "@playwright/test";
import { HELP_ARTICLES } from "../src/product/support/help";
import { workspaceSession } from "./support/workspace-session";

for (const locale of ["en", "fr"] as const) {
  test(`all help articles have localized instructions, screenshots, results and troubleshooting (${locale})`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    const prefix = locale === "fr" ? "/fr" : "";
    for (const article of HELP_ARTICLES) {
      await page.goto(`${prefix}/help/${article.id}`);
      const content = page.getByRole("article");
      await expect(content.getByRole("heading", { level: 1 })).toHaveText(
        article.title[locale],
      );
      await expect(content.locator("ol > li")).toHaveCount(
        article.id === "phone" ||
          article.id === "calendar" ||
          article.id === "account"
          ? 5
          : 4,
      );
      await expect(
        content.getByRole("heading", {
          name: locale === "fr" ? "Résultat attendu" : "Expected result",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        content.getByRole("heading", {
          name: locale === "fr" ? "Dépannage" : "Troubleshooting",
          exact: true,
        }),
      ).toBeVisible();
      await expect(content.getByRole("img")).toHaveAttribute(
        "src",
        `/help/${article.id}-${locale}.png`,
      );
      await expect
        .poll(() =>
          content
            .getByRole("img")
            .evaluate(
              (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
            ),
        )
        .toBe(true);
    }
    await workspaceSession(page, locale);
    await page.goto(`${prefix}/app/help/account`);
    await expect(
      page.getByRole("article").getByRole("heading", {
        name: locale === "fr" ? "Résultat attendu" : "Expected result",
        exact: true,
      }),
    ).toBeVisible();
  });

  test(`capture help screenshots (${locale})`, async ({ page }) => {
    test.skip(
      process.env.UPDATE_HELP_SCREENSHOTS !== "1",
      "Explicit opt-in to regenerate reviewed synthetic screenshots",
    );
    test.setTimeout(120000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await workspaceSession(page, locale);
    await page
      .getByRole("button", {
        name:
          locale === "fr"
            ? "Refuser les non essentiels"
            : "Reject non-essential",
        exact: true,
      })
      .click();
    const prefix = locale === "fr" ? "/fr" : "";
    const pages: Record<string, string> = {
      "getting-started": "/app/settings/account",
      receptionist: "/app/test-center",
      phone: "/app/calls/settings",
      transfers: "/app/calls/settings",
      calendar: "/app/settings/calendar",
      leads: "/app/leads",
      automations: "/app/automations",
      sms: "/app/automations/history",
      billing: "/billing",
      account: "/app/settings/account",
      troubleshooting: "/app/support/diagnostics",
    };
    for (const [id, path] of Object.entries(pages)) {
      await page.goto(`${prefix}${path}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // Wait for client-rendered settings and fonts, never access production data.
      await page.evaluate(() => document.fonts.ready);
      if (id === "calendar")
        await expect(
          page.getByRole("button", {
            name:
              locale === "fr"
                ? "Connecter Google Calendar"
                : "Connect Google Calendar",
            exact: true,
          }),
        ).toBeVisible();
      if (id === "account") {
        page.once("dialog", (dialog) => dialog.accept());
        await page
          .getByRole("button", {
            name:
              locale === "fr"
                ? "Demander une suspension"
                : "Request Suspension",
            exact: true,
          })
          .click();
        const history = page.getByRole("region", {
          name:
            locale === "fr"
              ? "Demandes de modification du compte"
              : "Account change requests",
        });
        await expect(history).toContainText(
          locale === "fr" ? "En attente d’examen" : "Awaiting review",
        );
        await history.scrollIntoViewIfNeeded();
      } else if (id === "transfers") {
        await page.locator("fieldset").nth(2).scrollIntoViewIfNeeded();
      }
      const workspace = page.locator("aside + div.min-w-0");
      const target =
        id === "getting-started"
          ? page.locator("section").first()
          : id === "phone"
            ? page.locator("fieldset").first()
            : id === "transfers"
              ? page.locator("fieldset").nth(2)
              : id === "calendar"
                ? page
                    .getByRole("button", {
                      name:
                        locale === "fr"
                          ? "Connecter Google Calendar"
                          : "Connect Google Calendar",
                      exact: true,
                    })
                    .locator("../..")
                : id === "leads"
                  ? page.locator("form").last()
                  : id === "automations"
                    ? page.locator("table").locator("..")
                    : id === "account"
                      ? page.getByRole("region", {
                          name:
                            locale === "fr"
                              ? "Demandes de modification du compte"
                              : "Account change requests",
                        })
                      : id === "billing"
                        ? page.getByRole("heading", { level: 1 }).locator("..")
                        : workspace.locator(":scope > div").last();
      await target.screenshot({
        path: `public/help/${id}-${locale}.png`,
        animations: "disabled",
      });
    }
  });
}
