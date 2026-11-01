import assert from "node:assert/strict";
import { describe, it } from "node:test";
import en from "../../src/messages/en.json";
import fr from "../../src/messages/fr.json";
import { PLAN_PRICES, formatPlanMoney } from "../../src/lib/plans";
import {
  demoCapabilitiesAreEntitled,
  websiteServiceAddOn,
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

  it("Done-for-You Website Service starts at CAD 349, one-time, never included free", () => {
    const addOn = websiteServiceAddOn();
    assert.equal(addOn.priceCad, 349);
    assert.equal(addOn.priceIsStartingAt, true);
    assert.equal(ADD_ONS.websiteService.priceCad, 349);
    assert.deepEqual([...addOn.includedInPlans], []);
    assert.deepEqual([...addOn.availableOn], [...PLAN_ORDER]);
    // A one-time project, not a recurring subscription charge.
    assert.equal(addOn.billingSchedule, "one-time");
  });

  it("the website service does not change any subscription price", () => {
    assert.deepEqual(PLAN_PRICES, {
      starter: { setup: 799.99, monthly: 349.99 },
      growth: { setup: 1499.99, monthly: 649.99 },
      receptionist: { setup: 1999.99, monthly: 949.99 },
    });
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

  it("website service copy quotes the catalog price in both languages", () => {
    const whole = (locale: "en" | "fr") =>
      formatPlanMoney(ADD_ONS.websiteService.priceCad, locale, 0);
    assert.equal(whole("en"), "$349");
    assert.ok(whole("fr").startsWith("349"));
    for (const [code, messages] of [
      ["en", en],
      ["fr", fr],
    ] as const) {
      const service = messages.plans.addOns.websiteService;
      assert.ok(service.price.includes("349"), `${code} price headline`);
      assert.ok(service.price.includes("CAD"), `${code} price currency`);
      assert.ok(
        messages.pricing.websiteMention.includes("349"),
        `${code} per-plan mention`,
      );
      // The subscription figures must never be mistaken for the website price.
      assert.ok(!service.price.includes("349.99"), `${code} price`);
      assert.ok(!service.price.includes("349,99"), `${code} price`);
    }
    assert.match(en.plans.addOns.websiteService.price, /^Starting at \$349 CAD$/);
    assert.equal(en.plans.addOns.websiteService.title, "Done-for-You Website Service");
    assert.equal(en.plans.addOns.websiteService.cta, "Get My Website Built");
    assert.equal(
      en.pricing.websiteMention,
      "Need a website? Add our website service starting at $349.",
    );
  });

  it("no pricing copy still sells a 'Website Builder'", () => {
    for (const messages of [en, fr]) {
      assert.equal(
        "websiteBuilder" in (messages.plans.addOns as Record<string, unknown>),
        false,
      );
    }
  });
});

describe("Custom Voice Cloning (Receptionist Plus only)", () => {
  it("is a premium capability that only Receptionist Plus has", () => {
    const capability = getCapability("customVoice");
    assert.equal(capability.feature, "AI_CUSTOM_VOICE");
    assert.equal(capabilityAvailability("starter", capability), "none");
    assert.equal(capabilityAvailability("growth", capability), "none");
    assert.equal(capabilityAvailability("receptionist", capability), "included");
    assert.equal(orgHasFeature("receptionist", "AI_CUSTOM_VOICE"), true);
    assert.equal(orgHasFeature("growth", "AI_CUSTOM_VOICE"), false);
  });

  it("is shown on the Receptionist Plus card, and on no other plan card", () => {
    assert.ok(PLAN_CATALOG.receptionist.cardCapabilities.includes("customVoice"));
    assert.equal(PLAN_CATALOG.starter.cardCapabilities.includes("customVoice"), false);
    assert.equal(PLAN_CATALOG.growth.cardCapabilities.includes("customVoice"), false);
  });

  it("appears in the comparison table as Plus-only, in English and French", () => {
    for (const [code, messages, label] of [
      ["en", en, /custom voice cloning/i],
      ["fr", fr, /clonage de voix personnalis/i],
    ] as const) {
      const rows = messages.pricing.comparison.rows as {
        feature: string;
        values: string[];
      }[];
      const row = rows.find((r) => label.test(r.feature));
      assert.ok(row, `${code} comparison row`);
      assert.deepEqual(row.values, ["n", "n", "y"], `${code} values`);
    }
  });

  it("the exclusive callout is on the Plus card only, with the agreed wording", () => {
    for (const [code, messages] of [
      ["en", en],
      ["fr", fr],
    ] as const) {
      const tiers = messages.pricing.tiers as { exclusive?: unknown }[];
      assert.deepEqual(
        tiers.map((t) => Boolean(t.exclusive)),
        [false, false, true],
        code,
      );
    }
    assert.equal(
      en.pricing.tiers[2]!.exclusive!.body,
      "Make your receptionist sound like you. Record your voice once, and let your receptionist answer customer calls using your voice.",
    );
  });

  it("does not change what any plan costs", () => {
    assert.deepEqual(PLAN_PRICES, {
      starter: { setup: 799.99, monthly: 349.99 },
      growth: { setup: 1499.99, monthly: 649.99 },
      receptionist: { setup: 1999.99, monthly: 949.99 },
    });
  });
});

