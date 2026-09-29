import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Website ↔ AI receptionist: the interactive demo on the public page runs the
 * real conversation engine with no side effects.
 */

async function demoSection(page: Page, path: string) {
  await page.goto(path);
  // The locale template swaps a plain <div> for a motion wrapper right after
  // mount, which re-creates the page subtree once. Wait for it to settle so
  // the test never holds a soon-to-be-detached element.
  await page
    .waitForFunction(() => {
      const el = document.querySelector("#try-it");
      return Boolean(el?.closest('div[style*="transform"]'));
    }, undefined, { timeout: 10_000 })
    .catch(() => undefined);
  const section = page.locator("#try-it");
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible();
  return section;
}

test.describe("receptionist demo on the AI receptionist page", () => {
  test("English: full service-request call ends with a summary card", async ({
    page,
  }) => {
    const section = await demoSection(page, "/ai-receptionist");
    await expect(
      section.getByText(/Nothing is sent, no phone is dialed/i),
    ).toBeVisible();

    await section.getByRole("button", { name: "Start the call" }).click();
    const log = section.getByRole("log");
    await expect(log).toContainText("Nord Plumbing (demo)");

    await section.getByRole("button", { name: /leaking since yesterday/i }).click();
    await expect(log).toContainText("May I have your name");

    await section.getByLabel("What the caller says").fill("My name is Marie Tremblay");
    await section.getByRole("button", { name: "Send" }).click();
    await expect(log).toContainText("Thanks Marie Tremblay");

    await section.getByRole("button", { name: /Saint-Denis/ }).click();
    await section.getByRole("button", { name: "Yes", exact: true }).click();
    await section.getByRole("button", { name: "Tomorrow morning" }).click();

    await expect(section.getByText("The call has ended.")).toBeVisible();
    await expect(section.getByText("Generated from the demo call. Not a real customer.")).toBeVisible();
    const summary = section.locator("dl");
    await expect(summary).toContainText("Marie Tremblay");
    await expect(summary).toContainText("Tomorrow morning");
    await expect(summary).toContainText("Message taken");

    await section.getByRole("button", { name: "Start another call" }).click();
    await expect(section.getByRole("button", { name: "Start the call" })).toBeVisible();
  });

  test("French: emergency is bridged (simulated) with the 9-1-1 message", async ({
    page,
  }) => {
    const section = await demoSection(page, "/fr/receptionniste-ia");
    await section.getByRole("radio", { name: /Hors des heures/ }).check();
    await section.getByRole("button", { name: /Démarrer l.appel/ }).click();
    const log = section.getByRole("log");
    await expect(log).toContainText("Plomberie Nord (démo)");
    await expect(log).toContainText(/fermés/);

    await section.getByRole("button", { name: /odeur de gaz/i }).click();
    await expect(log).toContainText("9-1-1");
    await expect(log).toContainText(/Transfert d.urgence simulé/);
    await expect(section.getByText(/L.appel est terminé\./)).toBeVisible();
    await expect(section.locator("dl")).toContainText("Urgence");
  });

  for (const path of ["/ai-receptionist", "/fr/receptionniste-ia"]) {
    test(`${path} demo has no WCAG A/AA violations, idle and mid-call`, async ({
      page,
    }) => {
      const section = await demoSection(page, path);
      const analyze = async () => {
        const results = await new AxeBuilder({ page })
          .include("#try-it")
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(
          results.violations,
          results.violations
            .map((v) => `${v.id}: ${v.help} (${v.nodes.length} node(s))`)
            .join("\n"),
        ).toEqual([]);
      };
      await analyze();
      await section.getByRole("button", { name: /^(Start the call|Démarrer)/ }).click();
      await expect(section.getByRole("log")).not.toBeEmpty();
      await analyze();
    });
  }
});
