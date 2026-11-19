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

/**
 * The same wait for one element, for a button that is not inside a form. A click
 * that lands before React has attached to it does nothing.
 */
export async function waitForElementHydration(
  page: Page,
  selector: string,
): Promise<void> {
  await page.waitForFunction(
    (css) => {
      const element = document.querySelector(css);
      return Boolean(
        element &&
          Object.keys(element).some((key) => key.startsWith("__reactProps")),
      );
    },
    selector,
    { timeout: 15_000 },
  );
}
