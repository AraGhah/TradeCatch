import type { Page } from "@playwright/test";

/**
 * Waits until React has attached to the first form on the page. Typing into a
 * form and clicking before this happens can be lost (or submit the form the
 * old-fashioned way), which shows up as a rare failure on a busy machine.
 */
export async function waitForFormHydration(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const form = document.querySelector("main form");
      return Boolean(
        form && Object.keys(form).some((key) => key.startsWith("__reactProps")),
      );
    },
    undefined,
    { timeout: 15_000 },
  );
}
