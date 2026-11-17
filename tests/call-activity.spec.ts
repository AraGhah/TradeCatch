import { expect, test } from "@playwright/test";
import { workspaceSession } from "./support/workspace-session";

/**
 * KAN-15 · the call activity screen, in a real browser against a production
 * build. The harness has no receptionist line, so there are no calls to list;
 * what this proves is that the page, its APIs and both languages work for a
 * signed-in business without a load error, and that an empty history is said
 * honestly. (Stored calls, duplicates, ordering and isolation are proven in
 * tests/unit/call-activity*.test.ts on the real SQL; cross-business denial of
 * /calls is in auth-session.spec.ts.)
 */
test.describe("call activity", () => {
  test("a business with no calls yet sees an honest empty history, not an error", async ({ page }) => {
    await workspaceSession(page, "en", "professional");
    await page.goto("/app/calls");
    await expect(page.getByRole("heading", { name: "Receptionist calls", level: 1 })).toBeVisible();
    await expect(page.getByText("Your calls could not be loaded")).toHaveCount(0);
    await expect(page.getByText("No calls answered by the Receptionist yet.")).toBeVisible();

    // A refresh and a second visit show the same thing (nothing is held in the page).
    await page.reload();
    await expect(page.getByRole("heading", { name: "Receptionist calls", level: 1 })).toBeVisible();
    await expect(page.getByText("No calls answered by the Receptionist yet.")).toBeVisible();
  });

  test("the history APIs answer for the business, newest first, and never as a failure", async ({ page }) => {
    await workspaceSession(page, "en", "professional");
    const me = (await (await page.request.get("/api/app/me")).json()) as {
      organization: { id: string };
    };
    for (const resource of ["/calls", "/ai-receptionist/calls"]) {
      const res = await page.request.get(`/api/businesses/${me.organization.id}${resource}`);
      expect(res.status(), resource).toBe(200);
      const body = (await res.json()) as { ok: boolean; calls: unknown[] };
      expect(body.ok, resource).toBe(true);
      expect(Array.isArray(body.calls), resource).toBe(true);
    }
  });

  test("the page works in French", async ({ page }) => {
    await workspaceSession(page, "fr", "professional");
    await page.goto("/fr/app/calls");
    await expect(page.getByRole("heading", { name: "Appels de la réceptionniste", level: 1 })).toBeVisible();
    await expect(page.getByText("Vos appels n'ont pas pu être chargés")).toHaveCount(0);
  });
});
