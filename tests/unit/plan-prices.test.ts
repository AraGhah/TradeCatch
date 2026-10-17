import assert from "node:assert/strict";
import { describe, it } from "node:test";
import en from "../../src/messages/en.json";
import fr from "../../src/messages/fr.json";
import {
  PLAN_PRICES,
  formatPlanMoney,
  monthsCovered,
  parseMoneyInput,
} from "../../src/lib/plans";

type Tier = {
  name: string;
  price: string;
  cadence: string;
  setupAmount?: string;
  monthlyAmount?: string;
};

const ORDER = ["starter", "growth", "receptionist"] as const;

function pricingTiers(messages: typeof en | typeof fr): Tier[] {
  return messages.pricing.tiers as Tier[];
}

describe("plan prices", () => {
  it("uses the agreed prices", () => {
    assert.deepEqual(PLAN_PRICES, {
      starter: { setup: 799.99, monthly: 349.99 },
      growth: { setup: 1499.99, monthly: 749.99 },
      receptionist: { setup: 1999.99, monthly: 999.99 },
    });
  });

  it("formats Canadian dollars per locale", () => {
    assert.equal(formatPlanMoney(1999.99, "en"), "$1,999.99");
    assert.equal(formatPlanMoney(349.99, "en"), "$349.99");
    // Québec French groups with a non-breaking space and puts $ last.
    assert.equal(formatPlanMoney(1999.99, "fr"), "1 999,99 $");
    assert.equal(formatPlanMoney(999.99, "fr"), "999,99 $");
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
        const setup = formatPlanMoney(PLAN_PRICES[id].setup, code);
        const monthly = formatPlanMoney(PLAN_PRICES[id].monthly, code);
        assert.equal(tier.setupAmount, setup, `${id} setup`);
        assert.equal(tier.monthlyAmount, monthly, `${id} monthly`);
        assert.ok(tier.price.includes(setup), `${id} price line`);
        assert.ok(tier.cadence.includes(monthly), `${id} cadence line`);
      });
    });

    it(`${code}: home plan ladder matches the source of truth`, () => {
      const tiers = messages.home.pricingPreview.tiers as Tier[];
      ORDER.forEach((id, i) => {
        assert.ok(
          tiers[i]!.price.includes(
            formatPlanMoney(PLAN_PRICES[id].monthly, code),
          ),
          `${id} monthly`,
        );
        assert.ok(
          tiers[i]!.cadence.includes(
            formatPlanMoney(PLAN_PRICES[id].setup, code),
          ),
          `${id} setup`,
        );
      });
    });

    it(`${code}: one-pager, FAQ-style summary and receptionist page quote the same prices`, () => {
      const summary = messages.onePager.pricing;
      const receptionist = messages.aiReceptionist;
      for (const id of ORDER) {
        assert.ok(
          summary.includes(formatPlanMoney(PLAN_PRICES[id].setup, code)),
          `${id} setup in one-pager`,
        );
        assert.ok(
          summary.includes(formatPlanMoney(PLAN_PRICES[id].monthly, code, 2)),
          `${id} monthly in one-pager`,
        );
      }
      assert.ok(
        receptionist.planSetup.includes(
          formatPlanMoney(PLAN_PRICES.receptionist.setup, code),
        ),
      );
      assert.ok(
        receptionist.planCadence.includes(
          formatPlanMoney(PLAN_PRICES.receptionist.monthly, code),
        ),
      );
      assert.ok(
        receptionist.eyebrow.includes(
          formatPlanMoney(PLAN_PRICES.receptionist.setup, code),
        ),
      );
    });

    it(`${code}: step-up lines state the real differences`, () => {
      const tiers = messages.pricing.tiers as (Tier & { stepUp?: string })[];
      const growthMonthly = PLAN_PRICES.growth.monthly - PLAN_PRICES.starter.monthly;
      const growthSetup = PLAN_PRICES.growth.setup - PLAN_PRICES.starter.setup;
      const phoneMonthly =
        PLAN_PRICES.receptionist.monthly - PLAN_PRICES.growth.monthly;
      const phoneSetup =
        PLAN_PRICES.receptionist.setup - PLAN_PRICES.growth.setup;
      assert.equal(tiers[0]!.stepUp, undefined);
      assert.ok(tiers[1]!.stepUp!.includes(formatPlanMoney(growthMonthly, code)));
      assert.ok(tiers[1]!.stepUp!.includes(formatPlanMoney(growthSetup, code)));
      assert.ok(tiers[2]!.stepUp!.includes(formatPlanMoney(phoneMonthly, code)));
      assert.ok(tiers[2]!.stepUp!.includes(formatPlanMoney(phoneSetup, code)));
    });
  }

  it("computes how long one job covers a monthly fee", () => {
    assert.equal(
      Math.round(monthsCovered(1500, PLAN_PRICES.starter.monthly) * 10) / 10,
      4.3,
    );
    assert.equal(
      Math.round(monthsCovered(1500, PLAN_PRICES.receptionist.monthly) * 10) / 10,
      1.5,
    );
  });

  it("reads amounts typed in English and French formats", () => {
    assert.equal(parseMoneyInput("1500"), 1500);
    assert.equal(parseMoneyInput("1,500"), 1500);
    assert.equal(parseMoneyInput("1 500"), 1500);
    assert.equal(parseMoneyInput("1 500 $"), 1500);
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
