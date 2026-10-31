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

test.describe("receptionist demo on the receptionist page", () => {
  // These cover the typed conversation. Voice has its own spec
  // (receptionist-voice.spec.ts); here the browser has no speech recognition,
  // as in Firefox, so the page falls back to typing.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      for (const key of ["SpeechRecognition", "webkitSpeechRecognition"]) {
        Object.defineProperty(window, key, { value: undefined, configurable: true });
      }
    });
  });

  test("English: full service-request call ends with a summary card", async ({
    page,
  }) => {
    const section = await demoSection(page, "/receptionist");
    await expect(
      section.getByText(/Nothing is sent, no phone is dialed/i),
    ).toBeVisible();

    // Clicking a situation card starts the call straight away.
    await section.getByRole("button", { name: /During business hours/ }).click();
    const log = section.getByRole("log");
    await expect(log).toContainText("Nord Plumbing (demo)");

    await section.getByRole("button", { name: /leaking since yesterday/i }).click();
    await expect(log).toContainText("Can I get your name, please?");

    await section.getByLabel("What the caller says").fill("My name is Marie Tremblay");
    await section.getByRole("button", { name: "Send" }).click();
    await expect(log).toContainText(
      "What's the address where you need the service, Marie Tremblay?",
    );

    await section.getByRole("button", { name: /Saint-Denis/ }).click();
    await section.getByRole("button", { name: "Yes", exact: true }).click();
    await section.getByRole("button", { name: "Tomorrow morning" }).click();

    await expect(log).toContainText("Is that correct?");
    await section.getByRole("button", { name: "Yes", exact: true }).click();

    await expect(section.getByText("The call has ended.")).toBeVisible();
    await expect(section.getByText("Generated from the demo call. Not a real customer.")).toBeVisible();
    const summary = section.locator("dl");
    await expect(summary).toContainText("Marie Tremblay");
    await expect(summary).toContainText("Tomorrow morning");
    await expect(summary).toContainText("Message taken");

    await section.getByRole("button", { name: "Start another call" }).click();
    await expect(
      section.getByRole("button", { name: /During business hours/ }),
    ).toBeVisible();
  });

  test("French: emergency is bridged (simulated) with the 9-1-1 message", async ({
    page,
  }) => {
    const section = await demoSection(page, "/fr/receptionniste");
    await section.getByRole("button", { name: /Hors des heures/ }).click();
    const log = section.getByRole("log");
    await expect(log).toContainText("Plomberie Nord (démo)");
    await expect(log).toContainText(/fermés/);

    await section.getByRole("button", { name: /odeur de gaz/i }).click();
    await expect(log).toContainText("9-1-1");
    await expect(log).toContainText(/Transfert d.urgence simulé/);
    await expect(section.getByText(/L.appel est terminé\./)).toBeVisible();
    await expect(section.locator("dl")).toContainText("Urgence");
  });

  for (const path of ["/receptionist", "/fr/receptionniste"]) {
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
      await section
        .getByRole("button", { name: /^(During business hours|Pendant les heures)/ })
        .click();
      await expect(section.getByRole("log")).not.toBeEmpty();
      await analyze();
    });
  }
});
