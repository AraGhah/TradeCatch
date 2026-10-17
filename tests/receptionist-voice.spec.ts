import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Voice mode of the website demo. Headless Chromium has no microphone and no
 * speech engine, so the browser's speech APIs are replaced by stubs; the page
 * code under test (hands-free loop, failures, language, privacy copy) is real.
 */

declare global {
  interface Window {
    __heard: string[];
    __spoken: { text: string; lang: string }[];
    __recognitionLangs: string[];
    __micError: string | null;
  }
}

async function stubSpeech(page: Page, options: { supported?: boolean } = {}) {
  await page.addInitScript(
    ({ supported }) => {
      window.__heard = [];
      window.__spoken = [];
      window.__recognitionLangs = [];
      window.__micError = null;

      if (!supported) {
        for (const key of ["SpeechRecognition", "webkitSpeechRecognition"]) {
          Object.defineProperty(window, key, {
            value: undefined,
            configurable: true,
          });
        }
        return;
      }

      type Handler = ((event: unknown) => void) | null;
      class FakeRecognition {
        lang = "";
        continuous = false;
        interimResults = false;
        maxAlternatives = 1;
        onresult: Handler = null;
        onerror: Handler = null;
        onend: Handler = null;
        private stopped = false;
        start() {
          window.__recognitionLangs.push(this.lang);
          setTimeout(() => {
            if (this.stopped) return;
            if (window.__micError) {
              this.onerror?.({ error: window.__micError });
              this.onend?.(null);
              return;
            }
            const text = window.__heard.shift();
            if (!text) {
              this.onerror?.({ error: "no-speech" });
              this.onend?.(null);
              return;
            }
            this.onresult?.({
              results: [Object.assign([{ transcript: text }], { isFinal: true })],
            });
            this.onend?.(null);
          }, 30);
        }
        stop() {}
        abort() {
          this.stopped = true;
        }
      }
      for (const key of ["SpeechRecognition", "webkitSpeechRecognition"]) {
        Object.defineProperty(window, key, {
          value: FakeRecognition,
          configurable: true,
        });
      }

      class FakeUtterance {
        text: string;
        lang = "";
        voice: unknown = null;
        rate = 1;
        volume = 1;
        onend: Handler = null;
        onerror: Handler = null;
        constructor(text: string) {
          this.text = text;
        }
      }
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        value: FakeUtterance,
        configurable: true,
      });
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: {
          getVoices: () => [],
          cancel() {},
          speak(utterance: FakeUtterance) {
            // The silent priming utterance is not part of the conversation.
            if (utterance.text.trim()) {
              window.__spoken.push({ text: utterance.text, lang: utterance.lang });
            }
            setTimeout(() => utterance.onend?.(null), 5);
          },
        },
      });
    },
    { supported: options.supported ?? true },
  );
}

async function demoSection(page: Page, path: string) {
  await page.goto(path);
  await page
    .waitForFunction(
      () => Boolean(document.querySelector("#try-it")?.closest('div[style*="transform"]')),
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => undefined);
  const section = page.locator("#try-it");
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible();
  return section;
}

const spoken = (page: Page) =>
  page.evaluate(() => window.__spoken.map((s) => s.text).join(" | "));

test.describe("receptionist demo: speak with your voice", () => {
  test("English: the receptionist greets out loud and listens for each answer", async ({
    page,
  }) => {
    await stubSpeech(page);
    const section = await demoSection(page, "/receptionist");

    await expect(section.getByRole("radio", { name: "Speak" })).toBeChecked();
    await expect(section.getByText(/never audio/i)).toBeVisible();

    await page.evaluate(() => {
      window.__heard.push(
        "my kitchen sink is leaking since yesterday",
        "My name is Marie Tremblay",
      );
    });
    await section.getByRole("button", { name: /During business hours/ }).click();

    const log = section.getByRole("log");
    await expect(log).toContainText("Nord Plumbing (demo)");
    // What the stubbed microphone "heard" becomes the caller's line.
    await expect(log).toContainText("my kitchen sink is leaking since yesterday");
    await expect(log).toContainText("May I have your name");
    await expect(log).toContainText("Thanks Marie Tremblay");

    // The receptionist's lines were spoken, in the caller's language.
    await expect.poll(() => spoken(page)).toContain("Nord Plumbing (demo)");
    await expect.poll(() => spoken(page)).toContain("May I have your name");
    const langs = await page.evaluate(() => [
      ...window.__spoken.map((s) => s.lang),
      ...window.__recognitionLangs,
    ]);
    expect(new Set(langs)).toEqual(new Set(["en-CA"]));

    // Nobody answers the address question: it retries once, then hands control
    // back with a clear message instead of listening forever.
    await expect(section.getByRole("status")).toContainText("didn't hear anything");
    const micButton = section.getByRole("button", { name: "Start speaking" });
    await expect(micButton).toHaveAttribute("aria-pressed", "false");

    // The microphone button resumes the conversation.
    await page.evaluate(() => {
      window.__heard.push("123 Saint-Denis Street, Montréal");
    });
    await micButton.click();
    await expect(log).toContainText("123 Saint-Denis Street, Montréal");
  });

  test("a blocked microphone explains itself and typing still works", async ({
    page,
  }) => {
    await stubSpeech(page);
    const section = await demoSection(page, "/receptionist");
    await page.evaluate(() => {
      window.__micError = "not-allowed";
    });

    await section.getByRole("button", { name: /During business hours/ }).click();
    await expect(section.getByRole("status")).toContainText(
      "The microphone is blocked",
    );
    await expect(
      section.getByRole("button", { name: "Start speaking" }),
    ).toHaveAttribute("aria-pressed", "false");

    await section.getByRole("button", { name: /leaking since yesterday/i }).click();
    await expect(section.getByRole("log")).toContainText("May I have your name");
  });

  test("Type mode stays silent until replies are switched on", async ({ page }) => {
    await stubSpeech(page);
    const section = await demoSection(page, "/receptionist");

    await section.locator("label", { hasText: /^Type$/ }).click();
    await expect(section.getByRole("radio", { name: "Type" })).toBeChecked();
    await section.getByRole("button", { name: /During business hours/ }).click();
    const log = section.getByRole("log");
    await expect(log).toContainText("Nord Plumbing (demo)");

    await section.getByRole("button", { name: /leaking since yesterday/i }).click();
    await expect(log).toContainText("May I have your name");
    expect(await spoken(page)).toBe("");
    expect(await page.evaluate(() => window.__recognitionLangs.length)).toBe(0);

    await section.getByLabel("Read replies aloud").check();
    await section.getByLabel("What the caller says").fill("My name is Marie Tremblay");
    await section.getByRole("button", { name: "Send" }).click();
    await expect(log).toContainText("Thanks Marie Tremblay");
    await expect.poll(() => spoken(page)).toContain("Thanks Marie Tremblay");
    // Typing never opens the microphone.
    expect(await page.evaluate(() => window.__recognitionLangs.length)).toBe(0);
  });

  test("an emergency is spoken, then the call ends and the microphone closes", async ({
    page,
  }) => {
    await stubSpeech(page);
    const section = await demoSection(page, "/receptionist");
    await page.evaluate(() => {
      window.__heard.push("I smell gas in my house");
    });
    await section.getByRole("button", { name: /During business hours/ }).click();

    await expect(section.getByText("The call has ended.")).toBeVisible();
    // The finished call ends with a clear next step.
    await expect(
      section.getByRole("link", { name: "Book a demo" }),
    ).toHaveAttribute("href", /\/book-audit\?plan=receptionist$/);
    await expect.poll(() => spoken(page)).toContain("9-1-1");
    await expect(section.locator("dl")).toContainText("Emergency");
    // No further listening after the call ended.
    const listens = await page.evaluate(() => window.__recognitionLangs.length);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__recognitionLangs.length)).toBe(listens);
  });

  test("Québec French uses fr-CA for listening and speaking", async ({ page }) => {
    await stubSpeech(page);
    const section = await demoSection(page, "/fr/receptionniste");
    await expect(section.getByRole("radio", { name: "Parler" })).toBeChecked();

    await page.evaluate(() => {
      window.__heard.push("j'ai un évier qui coule depuis hier");
    });
    await section
      .getByRole("button", { name: /Pendant les heures d'ouverture/ })
      .click();
    const log = section.getByRole("log");
    await expect(log).toContainText("j'ai un évier qui coule depuis hier");
    await expect(log).toContainText("votre nom");

    const langs = await page.evaluate(() => [
      ...window.__spoken.map((s) => s.lang),
      ...window.__recognitionLangs,
    ]);
    expect(langs.length).toBeGreaterThan(2);
    expect(new Set(langs)).toEqual(new Set(["fr-CA"]));
  });

  test("a browser without speech recognition says so and still works by typing", async ({
    page,
  }) => {
    await stubSpeech(page, { supported: false });
    const section = await demoSection(page, "/receptionist");
    await expect(section.getByText(/Voice is not available in this browser/)).toBeVisible();
    await expect(section.getByRole("radio")).toHaveCount(0);

    await section.getByRole("button", { name: /During business hours/ }).click();
    await expect(section.getByRole("button", { name: "Start speaking" })).toHaveCount(0);
    await section.getByRole("button", { name: /leaking since yesterday/i }).click();
    await expect(section.getByRole("log")).toContainText("May I have your name");
  });

  for (const path of ["/receptionist", "/fr/receptionniste"]) {
    test(`${path} voice controls have no WCAG A/AA violations`, async ({ page }) => {
      await stubSpeech(page);
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
