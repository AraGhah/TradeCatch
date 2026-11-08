import assert from "node:assert/strict";
import { describe, it } from "node:test";
import en from "../../src/messages/en.json";
import fr from "../../src/messages/fr.json";
import { PLAN_PRICES } from "../../src/lib/plans";
import {
  comparisonRowsFromCatalog,
  planCardCapabilityIds,
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
  REFERRAL_MAX_REWARD_CENTS,
  REFERRAL_PLAN_REWARD_CENTS,
  REFERRAL_WEBSITE_BONUS_CENTS,
  capabilityAvailability,
  getCapability,
  isSoldPlan,
  listPlans,
  previousPlan,
  stepUp,
} from "../../src/product/saas/plan-catalog";
import {
  PLAN_DISPLAY_NAMES,
  PUBLIC_PLAN_IDS,
  orgHasFeature,
} from "../../src/product/saas/entitlements";

describe("plan catalog", () => {
  it("sells exactly two plans, Essential then Professional", () => {
    assert.deepEqual([...PLAN_ORDER], ["essential", "professional"]);
    assert.deepEqual([...PUBLIC_PLAN_IDS], ["essential", "professional"]);
    assert.deepEqual(
      listPlans().map((p) => p.id),
      ["essential", "professional"],
    );
    for (const retired of ["starter", "growth", "receptionist"]) {
      assert.equal(isSoldPlan(retired), false, retired);
      assert.equal(retired in PLAN_CATALOG, false, retired);
    }
  });

  it("lists plans with the catalog price and channel", () => {
    for (const plan of listPlans()) {
      assert.equal(plan.price.setup, PLAN_PRICES[plan.id].setup);
      assert.equal(plan.price.monthly, PLAN_PRICES[plan.id].monthly);
      assert.equal(plan.channel, PLAN_CHANNEL[plan.id]);
    }
    assert.equal(PLAN_CHANNEL.essential, "voice-answering");
    assert.equal(PLAN_CHANNEL.professional, "voice-booking");
    assert.equal(PREMIUM_PLAN, "professional");
    assert.equal(PLAN_CATALOG.professional.emphasis, "featured");
  });

  it("Essential answers calls and captures customers but has no booking system", () => {
    for (const feature of [
      "AI_RECEPTIONIST_VOICE",
      "MISSED_CALL_RECOVERY",
      "QUOTE_FOLLOW_UP",
      "BASIC_ANALYTICS",
      "AI_CALL_TRANSCRIPTS",
    ] as const) {
      assert.equal(orgHasFeature("essential", feature), true, feature);
    }
    assert.equal(orgHasFeature("essential", "AI_PHONE_BOOKING"), false);
    assert.equal(orgHasFeature("essential", "APPOINTMENT_BOOKING"), false);
  });

  it("Professional has everything Essential has, plus appointments", () => {
    const essential = listPlans().find((p) => p.id === "essential")!.features;
    for (const feature of essential) {
      assert.equal(orgHasFeature("professional", feature), true, feature);
    }
    assert.equal(orgHasFeature("professional", "AI_PHONE_BOOKING"), true);
    assert.equal(orgHasFeature("professional", "APPOINTMENT_BOOKING"), true);
  });

  it("neither launch plan can transfer calls, clone a voice or run bulk outreach", () => {
    for (const plan of PLAN_ORDER) {
      for (const feature of [
        "AI_CALL_TRANSFER",
        "AI_EMERGENCY_ROUTING",
        "ADVANCED_CALL_ROUTING",
        "AI_CUSTOM_VOICE",
        "CUSTOMER_REACTIVATION",
        "CONTRACT_RENEWAL_AUTOMATION",
        "CRM_INTEGRATION_LIMITED",
        "CRM_INTEGRATION_ADVANCED",
      ] as const) {
        assert.equal(orgHasFeature(plan, feature), false, `${plan} ${feature}`);
      }
    }
  });

  it("card capabilities are all really included in that plan", () => {
    for (const id of PLAN_ORDER) {
      for (const capId of planCardCapabilityIds(id)) {
        assert.equal(
          capabilityAvailability(id, getCapability(capId)),
          "included",
          `${id} card lists ${capId}`,
        );
      }
    }
  });

  it("Essential's card never shows an appointment capability", () => {
    for (const capId of PLAN_CATALOG.essential.cardCapabilities) {
      assert.notEqual(getCapability(capId).group, "appointments", capId);
    }
    assert.ok(
      PLAN_CATALOG.professional.cardCapabilities.some(
        (id) => getCapability(id).group === "appointments",
      ),
    );
  });

  it("the comparison table is derived from entitlements, never typed by hand", () => {
    const rows = comparisonRowsFromCatalog();
    assert.equal(rows.length, CAPABILITIES.length);
    for (const row of rows) {
      const capability = getCapability(row.capabilityId);
      assert.deepEqual(
        row.values,
        PLAN_ORDER.map((plan) =>
          capabilityAvailability(plan, capability) === "included" ? "y" : "n",
        ),
        row.capabilityId,
      );
      if (capability.group === "appointments") {
        assert.deepEqual(row.values, ["n", "y"], `${row.capabilityId} is Professional only`);
      } else {
        assert.deepEqual(row.values, ["y", "y"], `${row.capabilityId} is in both plans`);
      }
    }
  });

  it("Website Service is $349.99, one-time, optional and never included free", () => {
    const addOn = websiteServiceAddOn();
    assert.equal(addOn.priceCad, 349.99);
    assert.equal(addOn.priceIsStartingAt, false);
    assert.equal(ADD_ONS.websiteService.priceCad, 349.99);
    assert.deepEqual([...addOn.includedInPlans], []);
    assert.deepEqual([...addOn.availableOn], [...PLAN_ORDER]);
    // A one-time project, not a recurring subscription charge.
    assert.equal(addOn.billingSchedule, "one-time");
  });

  it("the website service does not change any subscription price", () => {
    assert.equal(PLAN_PRICES.essential.monthly, 249);
    assert.equal(PLAN_PRICES.professional.monthly, 349);
    assert.equal(PLAN_PRICES.essential.setup, 1999.99);
    assert.equal(PLAN_PRICES.professional.setup, 1999.99);
  });

  it("referrals pay $65 per plan and $35 more for the website service, $100 at most", () => {
    assert.equal(REFERRAL_PLAN_REWARD_CENTS, 6_500);
    assert.equal(REFERRAL_WEBSITE_BONUS_CENTS, 3_500);
    assert.equal(REFERRAL_MAX_REWARD_CENTS, 10_000);
    assert.equal(DEFAULT_REFERRAL_REWARDS_CENTS.essential, 6_500);
    assert.equal(DEFAULT_REFERRAL_REWARDS_CENTS.professional, 6_500);
  });

  it("step-up from Essential to Professional is $100 a month with no extra setup", () => {
    const up = stepUp("professional");
    assert.ok(up);
    assert.equal(up!.from, "essential");
    assert.equal(up!.monthly, 100);
    assert.equal(up!.installation, 0);
    assert.equal(stepUp("essential"), null);
    assert.equal(previousPlan("essential"), null);
    assert.equal(previousPlan("professional"), "essential");
  });

  it("i18n plan names match PLAN_DISPLAY_NAMES", () => {
    for (const messages of [en, fr]) {
      for (const id of PLAN_ORDER) {
        assert.equal(messages.plans.names[id], PLAN_DISPLAY_NAMES[id]);
      }
    }
    // Retired plan names stay available for existing customers' billing pages.
    assert.equal(fr.plans.names.receptionist, "Réceptionniste Plus");
    assert.equal(en.plans.names.receptionist, "Receptionist Plus");
  });

  it("every catalog capability has an EN and FR label, and none sells a removed feature", () => {
    for (const capability of CAPABILITIES) {
      for (const [code, messages] of [
        ["en", en],
        ["fr", fr],
      ] as const) {
        const entry = (
          messages.plans.capabilities as Record<string, { label: string }>
        )[capability.id];
        assert.ok(entry, `${code} missing plans.capabilities.${capability.id}`);
        assert.ok(entry.label.length > 0, `${code} ${capability.id} label`);
        assert.doesNotMatch(
          entry.label,
          /transfer|transf[eé]r|voice clon|clonage|webhook|CRM/i,
          `${code} ${capability.id}`,
        );
      }
    }
  });

  it("the pricing tiers show only what the plan really includes", () => {
    for (const [code, messages] of [
      ["en", en],
      ["fr", fr],
    ] as const) {
      const [essential, professional] = messages.pricing.tiers;
      assert.equal(essential!.name, "Essential", code);
      assert.equal(professional!.name, "Professional", code);
      const essentialText = JSON.stringify(essential).toLowerCase();
      assert.doesNotMatch(
        essentialText,
        /google calendar|google agenda|reschedul|déplacement|reminder|rappel/,
        `${code}: Essential must not advertise scheduling`,
      );
    }
  });
});
