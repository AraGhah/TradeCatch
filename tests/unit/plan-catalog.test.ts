import assert from "node:assert/strict";
import { describe, it } from "node:test";
import en from "../../src/messages/en.json";
import fr from "../../src/messages/fr.json";
import { PLAN_PRICES, formatPlanMoney } from "../../src/lib/plans";
import {
  demoCapabilitiesAreEntitled,
  websiteBuilderAddOn,
} from "../../src/lib/plan-marketing";
import {
  ADD_ONS,
  CAPABILITIES,
  DEFAULT_REFERRAL_REWARDS_CENTS,
  PLAN_CATALOG,
  PLAN_CHANNEL,
  PLAN_ORDER,
  PREMIUM_PLAN,
  capabilityAvailability,
  getCapability,
  listPlans,
  stepUp,
} from "../../src/product/saas/plan-catalog";
import {
  PLAN_DISPLAY_NAMES,
  orgHasFeature,
  type PlanId,
} from "../../src/product/saas/entitlements";

describe("plan catalog", () => {
  it("lists plans in price order with catalog + prices", () => {
    const listed = listPlans();
    assert.deepEqual(
      listed.map((p) => p.id),
      [...PLAN_ORDER],
    );
    for (const plan of listed) {
      assert.equal(plan.price.setup, PLAN_PRICES[plan.id].setup);
      assert.equal(plan.price.monthly, PLAN_PRICES[plan.id].monthly);
      assert.equal(plan.channel, PLAN_CHANNEL[plan.id]);
    }
  });

  it("keeps Starter SMS-only and Growth/Plus on voice channels", () => {
    assert.equal(PLAN_CHANNEL.starter, "sms");
    assert.equal(PLAN_CHANNEL.growth, "voice-essentials");
    assert.equal(PLAN_CHANNEL.receptionist, "voice-complete");
    assert.equal(PREMIUM_PLAN, "receptionist");
    assert.equal(PLAN_CATALOG.receptionist.emphasis, "premium");
  });

  it("never advertises a demo capability the plan does not have", () => {
    for (const id of PLAN_ORDER) {
      assert.equal(
        demoCapabilitiesAreEntitled(id),
        true,
        `${id} demo shows an unentitled capability`,
      );
      for (const capId of PLAN_CATALOG[id].demo.capabilities) {
        const availability = capabilityAvailability(id, getCapability(capId));
        assert.notEqual(availability, "none", `${id} demo ${capId}`);
        assert.notEqual(availability, "planned", `${id} demo ${capId}`);
      }
    }
  });

  it("never shows a planned capability as included on any plan", () => {
    for (const capability of CAPABILITIES) {
      if (!("planned" in capability) || !capability.planned) continue;
      for (const plan of PLAN_ORDER) {
        assert.equal(
          capabilityAvailability(plan, capability),
          "planned",
          `${capability.id} on ${plan}`,
        );
      }
    }
  });

  it("card capabilities are entitled (included or limited) for that plan", () => {
    for (const id of PLAN_ORDER) {
      for (const capId of PLAN_CATALOG[id].cardCapabilities) {
        const availability = capabilityAvailability(id, getCapability(capId));
        assert.ok(
          availability === "included" || availability === "limited",
          `${id} card lists ${capId} as ${availability}`,
        );
      }
    }
  });

  it("Growth has voice but not Plus-only call actions", () => {
    assert.equal(orgHasFeature("growth", "AI_RECEPTIONIST_VOICE"), true);
    assert.equal(orgHasFeature("starter", "AI_RECEPTIONIST_VOICE"), false);
    assert.equal(orgHasFeature("growth", "AI_PHONE_BOOKING"), false);
    assert.equal(orgHasFeature("growth", "AI_CALL_TRANSFER"), false);
    assert.equal(orgHasFeature("growth", "AI_EMERGENCY_ROUTING"), false);
    assert.equal(orgHasFeature("growth", "AI_CALL_TRANSCRIPTS"), false);
    assert.equal(orgHasFeature("receptionist", "AI_PHONE_BOOKING"), true);
    assert.equal(orgHasFeature("receptionist", "AI_CALL_TRANSFER"), true);
  });

  it("Website Builder add-on is CAD 349.99 and never included free", () => {
    const addOn = websiteBuilderAddOn();
    assert.equal(addOn.priceCad, 349.99);
    assert.equal(ADD_ONS.websiteBuilder.priceCad, 349.99);
    assert.deepEqual([...addOn.includedInPlans], []);
    assert.deepEqual([...addOn.availableOn], [...PLAN_ORDER]);
    assert.equal(addOn.billingSchedule, null);
  });

  it("default referral gift cards are CAD $50 / $75 / $125 by purchased plan", () => {
    assert.deepEqual(DEFAULT_REFERRAL_REWARDS_CENTS, {
      starter: 5_000,
      growth: 7_500,
      receptionist: 12_500,
    });
  });

  it("step-up matches the published price ladder", () => {
    const growth = stepUp("growth");
    const plus = stepUp("receptionist");
    assert.ok(growth);
    assert.ok(plus);
    assert.equal(growth!.monthly, 300);
    assert.equal(growth!.installation, 700);
    assert.equal(plus!.monthly, 300);
    assert.equal(plus!.installation, 500);
    assert.equal(stepUp("starter"), null);
  });

  it("i18n plan names match PLAN_DISPLAY_NAMES", () => {
    for (const id of PLAN_ORDER) {
      assert.equal(en.plans.names[id], PLAN_DISPLAY_NAMES[id as PlanId]);
    }
    assert.equal(fr.plans.names.receptionist, "Réceptionniste Plus");
    assert.equal(en.plans.names.receptionist, "Receptionist Plus");
  });

  it("every catalog capability has EN/FR labels and demo copy", () => {
    for (const capability of CAPABILITIES) {
      for (const [code, messages] of [
        ["en", en],
        ["fr", fr],
      ] as const) {
        const entry = (
          messages.plans.capabilities as Record<
            string,
            { label: string; demoTitle: string; demoBody: string }
          >
        )[capability.id];
        assert.ok(entry, `${code} missing plans.capabilities.${capability.id}`);
        assert.ok(entry.label.length > 0, `${code} ${capability.id} label`);
        assert.ok(entry.demoTitle.length > 0, `${code} ${capability.id} demoTitle`);
        assert.ok(entry.demoBody.length > 0, `${code} ${capability.id} demoBody`);
      }
    }
  });

  it("Website Builder copy quotes the catalog price", () => {
    const priceEn = formatPlanMoney(ADD_ONS.websiteBuilder.priceCad, "en");
    const priceFr = formatPlanMoney(ADD_ONS.websiteBuilder.priceCad, "fr");
    assert.ok(en.plans.addOns.websiteBuilder.priceNote.includes("349.99"));
    assert.ok(fr.plans.addOns.websiteBuilder.priceNote.includes("349,99"));
    assert.ok(priceEn.includes("349.99"));
    assert.ok(priceFr.includes("349,99"));
  });
});
