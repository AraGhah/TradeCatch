import { expect, test } from "@playwright/test";

for (const locale of ["en", "fr"] as const) {
  for (const consent of [true, false]) {
    test(`short contact step and consent-safe abandonment (${locale}, analytics=${consent})`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        Object.assign(window, {
          auditEvents: [],
          gtag: (...args: unknown[]) => {
            if (args[0] === "event")
              (
                window as unknown as { auditEvents: unknown[] }
              ).auditEvents.push(args);
          },
        });
      });
      const fr = locale === "fr";
      await page.goto(fr ? "/fr/reserver-audit" : "/book-audit");
      await page
        .getByRole("button", {
          name: consent
            ? fr
              ? "Tout accepter"
              : "Accept all"
            : fr
              ? "Refuser les non essentiels"
              : "Reject non-essential",
          exact: true,
        })
        .click();
      // Install the observer after the site's own analytics bootstrap.
      await page.evaluate(() => {
        Object.assign(window, { auditEvents: [], gtag: (...args: unknown[]) => {
          if (args[0] === "event") (window as unknown as { auditEvents: unknown[] }).auditEvents.push(args);
        } });
      });
      const next = page.getByRole("button", {
        name: fr ? "Continuer" : "Continue",
        exact: true,
      });
      await page.locator("#audit-field-firstName").fill("Synthetic");
      await page.locator("#audit-field-lastName").fill("Test");
      await next.click();
      await page.locator("#audit-field-company").fill("Fictional Plumbing");
      await next.click();
      await page
        .getByRole("radio", {
          name: fr ? /Plomberie/ : /Plumbing/,
        })
        .click();
      await next.click();
      await expect(page.locator("#audit-field-email")).toBeVisible();
      await expect(page.locator("#audit-field-phone")).toBeVisible();
      await page
        .locator("#audit-field-email")
        .fill("synthetic@example.invalid");
      await page.locator("#audit-field-phone").fill("invalid");
      await next.click();
      await expect(page.locator("#audit-field-phone")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await page.locator("#audit-field-phone").fill("514-555-0100");
      await page.evaluate(() => {
        window.dispatchEvent(new Event("pagehide"));
        window.dispatchEvent(new Event("pagehide"));
      });
      const events = await page.evaluate(
        () => (window as unknown as { auditEvents: unknown[][] }).auditEvents,
      );
      const abandoned = events.filter(
        (row) => row[1] === "audit_form_abandoned",
      );
      expect(abandoned).toHaveLength(consent ? 1 : 0);
      if (consent)
        expect(abandoned[0][2]).toMatchObject({
          locale,
          step: "contact",
          form_version: "short_contact_v2",
        });
      expect(JSON.stringify(events)).not.toContain("synthetic@example.invalid");
      expect(JSON.stringify(events)).not.toContain("514-555-0100");
      await next.click();
      await expect(page.locator("#audit-field-city")).toBeVisible();
    });
  }
}
