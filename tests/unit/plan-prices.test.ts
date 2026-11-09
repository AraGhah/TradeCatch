import assert from "node:assert/strict";
import { describe, it } from "node:test";
import en from "../../src/messages/en.json";
import fr from "../../src/messages/fr.json";
import {
  PLAN_PRICES,
  formatPlanMoney,
  formatPlanPrice,
  monthsCovered,
  parseMoneyInput,
} from "../../src/lib/plans";
import { ADD_ONS } from "../../src/product/saas/plan-catalog";

type Tier = {
  name: string;
  price: string;
  cadence: string;
  setupAmount?: string;
  monthlyAmount?: string;
  stepUp?: string;
};

const ORDER = ["essential", "professional"] as const;

function pricingTiers(messages: typeof en | typeof fr): Tier[] {
  return messages.pricing.tiers as Tier[];
}

describe("plan prices", () => {
  it("uses the agreed launch prices", () => {
    assert.deepEqual(PLAN_PRICES.essential, { setup: 1999.99, monthly: 249 });
    assert.deepEqual(PLAN_PRICES.professional, { setup: 1999.99, monthly: 349 });
    assert.equal(ADD_ONS.websiteService.priceCad, 699.99);
  });

  it("quotes the website service at exactly the catalog price in every message, and never the retired $349.99", () => {
    const strings = (value: unknown): string[] =>
      typeof value === "string"
        ? [value]
        : value && typeof value === "object"
          ? Object.values(value).flatMap(strings)
          : [];
    const price = ADD_ONS.websiteService.priceCad;
    assert.equal(price, 699.99);
    for (const [code, messages] of [
      ["en", en],
      ["fr", fr],
    ] as const) {
      const all = strings(messages);
      const quoted = formatPlanMoney(price, code);
      assert.ok(
        all.some((s) => s.includes(quoted)),
        `${code} must quote ${quoted}`,
      );
      // Any other website-service amount would put a displayed price ahead of the charged one.
      assert.deepEqual(
        all.filter((s) => /349[.,]99/.test(s)),
        [],
        `${code} still quotes the retired website price`,
      );
    }
  });

  it("charges the same one-time setup on both launch plans", () => {
    assert.equal(PLAN_PRICES.essential.setup, PLAN_PRICES.professional.setup);
  });

  it("keeps the retired plans' prices so existing customers bill correctly", () => {
    assert.deepEqual(PLAN_PRICES.starter, { setup: 799.99, monthly: 349.99 });
    assert.deepEqual(PLAN_PRICES.growth, { setup: 1499.99, monthly: 649.99 });
    assert.deepEqual(PLAN_PRICES.receptionist, { setup: 1999.99, monthly: 949.99 });
  });

  it("formats Canadian dollars per locale", () => {
    assert.equal(formatPlanMoney(1999.99, "en"), "$1,999.99");
    assert.equal(formatPlanMoney(349.99, "en"), "$349.99");
    // Québec French groups with a non-breaking space and puts $ last.
    assert.equal(formatPlanMoney(1999.99, "fr"), "1 999,99 $");
    assert.equal(formatPlanMoney(999.99, "fr"), "999,99 $");
  });

  it("writes whole amounts without cents and the rest with two decimals", () => {
    assert.equal(formatPlanPrice(249, "en"), "$249");
    assert.equal(formatPlanPrice(349, "en"), "$349");
    assert.equal(formatPlanPrice(1999.99, "en"), "$1,999.99");
    assert.equal(formatPlanPrice(349.99, "en"), "$349.99");
    assert.equal(formatPlanPrice(249, "fr"), "249 $");
    assert.equal(formatPlanPrice(349.99, "fr"), "349,99 $");
  });

  for (const [code, messages] of [
    ["en", en],
    ["fr", fr],
  ] as const) {
    it(`${code}: pricing page tiers match the source of truth`, () => {
      const tiers = pricingTiers(messages);
      assert.equal(tiers.length, ORDER.length);
      ORDER.forEach((id, i) => {
        const tier = tiers[i]!;
        const setup = formatPlanPrice(PLAN_PRICES[id].setup, code);
        const monthly = formatPlanPrice(PLAN_PRICES[id].monthly, code);
        assert.equal(tier.setupAmount, setup, `${id} setup`);
        assert.equal(tier.monthlyAmount, monthly, `${id} monthly`);
        assert.ok(tier.price.includes(setup), `${id} price line`);
        assert.ok(tier.cadence.includes(monthly), `${id} cadence line`);
      });
    });

    it(`${code}: home plan ladder matches the source of truth`, () => {
      const tiers = messages.home.pricingPreview.tiers as Tier[];
      assert.equal(tiers.length, ORDER.length);
      ORDER.forEach((id, i) => {
        assert.ok(
          tiers[i]!.price.includes(formatPlanPrice(PLAN_PRICES[id].monthly, code)),
          `${id} monthly`,
        );
        assert.ok(
          tiers[i]!.cadence.includes(formatPlanPrice(PLAN_PRICES[id].setup, code)),
          `${id} setup`,
        );
      });
    });

    it(`${code}: the one-pager quotes the same prices`, () => {
      const summary = messages.onePager.pricing;
      for (const id of ORDER) {
        assert.ok(
          summary.includes(formatPlanPrice(PLAN_PRICES[id].setup, code)),
          `${id} setup in one-pager`,
        );
        assert.ok(
          summary.includes(formatPlanPrice(PLAN_PRICES[id].monthly, code)),
          `${id} monthly in one-pager`,
        );
      }
    });

    it(`${code}: the step-up line states the real difference`, () => {
      const tiers = pricingTiers(messages);
      assert.equal(tiers[0]!.stepUp, undefined);
      const monthlyDifference = PLAN_PRICES.professional.monthly - PLAN_PRICES.essential.monthly;
      assert.ok(tiers[1]!.stepUp!.includes(formatPlanPrice(monthlyDifference, code)));
    });

    it(`${code}: the website service is quoted at the catalog price everywhere`, () => {
      const price = formatPlanPrice(ADD_ONS.websiteService.priceCad, code);
      assert.ok(messages.plans.addOns.websiteService.price.includes(price), "add-on card");
      assert.ok(messages.pricing.websiteMention.includes(price), "per-plan mention");
      assert.ok(!/starting at|à partir de/i.test(messages.plans.addOns.websiteService.price));
    });

    it(`${code}: billing wording says when the first monthly charge happens`, () => {
      const banner = messages.pricing.billingBanner;
      assert.ok(/one month|un mois/i.test(banner), banner);
      for (const tier of messages.pricing.tiers) {
        assert.ok(/one month|un mois/i.test(tier.reassuranceLine!), tier.name);
      }
    });
  }

  it("computes how long one job covers a monthly fee", () => {
    assert.equal(
      Math.round(monthsCovered(1500, PLAN_PRICES.essential.monthly) * 10) / 10,
      6,
    );
    assert.equal(
      Math.round(monthsCovered(1500, PLAN_PRICES.professional.monthly) * 10) / 10,
      4.3,
    );
  });

  it("reads amounts typed in English and French formats", () => {
    assert.equal(parseMoneyInput("1500"), 1500);
    assert.equal(parseMoneyInput("1,500"), 1500);
    assert.equal(parseMoneyInput("1 500"), 1500);
    assert.equal(parseMoneyInput("1 500 $"), 1500);
    assert.equal(parseMoneyInput("$1,500.50"), 1500.5);
    assert.equal(parseMoneyInput("1 500,50"), 1500.5);
    assert.equal(parseMoneyInput("1500,5"), 1500.5);
    assert.equal(parseMoneyInput("2.75"), 2.75);
  });

  it("rejects anything that is not a usable amount", () => {
    for (const bad of ["", "0", "-5", "abc", "12e3", "1,5,0", "1500.555", "1000001", "1,000,001"]) {
      assert.equal(parseMoneyInput(bad), null, JSON.stringify(bad));
    }
  });
});
