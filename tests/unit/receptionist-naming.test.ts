import assert from "node:assert/strict";
import { test } from "node:test";
import en from "../../src/messages/en.json";
import fr from "../../src/messages/fr.json";

for (const [locale, messages, name] of [
  ["en", en, "Receptionist"],
  ["fr", fr, "Réceptionniste"],
] as const) {
  test(`${locale}: public plans and dashboard use one receptionist product name`, () => {
    const labels = [
      messages.nav.aiReceptionist,
      messages.home.pricingPreview.tiers[2].name,
      messages.pricing.tiers[2].name,
      messages.pricing.comparison.columns[2],
      messages.aiReceptionist.planName,
      messages.app.nav.receptionist,
      messages.app.nav.groupReceptionist,
      messages.app.receptionist.headline,
      messages.app.account.setupReceptionist,
      messages.app.settings.featureFlags.aiReceptionist,
      messages.admin.platform.navReceptionist,
    ];
    for (const label of labels) assert.equal(label, name);
  });

  test(`${locale}: customer-facing copy has no obsolete AI-prefixed product name`, () => {
    const values = (value: unknown): string[] => {
      if (typeof value === "string") return [value];
      if (!value || typeof value !== "object") return [];
      return Object.values(value).flatMap(values);
    };
    for (const value of values(messages))
      assert.doesNotMatch(value, /\bAI receptionist\b|\bréceptionniste IA\b/i);
  });
}
