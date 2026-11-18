/**
 * KAN-18: the read-only Stripe/plan audit. The "live as found" cases reproduce
 * the real defects found in the live account on 2026-11-18 (monthly Prices of
 * $249.99 / $349.99 instead of $249 / $349, a webhook endpoint without
 * checkout.session.completed, a misspelt secret name), so the tool is proven to
 * catch them.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  REQUIRED_WEBHOOK_EVENTS,
  auditEnvironment,
  auditPortal,
  auditPrices,
  auditSubscriptions,
  auditVariableNames,
  auditWebhookEndpoints,
  formatReport,
  hasErrors,
  installPriceVariable,
  planPriceVariable,
  priceToPlan,
  websitePriceVariable,
  type Finding,
  type PriceView,
} from "../../src/product/saas/stripe-plan-audit";
import { PLAN_IDS } from "../../src/product/saas/entitlements";

const ids = {
  essential: "price_essMonthly",
  professional: "price_proMonthly",
  essentialSetup: "price_essSetup",
  professionalSetup: "price_proSetup",
  website: "price_website",
};

function env(live: boolean, overrides: Record<string, string | undefined> = {}) {
  return {
    [`STRIPE_${live ? "" : "TEST_"}SECRET_KEY`]: live ? "sk_live_x" : "sk_test_x",
    [`STRIPE_${live ? "" : "TEST_"}WEBHOOK_SECRET`]: "whsec_x",
    [planPriceVariable("essential", live)]: ids.essential,
    [planPriceVariable("professional", live)]: ids.professional,
    [installPriceVariable("essential", live)]: ids.essentialSetup,
    [installPriceVariable("professional", live)]: ids.professionalSetup,
    [websitePriceVariable(live)]: ids.website,
    [planPriceVariable("starter", live)]: "price_oldStarter",
    [planPriceVariable("growth", live)]: "price_oldGrowth",
    [planPriceVariable("receptionist", live)]: "price_oldReceptionist",
    ...overrides,
  } as Record<string, string | undefined>;
}

const monthly = (id: string, amount: number, live: boolean, extra: Partial<PriceView> = {}): PriceView => ({
  id,
  active: true,
  livemode: live,
  currency: "cad",
  unit_amount: amount,
  recurring: { interval: "month" },
  ...extra,
});
const oneTime = (id: string, amount: number, live: boolean, extra: Partial<PriceView> = {}): PriceView =>
  monthly(id, amount, live, { recurring: null, ...extra });

function healthyPrices(live: boolean) {
  return new Map<string, PriceView | null>([
    [ids.essential, monthly(ids.essential, 24900, live)],
    [ids.professional, monthly(ids.professional, 34900, live)],
    [ids.essentialSetup, oneTime(ids.essentialSetup, 199999, live)],
    [ids.professionalSetup, oneTime(ids.professionalSetup, 199999, live)],
    [ids.website, oneTime(ids.website, 69999, live)],
  ]);
}

const errors = (findings: Finding[]) => findings.filter((f) => f.severity === "error");
const codes = (findings: Finding[]) => errors(findings).map((f) => f.code);

describe("billing audit: a correct setup", () => {
  for (const live of [false, true]) {
    it(`passes in ${live ? "live" : "test"} mode`, () => {
      const findings = [...auditEnvironment(env(live), live), ...auditPrices(env(live), live, healthyPrices(live))];
      assert.deepEqual(errors(findings), []);
      assert.equal(findings.filter((f) => f.code === "price-ok").length, 5);
    });
  }
});

describe("billing audit: prices that disagree with the catalog", () => {
  it("catches the live account as found: monthly Prices of $249.99 and $349.99", () => {
    const prices = healthyPrices(true);
    prices.set(ids.essential, monthly(ids.essential, 24999, true));
    prices.set(ids.professional, monthly(ids.professional, 34999, true));
    const findings = auditPrices(env(true), true, prices);
    assert.deepEqual(codes(findings), ["price-mismatch", "price-mismatch"]);
    const message = errors(findings)[0]!.message;
    assert.match(message, /\$249\.99/);
    assert.match(message, /\$249\.00/);
    assert.match(message, /cannot be edited/i, "tells the owner a new Price is needed, not an edit");
    assert.match(message, /stripe-setup-plan-prices/);
    assert.match(message, /Existing subscriptions keep their old Price/i);
  });

  it("catches a wrong setup fee, archived, wrong-mode, wrong-currency and wrong-interval Prices", () => {
    const prices = healthyPrices(false);
    prices.set(ids.essentialSetup, oneTime(ids.essentialSetup, 79999, false));
    prices.set(ids.professionalSetup, oneTime(ids.professionalSetup, 199999, false, { active: false }));
    prices.set(ids.essential, monthly(ids.essential, 24900, true)); // a live Price used in test mode
    prices.set(ids.professional, monthly(ids.professional, 34900, false, { currency: "usd" }));
    prices.set(ids.website, monthly(ids.website, 69999, false)); // recurring, but one-time expected
    const findings = errors(auditPrices(env(false), false, prices));
    assert.equal(findings.length, 5);
    const text = findings.map((f) => f.message).join("\n");
    assert.match(text, /archived/);
    assert.match(text, /live mode/);
    assert.match(text, /USD, not CAD/);
    assert.match(text, /one-time/);
    assert.match(text, /\$799\.99/);
  });

  it("catches a Price that is not monthly or has an interval count of more than one", () => {
    const prices = healthyPrices(false);
    prices.set(ids.essential, monthly(ids.essential, 24900, false, { recurring: { interval: "year" } }));
    prices.set(ids.professional, monthly(ids.professional, 34900, false, { recurring: { interval: "month", interval_count: 3 } }));
    assert.deepEqual(codes(auditPrices(env(false), false, prices)), ["price-mismatch", "price-mismatch"]);
  });

  it("catches a configured Price id that does not exist in the account", () => {
    const prices = healthyPrices(true);
    prices.set(ids.essential, null);
    const findings = auditPrices(env(true), true, prices);
    assert.deepEqual(codes(findings), ["price-not-found"]);
  });
});

describe("billing audit: environment", () => {
  it("reports every missing required variable by name and never prints a value", () => {
    const findings = auditEnvironment({}, true);
    const text = formatReport(findings);
    for (const name of [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PRICE_ESSENTIAL",
      "STRIPE_PRICE_PROFESSIONAL",
      "STRIPE_PRICE_INSTALL_ESSENTIAL",
      "STRIPE_PRICE_INSTALL_PROFESSIONAL",
    ]) {
      assert.match(text, new RegExp(`${name} is not set`), name);
    }
    assert.equal(hasErrors(findings), true);
  });

  it("rejects a key of the wrong mode without echoing it", () => {
    const findings = auditEnvironment(env(true, { STRIPE_SECRET_KEY: "sk_test_SECRETVALUE" }), true);
    assert.deepEqual(codes(findings), ["env-wrong-mode"]);
    assert.doesNotMatch(formatReport(findings), /SECRETVALUE/);
  });

  it("catches the misspelt webhook secret found on the live Worker", () => {
    const names = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SEKRET", "STRIPE_PRICE_ESSENTIAL", "NODE_ENV"];
    const findings = auditVariableNames(names);
    assert.deepEqual(codes(findings), ["env-typo"]);
    assert.match(findings[0]!.message, /STRIPE_WEBHOOK_SEKRET/);
    assert.match(findings[0]!.message, /STRIPE_WEBHOOK_SECRET/);
  });

  it("does not flag variables the application really reads, or unrelated names", () => {
    assert.deepEqual(auditVariableNames([...Object.keys(env(true)), ...Object.keys(env(false)), "STRIPE_BILLING_TEST_DATABASE_URL", "NODE_ENV"]), []);
  });

  it("refuses one Price id configured for two plans, as the webhook does", () => {
    const duplicated = env(false, { [planPriceVariable("professional", false)]: ids.essential });
    assert.ok(codes(auditEnvironment(duplicated, false)).includes("price-mapped-twice"));
  });

  it("legacy Prices are optional but flagged, so an unmapped old subscription is not a surprise", () => {
    const without = env(true);
    delete without[planPriceVariable("growth", true)];
    const warn = auditEnvironment(without, true).filter((f) => f.code === "legacy-price-unmapped");
    assert.equal(warn.length, 1);
    assert.equal(warn[0]!.severity, "warn");
    assert.equal(hasErrors(auditEnvironment(without, true)), false);
  });

  it("every plan id is covered by the mapping", () => {
    const { map } = priceToPlan(env(false), false);
    assert.deepEqual([...new Set(map.values())].sort(), [...PLAN_IDS].sort());
  });
});

describe("billing audit: webhook endpoint", () => {
  const url = "https://tradecatch.ca/api/webhooks/stripe";
  const everything = [...REQUIRED_WEBHOOK_EVENTS, "charge.refunded", "charge.dispute.created"];

  it("passes when every event the application acts on is subscribed", () => {
    const findings = auditWebhookEndpoints([{ url, status: "enabled", enabled_events: everything }]);
    assert.deepEqual(findings.map((f) => f.code), ["webhook-ok"]);
  });

  it("accepts a wildcard subscription", () => {
    assert.equal(hasErrors(auditWebhookEndpoints([{ url, status: "enabled", enabled_events: ["*"] }])), false);
  });

  it("catches the live endpoint as found: no checkout.session.completed and no invoice.payment_failed", () => {
    const live = everything.filter((e) => !["checkout.session.completed", "invoice.payment_failed", "charge.refunded", "charge.dispute.created"].includes(e));
    const findings = auditWebhookEndpoints([{ url, status: "enabled", enabled_events: live }], "tradecatch.ca");
    assert.deepEqual(codes(findings), ["webhook-event-missing", "webhook-event-missing"]);
    const text = findings.map((f) => f.message).join("\n");
    assert.match(text, /checkout\.session\.completed[^]*never get their monthly subscription/);
    assert.match(text, /invoice\.payment_failed/);
    assert.equal(findings.filter((f) => f.severity === "warn").length, 2, "the referral events only warn");
  });

  it("fails when there is no endpoint, it is disabled, or it points at another path or host", () => {
    assert.deepEqual(codes(auditWebhookEndpoints([])), ["webhook-missing"]);
    assert.deepEqual(codes(auditWebhookEndpoints([{ url, status: "disabled", enabled_events: everything }])), ["webhook-disabled"]);
    assert.deepEqual(codes(auditWebhookEndpoints([{ url: "https://tradecatch.ca/api/other", status: "enabled", enabled_events: everything }])), ["webhook-missing"]);
    assert.deepEqual(codes(auditWebhookEndpoints([{ url, status: "enabled", enabled_events: everything }], "staging.tradecatch.ca")), ["webhook-missing"]);
  });

  it("requires exactly the events the webhook route handles", () => {
    for (const event of [
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.paid",
      "invoice.payment_failed",
      "checkout.session.completed",
    ]) {
      assert.ok(REQUIRED_WEBHOOK_EVENTS.includes(event), event);
    }
  });
});

describe("billing audit: subscriptions and portal", () => {
  const { map } = priceToPlan(env(true), true);

  it("every existing subscription Price maps to a plan, so legacy customers keep syncing", () => {
    const findings = auditSubscriptions(
      [
        { priceIds: ["price_oldGrowth"], status: "active", count: 3 },
        { priceIds: [ids.professional], status: "trialing", count: 1 },
      ],
      map,
    );
    assert.deepEqual(findings.map((f) => f.code), ["subscriptions-ok"]);
    assert.match(findings[0]!.message, /4 Stripe subscription/);
  });

  it("a subscription on an unconfigured Price is an error: the webhook would 503 for it", () => {
    const findings = auditSubscriptions([{ priceIds: ["price_unknown"], status: "active", count: 2 }], map);
    assert.deepEqual(codes(findings), ["subscription-price-unmapped"]);
    assert.match(findings[0]!.message, /2 active/);
  });

  it("an empty account is fine", () => {
    assert.equal(hasErrors(auditSubscriptions([], map)), false);
  });

  it("warns, but does not fail, when customers cannot change plan in the portal", () => {
    const findings = auditPortal([{ active: true, subscription_update_enabled: false, subscription_cancel_enabled: true }]);
    assert.deepEqual(findings.map((f) => f.code), ["portal-no-plan-change"]);
    assert.equal(hasErrors(findings), false);
    assert.deepEqual(auditPortal([{ active: true, subscription_update_enabled: true, subscription_cancel_enabled: true }]), []);
  });
});

describe("billing audit command: structurally read-only", () => {
  const source = readFileSync(path.join(process.cwd(), "scripts", "audit-stripe-plans.ts"), "utf8");

  it("sends only GET requests", () => {
    assert.match(source, /method: "GET"/);
    assert.doesNotMatch(source, /method:\s*["'](POST|PUT|PATCH|DELETE)["']/i);
    assert.equal((source.match(/fetch\(/g) ?? []).length, 1, "one fetch call, inside the GET-only helper");
  });

  it("never prints the key or implicitly loads an env file", () => {
    // The key may only appear in the Authorization header, never on a console line.
    const leaking = source
      .split(/\r?\n/)
      .filter((line) => /console\./.test(line) && /\$\{key\b|\(\s*key\s*\)|,\s*key\b|\+\s*key\b|Bearer|SECRET_KEY/.test(line));
    assert.deepEqual(leaking, []);
    assert.equal((source.match(/Bearer/g) ?? []).length, 1);
    // Prose in the header comment may name .env.local; no code may load an env file by itself.
    assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//, ""), /loadEnvConfig|dotenv|\.env\.local/);
  });
});
