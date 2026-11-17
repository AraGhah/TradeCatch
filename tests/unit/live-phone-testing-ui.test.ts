/**
 * The Live phone testing screen, rendered for real in both languages.
 *
 * Type-checking cannot see a missing translation key, and a missing key in
 * next-intl is a runtime error on the page. This renders the component with
 * the shipped messages and `onError` set to throw, with every scenario's real
 * result, every readiness state and every error code in play, so a key that
 * is used but not translated fails here instead of in front of the owner.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { LivePhoneTesting } from "../../src/components/app/LivePhoneTesting";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { profileSettingsSchema, type ReceptionistProfile } from "../../src/product/receptionist/profile";
import {
  LIVE_TEST_SCENARIOS,
  LiveTestError,
  runSimulatedPhoneScenario,
  type SimulationRun,
} from "../../src/product/telephony/live-test";
import { buildLiveTestInstructions, type LiveTestInstructions } from "../../src/product/telephony/live-test-instructions";
import { defaultPhoneSettings } from "../../src/product/telephony/phone-settings";

const NOW = new Date("2026-03-04T15:00:00Z");
const NUMBER = "+14382314700";
const client = demoClientAccount({ id: "client_ui", contractorDisplayName: "testTradeCatch" });

function profile(strategy: "ai_first" | "human_first", activated = true): ReceptionistProfile {
  return {
    organizationId: "org_ui",
    phoneNumberE164: NUMBER,
    activated,
    settings: profileSettingsSchema.parse({
      receptionistName: "Sophie",
      notifyEmail: "owner@example.com",
      emergencyTransferE164: "+14385597003",
      fallbackTransferE164: "+14385597004",
      businessHours: { start: "00:00", end: "00:00", days: [0, 1, 2, 3, 4, 5, 6] },
      phoneSettings: {
        ...defaultPhoneSettings(),
        tradecatchNumberE164: NUMBER,
        humanTransferE164: "+14385597004",
        inboundStrategy: strategy,
        aiEnabled: true,
      },
      knowledge: { companyName: "testTradeCatch", services: ["plumbing"], serviceAreas: ["Montréal"] },
    }),
    updatedAt: NOW.toISOString(),
  };
}

async function everyRun(): Promise<SimulationRun[]> {
  const runs: SimulationRun[] = [];
  for (const strategy of ["ai_first", "human_first"] as const) {
    for (const scenario of LIVE_TEST_SCENARIOS) {
      for (const language of ["fr", "en"] as const) {
        try {
          const { run } = await runSimulatedPhoneScenario({
            organizationId: "org_ui",
            profile: profile(strategy),
            client,
            scenario,
            language,
            now: NOW,
            runId: `${strategy}-${scenario}-${language}`,
          });
          runs.push(run);
        } catch (error) {
          if (!(error instanceof LiveTestError)) throw error;
        }
      }
    }
  }
  return runs;
}

function instructions(strategy: "ai_first" | "human_first", activated = true): LiveTestInstructions {
  return buildLiveTestInstructions({
    organizationId: "org_ui",
    profile: profile(strategy, activated),
    client,
    configs: [],
    now: NOW,
    env: {},
  });
}

function messages(lang: "en" | "fr") {
  return JSON.parse(readFileSync(join(process.cwd(), `src/messages/${lang}.json`), "utf8")) as Record<string, unknown>;
}

// Typed loosely on purpose: the provider's props require `children`, which the
// lint rules want passed as an argument rather than a prop.
const Provider = NextIntlClientProvider as unknown as ComponentType<Record<string, unknown>>;

function render(lang: "en" | "fr", props: Partial<Parameters<typeof LivePhoneTesting>[0]>) {
  const errors: string[] = [];
  const html = renderToStaticMarkup(
    createElement(
      Provider,
      {
        locale: lang,
        messages: messages(lang),
        timeZone: "America/Toronto",
        onError: (error: unknown) => {
          errors.push(String((error as Error).message ?? error));
        },
        getMessageFallback: ({ key }: { key: string }) => `⟦MISSING:${key}⟧`,
      },
      createElement(LivePhoneTesting, {
        organizationId: "org_ui",
        initialLive: null,
        initialRuns: [],
        timeZone: "America/Toronto",
        loadFailed: false,
        ...props,
      }),
    ),
  );
  return { html, errors };
}

describe("Live phone testing screen", () => {
  for (const lang of ["en", "fr"] as const) {
    it(`${lang}: renders every scenario's result and every readiness state without a missing translation`, async () => {
      const runs = await everyRun();
      assert.ok(runs.length >= 20, "a run for most scenario/strategy/language combinations");
      for (const live of [instructions("ai_first"), instructions("human_first"), instructions("ai_first", false)]) {
        const { html, errors } = render(lang, { initialLive: live, initialRuns: runs });
        assert.deepEqual(errors, [], `${lang}: translation errors`);
        assert.doesNotMatch(html, /⟦MISSING/, `${lang}: a key is shown untranslated`);
        assert.doesNotMatch(html, /app\.livePhoneTesting|\bevents\.[a-z_]+\b|\btermination\.[a-z_]+\b/);
      }
    });

    it(`${lang}: every event of every run is labelled as a simulation, with its time offset`, async () => {
      const runs = (await everyRun()).slice(0, 6);
      const { html } = render(lang, { initialLive: instructions("human_first"), initialRuns: runs });
      const badge = lang === "fr" ? "Simulation" : "Simulation";
      const labelled = html.split(badge).length - 1;
      const events = runs.reduce((n, run) => n + run.events.length, 0);
      assert.ok(labelled >= events, `${labelled} labels for ${events} events`);
      for (const run of runs) assert.ok(html.includes(run.callSid));
      assert.match(html, /\+\d+s/);
    });

    it(`${lang}: states carrier charges, shows the real number, and offers no way to call from the page`, () => {
      const { html } = render(lang, { initialLive: instructions("ai_first") });
      assert.match(html, lang === "fr" ? /frais d.opérateur peuvent s.appliquer/i : /carrier charges may apply/i);
      assert.match(html, /role="note"/);
      assert.ok(html.includes(NUMBER), "the configured number is shown");
      assert.match(html, /Bonjour, ici Sophie de testTradeCatch/, "the greeting the caller will hear is shown");
      assert.doesNotMatch(html, /href="tel:|href="sms:/);
      // Two buttons run something: one simulation, one re-check. Neither is a link to a call.
      assert.equal((html.match(/<button/g) ?? []).length, 2);
    });

    it(`${lang}: the empty and failed states are readable`, () => {
      const empty = render(lang, {});
      assert.deepEqual(empty.errors, []);
      assert.match(empty.html, lang === "fr" ? /Aucune simulation/ : /No simulations yet/);
      const failed = render(lang, { loadFailed: true });
      assert.deepEqual(failed.errors, []);
      assert.match(failed.html, /role="alert"/);
      const notReady = render(lang, { initialLive: instructions("ai_first", false) });
      assert.deepEqual(notReady.errors, []);
      assert.match(notReady.html, lang === "fr" ? /À corriger/ : /Fix/);
    });
  }

  it("a call to the number is never described as a simulation, and a simulation never as a real call", async () => {
    const runs = (await everyRun()).slice(0, 2);
    const { html } = render("en", { initialRuns: runs, initialLive: instructions("ai_first") });
    assert.match(html, /Simulation only: no phone is called and nothing is billed/);
    assert.match(html, /A call you place yourself appears there as a real call, not a simulation/);
  });
});
