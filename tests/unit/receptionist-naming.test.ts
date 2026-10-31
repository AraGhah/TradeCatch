import assert from "node:assert/strict";
import { test } from "node:test";
import en from "../../src/messages/en.json";
import fr from "../../src/messages/fr.json";
import { PLAN_DISPLAY_NAMES } from "../../src/product/saas/entitlements";

/**
 * Product name (nav, feature, dashboard) stays "Receptionist" /
 * "Réceptionniste". The paid tier is "Receptionist Plus" /
 * "Réceptionniste Plus". Customer-facing copy must never use the obsolete
 * "AI receptionist" / "réceptionniste IA" product branding.
 */
for (const [locale, messages, productName, planName] of [
  ["en", en, "Receptionist", "Receptionist Plus"],
  ["fr", fr, "Réceptionniste", "Réceptionniste Plus"],
] as const) {
  test(`${locale}: product surfaces use the Receptionist feature name`, () => {
    const labels = [
      messages.nav.aiReceptionist,
      messages.aiReceptionist.planName,
      messages.app.nav.receptionist,
      messages.app.nav.groupReceptionist,
      messages.app.receptionist.headline,
      messages.app.account.setupReceptionist,
      messages.app.settings.featureFlags.aiReceptionist,
      messages.admin.platform.navReceptionist,
    ];
    for (const label of labels) assert.equal(label, productName);
  });

  test(`${locale}: paid tier is named Receptionist Plus on pricing and plans`, () => {
    assert.equal(messages.plans.names.receptionist, planName);
    assert.equal(PLAN_DISPLAY_NAMES.receptionist, "Receptionist Plus");
    assert.equal(messages.pricing.tiers[2].name, planName);
    assert.equal(messages.pricing.comparison.columns[2], planName);
    assert.equal(messages.home.pricingPreview.tiers[2].name, planName);
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
