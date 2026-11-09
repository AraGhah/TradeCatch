import assert from "node:assert/strict";
import { test } from "node:test";
import en from "../../src/messages/en.json";
import fr from "../../src/messages/fr.json";
import { PLAN_DISPLAY_NAMES } from "../../src/product/saas/entitlements";

/**
 * Product name (nav, feature, dashboard) stays "Receptionist" /
 * "Réceptionniste". The two plans that are sold are "Essential" and
 * "Professional" in both languages. Customer-facing copy must never use the
 * obsolete "AI receptionist" / "réceptionniste IA" product branding.
 */
for (const [locale, messages, productName] of [
  ["en", en, "Receptionist"],
  ["fr", fr, "Réceptionniste"],
] as const) {
  test(`${locale}: product surfaces use the Receptionist feature name`, () => {
    const labels = [
      messages.nav.aiReceptionist,
      messages.aiReceptionist.eyebrow,
      messages.app.nav.receptionist,
      messages.app.nav.groupReceptionist,
      messages.app.receptionist.headline,
      messages.app.account.setupReceptionist,
      messages.app.settings.featureFlags.aiReceptionist,
      messages.admin.platform.navReceptionist,
    ];
    for (const label of labels) assert.equal(label, productName);
  });

  test(`${locale}: the two plans are named Essential and Professional everywhere they are sold`, () => {
    assert.equal(messages.plans.names.essential, "Essential");
    assert.equal(messages.plans.names.professional, "Professional");
    assert.equal(PLAN_DISPLAY_NAMES.essential, "Essential");
    assert.equal(PLAN_DISPLAY_NAMES.professional, "Professional");
    assert.deepEqual(
      messages.pricing.tiers.map((tier) => tier.name),
      ["Essential", "Professional"],
    );
    assert.deepEqual(
      messages.home.pricingPreview.tiers.map((tier) => tier.name),
      ["Essential", "Professional"],
    );
    assert.equal(messages.aiReceptionist.plans.essential.name, "Essential");
    assert.equal(messages.aiReceptionist.plans.professional.name, "Professional");
  });

  test(`${locale}: retired plan names remain only for existing customers`, () => {
    // Legacy ids stay valid so existing subscribers keep their plan, but none of
    // the public marketing namespaces may sell them.
    const marketing = JSON.stringify([
      messages.home,
      messages.pricing,
      messages.aiReceptionist,
      messages.onePager,
      messages.howItWorks,
      messages.faq,
    ]);
    assert.doesNotMatch(marketing, /\b(Starter|Growth|Receptionist Plus|Réceptionniste Plus)\b/);
  });

  test(`${locale}: customer-facing copy has no obsolete AI-prefixed product name`, () => {
    const values = (value: unknown): string[] => {
      if (typeof value === "string") return [value];
      if (!value || typeof value !== "object") return [];
      return Object.values(value).flatMap(values);
    };
    for (const value of values(messages)) {
      assert.doesNotMatch(value, /\bAI receptionist\b|\bréceptionniste IA\b/i);
    }
  });
}
