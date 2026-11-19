/**
 * KAN-18: the website, the dashboard, the backend and Stripe describe the same
 * two plans. One describe block per acceptance group; every test name starts
 * with its PLAN-nn id so a failure points straight at the criterion.
 *
 *   PLAN-01  Essential: name, price, features
 *   PLAN-02  Professional: name, price, features
 *   PLAN-03  Dashboard shows the plan the customer actually has
 *   PLAN-04  Website and dashboard say the same thing
 *   PLAN-05  Legacy subscriptions map to a public name, no billing change
 *   PLAN-06  Stripe webhook synchronizes the subscription
 *   PLAN-07  Upgrade and downgrade move entitlements and the Stripe mapping
 *   PLAN-08  Subscription information survives refresh and re-login
 *   PLAN-09  No retired plan label anywhere customer-facing
 *   PLAN-10  The Professional calendar is only for eligible subscribers
 *   PLAN-11  Canceled and expired subscriptions: status and access
 *   PLAN-12  Concurrent webhook events: no duplicate charge, consistent state
 *
 * The webhook tests (06, 07, 08, 11, 12) run the REAL billing SQL on PGlite, an
 * in-process PostgreSQL. PGlite has one connection, so true cross-connection
 * lock contention is exercised by the CI-only suite in stripe-billing.test.ts.
 * Stripe is faked at fetch; the fake records every call so tests can prove the
 * sync only ever READS from Stripe (it can never charge or change a price).
 */
import "../support/next-request-context";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import en from "../../src/messages/en.json";
import fr from "../../src/messages/fr.json";
import { withRequest } from "../support/next-request-context";
import { createPglite, pgliteAvailable, poolOf, type PgliteDb } from "../support/pglite-pool";
import { GET as bookingsGET } from "../../src/app/api/app/bookings/route";
import { POST as stripeWebhook } from "../../src/app/api/webhooks/stripe/route";
import { LEGACY_PLAN_PUBLIC_NAME, PUBLIC_PLAN_NAMES, planDisplayName, planNameOrNull, publicPlanFor } from "../../src/lib/plan-names";
import { comparisonRowsFromCatalog } from "../../src/lib/plan-marketing";
import { PLAN_PRICES, formatPlanPrice } from "../../src/lib/plans";
import { setPgPoolForTests } from "../../src/product/missed-call/postgres-store";
import { signSessionClaims } from "../../src/product/saas/auth/session-token";
import {
  getSubscriptionSummary,
  subscriptionStatusKind,
  type SubscriptionSummary,
} from "../../src/product/saas/billing-summary";
import { billingPlanCard } from "../../src/product/saas/billing-view";
import {
  LEGACY_PLAN_IDS,
  PLAN_DISPLAY_NAMES,
  PLAN_FEATURES,
  PLAN_IDS,
  PUBLIC_PLAN_IDS,
  orgHasFeature,
  soldPlanWith,
  type FeatureId,
  type PlanId,
} from "../../src/product/saas/entitlements";
import { createMemorySaasStore } from "../../src/product/saas/memory-store";
import {
  CAPABILITIES,
  PLAN_CATALOG,
  describePlan,
  getCapability,
} from "../../src/product/saas/plan-catalog";
import type { SaasStore } from "../../src/product/saas/store";

const LANGS = [
  ["en", en],
  ["fr", fr],
] as const;

const APPOINTMENT_CAPABILITIES = CAPABILITIES.filter((c) => c.group === "appointments").map(
  (c) => c.id,
);

/* -------------------------------------------------------------------------- */
/* PLAN-01 / PLAN-02: the two plans                                           */
/* -------------------------------------------------------------------------- */

describe("PLAN-01 Essential plan", () => {
  const view = describePlan("essential");

  it("PLAN-01 is named Essential and is not a legacy plan", () => {
    assert.equal(view.name, "Essential");
    assert.equal(view.publicId, "essential");
    assert.equal(view.legacy, false);
  });

  it("PLAN-01 costs $249.99 a month and $1,999.99 to set up, in CAD", () => {
    assert.deepEqual(view.price, { monthly: 249.99, setup: 1999.99 });
    for (const [lang, messages] of LANGS) {
      const tier = messages.pricing.tiers[0]!;
      assert.equal(tier.name, "Essential", lang);
      assert.equal(tier.monthlyAmount, formatPlanPrice(249.99, lang), lang);
      assert.equal(tier.setupAmount, formatPlanPrice(1999.99, lang), lang);
    }
    assert.equal(formatPlanPrice(249.99, "en"), "$249.99");
    assert.equal(formatPlanPrice(1999.99, "en"), "$1,999.99");
  });

  it("PLAN-01 answers calls and captures customers, with no appointment features", () => {
    for (const id of ["answersCalls", "missedCalls", "dashboard", "callHistory", "billingManagement"] as const) {
      assert.ok(view.capabilityIds.includes(id), `Essential includes ${id}`);
    }
    for (const id of APPOINTMENT_CAPABILITIES) {
      assert.equal(view.capabilityIds.includes(id), false, `Essential must not include ${id}`);
    }
  });
});

describe("PLAN-02 Professional plan", () => {
  const view = describePlan("professional");
  const essential = describePlan("essential");

  it("PLAN-02 is named Professional and is not a legacy plan", () => {
    assert.equal(view.name, "Professional");
    assert.equal(view.publicId, "professional");
    assert.equal(view.legacy, false);
  });

  it("PLAN-02 costs $349.99 a month and $1,999.99 to set up, in CAD", () => {
    assert.deepEqual(view.price, { monthly: 349.99, setup: 1999.99 });
    for (const [lang, messages] of LANGS) {
      const tier = messages.pricing.tiers[1]!;
      assert.equal(tier.name, "Professional", lang);
      assert.equal(tier.monthlyAmount, formatPlanPrice(349.99, lang), lang);
      assert.equal(tier.setupAmount, formatPlanPrice(1999.99, lang), lang);
    }
  });

  it("PLAN-02 includes everything in Essential plus every appointment and calendar feature", () => {
    for (const id of essential.capabilityIds) {
      assert.ok(view.capabilityIds.includes(id), `Professional keeps Essential's ${id}`);
    }
    assert.ok(APPOINTMENT_CAPABILITIES.length >= 8);
    for (const id of APPOINTMENT_CAPABILITIES) {
      assert.ok(view.capabilityIds.includes(id), `Professional includes ${id}`);
    }
    assert.ok(view.capabilityIds.includes("googleCalendar"));
    assert.ok(view.capabilityIds.includes("calendarView"));
  });
});

/* -------------------------------------------------------------------------- */
/* PLAN-04: website and dashboard agree                                       */
/* -------------------------------------------------------------------------- */

describe("PLAN-04 website and dashboard match", () => {
  it("PLAN-04 the dashboard lists exactly the capabilities the website comparison table marks included", () => {
    const rows = comparisonRowsFromCatalog();
    PUBLIC_PLAN_IDS.forEach((plan, column) => {
      const onWebsite = rows.filter((row) => row.values[column] === "y").map((row) => row.capabilityId);
      assert.deepEqual(
        [...describePlan(plan).capabilityIds].sort(),
        [...onWebsite].sort(),
        `${plan}: dashboard and website capability lists differ`,
      );
    });
  });

  it("PLAN-04 every pricing card line is something the dashboard says the plan includes", () => {
    for (const plan of PUBLIC_PLAN_IDS) {
      const dashboard = new Set(describePlan(plan).capabilityIds);
      for (const id of PLAN_CATALOG[plan].cardCapabilities) {
        assert.ok(dashboard.has(id), `${plan} card shows ${id} but the dashboard does not list it`);
      }
    }
  });

  it("PLAN-04 name and price strings are identical on the pricing page, the home page and the dashboard", () => {
    for (const [lang, messages] of LANGS) {
      PUBLIC_PLAN_IDS.forEach((plan, index) => {
        const view = describePlan(plan);
        const monthly = formatPlanPrice(view.price!.monthly, lang);
        const setup = formatPlanPrice(view.price!.setup, lang);
        const pricing = messages.pricing.tiers[index]!;
        const home = messages.home.pricingPreview.tiers[index]!;
        assert.equal(pricing.name, view.name, `${lang} pricing name`);
        assert.equal(home.name, view.name, `${lang} home name`);
        assert.equal(messages.plans.names[plan], view.name, `${lang} plans.names`);
        assert.equal(pricing.monthlyAmount, monthly, `${lang} ${plan} pricing monthly`);
        assert.ok(home.price.includes(monthly), `${lang} ${plan} home monthly`);
        assert.equal(pricing.setupAmount, setup, `${lang} ${plan} pricing setup`);
        // The dashboard prints its amounts with the same whole-dollar formatter as the website.
        assert.equal(formatPlanPrice(view.price!.monthly, lang), monthly);
      });
    }
  });

  it("PLAN-04 the one public plan-name source covers both languages", () => {
    for (const [lang, messages] of LANGS) {
      assert.deepEqual(Object.keys(messages.plans.names).sort(), ["essential", "professional"], lang);
      for (const plan of PUBLIC_PLAN_IDS) {
        assert.equal(messages.plans.names[plan], PUBLIC_PLAN_NAMES[plan], `${lang} ${plan}`);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* PLAN-05: legacy plans                                                      */
/* -------------------------------------------------------------------------- */

describe("PLAN-05 legacy plans keep working under a public name", () => {
  const STARTER: FeatureId[] = [
    "MISSED_CALL_RECOVERY",
    "WEBSITE_LEAD_CAPTURE",
    "QUOTE_FOLLOW_UP",
    "HUMAN_TAKEOVER",
    "BUSINESS_NOTIFICATIONS",
    "BASIC_ANALYTICS",
  ];
  const GROWTH: FeatureId[] = [
    ...STARTER,
    "APPOINTMENT_BOOKING",
    "ADVANCED_PIPELINE",
    "REVENUE_ATTRIBUTION",
    "REVIEW_AUTOMATION",
    "ADVANCED_ANALYTICS",
    "EMAIL_AUTOMATION",
    "AI_RECEPTIONIST_VOICE",
    "CRM_INTEGRATION_LIMITED",
  ];
  const RECEPTIONIST: FeatureId[] = [
    ...GROWTH,
    "AI_PHONE_BOOKING",
    "AI_CALL_TRANSFER",
    "AI_EMERGENCY_ROUTING",
    "AI_CALL_TRANSCRIPTS",
    "AI_CUSTOM_VOICE",
    "CRM_INTEGRATION_ADVANCED",
    "ADVANCED_CALL_ROUTING",
    "MULTI_CREW_CALENDARS",
    "CUSTOMER_REACTIVATION",
    "CONTRACT_RENEWAL_AUTOMATION",
    "ADVANCED_REVENUE_ANALYTICS",
    "ADVANCED_AUTOMATION_WORKFLOWS",
  ];

  it("PLAN-05 every internal plan id has a public name, and only Essential or Professional is ever shown", () => {
    assert.deepEqual([...PLAN_IDS].sort(), [...PUBLIC_PLAN_IDS, ...LEGACY_PLAN_IDS].sort());
    for (const id of PLAN_IDS) {
      assert.match(planDisplayName(id), /^(Essential|Professional)$/, id);
      assert.equal(PLAN_DISPLAY_NAMES[id], planDisplayName(id), id);
      assert.equal(planNameOrNull(id), planDisplayName(id), id);
    }
    assert.deepEqual(LEGACY_PLAN_PUBLIC_NAME, {
      starter: "essential",
      growth: "professional",
      receptionist: "professional",
    });
    assert.equal(planNameOrNull("platinum"), null, "an unknown id gets no guessed name");
    assert.equal(publicPlanFor("essential"), "essential");
    assert.equal(publicPlanFor("professional"), "professional");
  });

  it("PLAN-05 relabelling grants and removes nothing: the legacy entitlement grants are exactly as sold", () => {
    assert.deepEqual([...PLAN_FEATURES.starter].sort(), [...STARTER].sort());
    assert.deepEqual([...PLAN_FEATURES.growth].sort(), [...GROWTH].sort());
    assert.deepEqual([...PLAN_FEATURES.receptionist].sort(), [...RECEPTIONIST].sort());
  });

  it("PLAN-05 a legacy plan shows what it really has, never the public plan's list, and no catalog price", () => {
    for (const id of LEGACY_PLAN_IDS) {
      const view = describePlan(id);
      assert.equal(view.legacy, true, id);
      assert.equal(view.price, null, `${id} must not be given the catalog price of the plan it is labelled with`);
      for (const capabilityId of view.capabilityIds) {
        assert.ok(orgHasFeature(id, getCapability(capabilityId).feature), `${id} lists ${capabilityId} without having it`);
      }
    }
    // Growth is labelled Professional but has no phone booking, so it must not list it.
    assert.equal(describePlan("growth").name, "Professional");
    assert.equal(describePlan("growth").capabilityIds.includes("autoScheduling"), false);
    assert.equal(describePlan("starter").name, "Essential");
    assert.equal(describePlan("starter").capabilityIds.includes("answersCalls"), false);
  });

  it("PLAN-05 legacy prices are untouched so existing billing stays correct", () => {
    assert.deepEqual(PLAN_PRICES.starter, { setup: 799.99, monthly: 349.99 });
    assert.deepEqual(PLAN_PRICES.growth, { setup: 1499.99, monthly: 649.99 });
    assert.deepEqual(PLAN_PRICES.receptionist, { setup: 1999.99, monthly: 949.99 });
  });

  it("PLAN-05 upgrade hints only ever point at a plan that is sold", () => {
    assert.equal(soldPlanWith("APPOINTMENT_BOOKING"), "professional");
    assert.equal(soldPlanWith("AI_PHONE_BOOKING"), "professional");
    assert.equal(soldPlanWith("AI_RECEPTIONIST_VOICE"), "essential");
    assert.equal(soldPlanWith("AI_CUSTOM_VOICE"), null, "withheld at launch: nothing to upgrade to");
  });
});

/* -------------------------------------------------------------------------- */
/* PLAN-09: no retired labels                                                 */
/* -------------------------------------------------------------------------- */

describe("PLAN-09 no retired plan label in customer-facing UI", () => {
  const RETIRED = /\b(Growth|Starter|Receptionist Plus|Réceptionniste Plus)\b/;

  function leaves(node: unknown, at: string, out: [string, string][]) {
    if (typeof node === "string") out.push([at, node]);
    else if (Array.isArray(node)) node.forEach((v, i) => leaves(v, `${at}[${i}]`, out));
    else if (node && typeof node === "object")
      for (const [k, v] of Object.entries(node)) leaves(v, at ? `${at}.${k}` : k, out);
  }

  it("PLAN-09 no English or French message names Growth, Starter or Receptionist Plus", () => {
    for (const [lang, messages] of LANGS) {
      const all: [string, string][] = [];
      leaves(messages, "", all);
      const offenders = all.filter(([, text]) => RETIRED.test(text)).map(([key]) => key);
      assert.deepEqual(offenders, [], `${lang} messages still show a retired plan name`);
    }
  });

  it("PLAN-09 no customer-facing source string names a retired plan (operator screens are exempt)", () => {
    const root = path.join(process.cwd(), "src");
    // Operator-only screens and the internal QA catalog label internal ids on purpose.
    const exempt = [
      `${path.sep}admin${path.sep}`,
      `${path.sep}components${path.sep}admin${path.sep}`,
      `${path.sep}product${path.sep}qa${path.sep}`,
      `${path.sep}messages${path.sep}`,
    ];
    const quoted = /["'`][^"'`\n]*\b(Growth|Starter|Receptionist Plus|Réceptionniste Plus)\b[^"'`\n]*["'`]/;
    const offenders: string[] = [];
    for (const entry of readdirSync(root, { recursive: true, encoding: "utf8" })) {
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const file = path.join(root, entry);
      if (exempt.some((part) => file.includes(part))) continue;
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          if (quoted.test(line)) offenders.push(`${entry}:${index + 1}: ${line.trim().slice(0, 100)}`);
        });
    }
    assert.deepEqual(offenders, []);
  });

  it("PLAN-09 the demo video no longer labels a screen with a plan name", () => {
    const timeline = readFileSync(path.join(process.cwd(), "src", "components", "demo-video", "timeline.ts"), "utf8");
    assert.doesNotMatch(timeline, /·\s*Starter/);
  });
});

/* -------------------------------------------------------------------------- */
/* PLAN-10 / PLAN-11 (route level): who can reach the Professional calendar   */
/* -------------------------------------------------------------------------- */

describe("PLAN-10 the Professional calendar is only for eligible subscribers", () => {
  const SECRET = "plan-sync-unit-secret-not-for-production";
  const names = ["AUTH_SECRET", "NODE_ENV"];
  const saved = new Map(names.map((name) => [name, process.env[name]]));
  const runtime = globalThis as typeof globalThis & {
    __tradecatchSaas?: { store: SaasStore; durable: boolean };
  };
  let store: SaasStore;

  beforeEach(() => {
    process.env.AUTH_SECRET = SECRET;
    (process.env as { NODE_ENV?: string }).NODE_ENV = "development";
    store = createMemorySaasStore();
    runtime.__tradecatchSaas = { store, durable: false };
    mock.method(console, "warn", () => {});
    mock.method(console, "error", () => {});
  });
  afterEach(() => {
    mock.restoreAll();
    delete runtime.__tradecatchSaas;
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  async function tenant(plan: PlanId, status: "active" | "suspended" | "churned" = "active") {
    const f = await store.createOrganizationWithOwner({
      name: "Plan fixture",
      ownerName: "Owner",
      ownerEmail: `${crypto.randomUUID()}@example.test`,
    });
    await store.updateOrganizationPlan(f.organization.id, plan);
    if (status !== "active") await store.updateOrganization(f.organization.id, { status });
    const session = {
      id: crypto.randomUUID(),
      organizationId: f.organization.id,
      userId: f.user.id,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    await store.createSession(session);
    const cookie = await signSessionClaims(
      { sid: session.id, uid: f.user.id, oid: f.organization.id, plan, exp: Math.floor(Date.now() / 1000) + 600 },
      SECRET,
    );
    return `tc_session=${cookie}`;
  }

  function getBookings(cookie: string) {
    const request = new NextRequest("https://tradecatch.test/api/app/bookings", { headers: { cookie } });
    return withRequest(request, () => bookingsGET()) as Promise<Response>;
  }

  it("PLAN-10 Essential is refused the calendar and told to move to Professional", async () => {
    const response = await getBookings(await tenant("essential"));
    assert.equal(response.status, 402);
    const body = (await response.json()) as { feature: string; upgrade: string | null };
    assert.equal(body.feature, "APPOINTMENT_BOOKING");
    assert.equal(body.upgrade, "professional");
  });

  it("PLAN-10 Professional reaches the calendar", async () => {
    assert.equal((await getBookings(await tenant("professional"))).status, 200);
  });

  it("PLAN-10 the entitlement rule: only Professional among the sold plans, unchanged for legacy plans", () => {
    assert.equal(orgHasFeature("essential", "APPOINTMENT_BOOKING"), false);
    assert.equal(orgHasFeature("professional", "APPOINTMENT_BOOKING"), true);
    assert.equal(orgHasFeature("starter", "APPOINTMENT_BOOKING"), false);
    assert.equal(orgHasFeature("growth", "APPOINTMENT_BOOKING"), true, "growth was sold with it and keeps it");
    assert.equal(orgHasFeature("receptionist", "APPOINTMENT_BOOKING"), true);
  });

  it("PLAN-10 and PLAN-11 a Professional customer whose subscription has ended is locked out of the calendar", async () => {
    for (const status of ["suspended", "churned"] as const) {
      const response = await getBookings(await tenant("professional", status));
      // The route reports every inactive organization the same way as a lost session.
      assert.ok(response.status === 401 || response.status === 403, `${status}: got ${response.status}`);
      assert.match(((await response.json()) as { error: string }).error, /not active/i, status);
    }
  });
});

describe("PLAN-11 status helper", () => {
  it("PLAN-11 maps every Stripe status to what the customer is told", () => {
    for (const status of ["active", "trialing"]) assert.equal(subscriptionStatusKind(status), "active", status);
    for (const status of ["past_due", "unpaid", "incomplete", "paused"]) {
      assert.equal(subscriptionStatusKind(status), "payment_needed", status);
    }
    for (const status of ["canceled", "incomplete_expired"]) {
      assert.equal(subscriptionStatusKind(status), "canceled", status);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* PLAN-03 / PLAN-11: what the dashboard billing card says in every state     */
/* -------------------------------------------------------------------------- */

describe("PLAN-03 dashboard billing card shows the plan the customer actually has", () => {
  const PERIOD = "2033-05-18T03:33:20.000Z";
  const summary = (over: Partial<SubscriptionSummary> = {}): SubscriptionSummary => ({
    status: "active",
    plan: "professional",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: PERIOD,
    ...over,
  });
  const card = (
    plan: PlanId,
    subscription: SubscriptionSummary | null,
    installation: Parameters<typeof billingPlanCard>[0]["installation"] = null,
  ) =>
    billingPlanCard({
      plan: describePlan(plan),
      subscription,
      installation,
      hasAppointments: orgHasFeature(plan, "APPOINTMENT_BOOKING"),
    });

  it("PLAN-03 an active Professional shows its price, status, next charge and every feature, and offers no second checkout", () => {
    const c = card("professional", summary());
    assert.deepEqual(c.planLine, { kind: "priced", monthly: 349.99 });
    assert.equal(c.status, "active");
    assert.deepEqual(c.date, { kind: "nextCharge", iso: PERIOD });
    assert.equal(c.checkout, null, "a paying customer is never sent to pay the setup fee again");
    assert.equal(c.professionalNote, false);
    assert.deepEqual([...c.featureIds], [...describePlan("professional").capabilityIds]);
    assert.ok(c.featureIds.includes("googleCalendar"));
  });

  it("PLAN-03 an active Essential shows $249.99, no calendar features, and the Professional pointer", () => {
    const c = card("essential", summary({ plan: "essential" }));
    assert.deepEqual(c.planLine, { kind: "priced", monthly: 249.99 });
    assert.equal(c.professionalNote, true);
    assert.equal(c.featureIds.includes("googleCalendar"), false);
    assert.equal(c.featureIds.includes("calendarView"), false);
  });

  it("PLAN-03 trialing counts as active: the first charge is still ahead", () => {
    const c = card("professional", summary({ status: "trialing" }));
    assert.equal(c.status, "active");
    assert.equal(c.date?.kind, "nextCharge");
  });

  it("PLAN-11 a subscription set to end says when, and does not promise a next charge", () => {
    const c = card("professional", summary({ cancelAtPeriodEnd: true }));
    assert.equal(c.status, "active");
    assert.deepEqual(c.date, { kind: "cancelsOn", iso: PERIOD });
  });

  it("PLAN-11 a payment problem and a canceled subscription show no charge date and re-offer checkout", () => {
    for (const [status, kind] of [
      ["past_due", "payment_needed"],
      ["unpaid", "payment_needed"],
      ["canceled", "canceled"],
      ["incomplete_expired", "canceled"],
    ] as const) {
      const c = card("professional", summary({ status }));
      assert.equal(c.status, kind, status);
      assert.equal(c.date, null, status);
      assert.equal(c.checkout, "start", status);
    }
  });

  it("PLAN-03 before Stripe's subscription is recorded, paid setup shows the first-charge date", () => {
    const c = card("professional", null, { status: "subscribed", billingStartAt: PERIOD });
    assert.equal(c.status, null);
    assert.deepEqual(c.date, { kind: "firstChargeOn", iso: PERIOD });
    assert.equal(c.checkout, null);
  });

  it("PLAN-03 no subscription and no setup yet: offer checkout; an open checkout says so instead", () => {
    assert.equal(card("essential", null).checkout, "start");
    assert.equal(card("essential", null, { status: "none", billingStartAt: null }).checkout, "start");
    assert.equal(card("essential", null, { status: "failed", billingStartAt: null }).checkout, "start");
    assert.equal(card("essential", null, { status: "pending", billingStartAt: null }).checkout, "pending");
    assert.equal(card("essential", null, { status: "paid", billingStartAt: null }).checkout, null, "setup paid: nothing more to pay");
  });

  it("PLAN-05 a legacy plan shows its public name and no catalog price, and is never offered the new plans' checkout", () => {
    for (const legacy of LEGACY_PLAN_IDS) {
      const c = card(legacy, summary({ plan: legacy }));
      assert.deepEqual(c.planLine, { kind: "legacy" }, legacy);
      assert.equal(c.checkout, null, legacy);
      const cancelled = card(legacy, summary({ plan: legacy, status: "canceled" }));
      assert.equal(cancelled.checkout, null, `${legacy}: no catalog price, so no checkout at one`);
    }
  });

  it("PLAN-03 every message key the billing and settings cards use exists in both languages", () => {
    const keys = {
      "app.account": [
        "billingPlanLine",
        "billingPlanLineLegacy",
        "billingStatusActive",
        "billingStatusPaymentNeeded",
        "billingStatusCanceled",
        "billingNextCharge",
        "billingCancelsOn",
        "billingFirstChargeOn",
        "billingIncludedTitle",
        "billingComparePlans",
      ],
      "app.settings": ["planMonthly", "planLegacyPrice", "planProfessionalNote"],
    };
    for (const [lang, messages] of LANGS) {
      for (const [namespace, names] of Object.entries(keys)) {
        const [first, second] = namespace.split(".") as [string, string];
        const scope = (messages as unknown as Record<string, Record<string, Record<string, string>>>)[first]![second]!;
        for (const name of names) assert.ok(typeof scope[name] === "string" && scope[name]!.length > 0, `${lang} ${namespace}.${name}`);
      }
      for (const id of CAPABILITIES.map((c) => c.id)) {
        assert.ok(messages.plans.capabilities[id as keyof typeof messages.plans.capabilities]?.label, `${lang} capability ${id}`);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Webhook / sync tests on real SQL                                           */
/* -------------------------------------------------------------------------- */

const ORG = "org_plan_sync";
const CUSTOMER = "cus_plan_sync";
const SIGNING_SECRET = "plan-sync-signing-secret";
const PERIOD_END = 2_000_000_000; // 2033-05-18T03:33:20Z
const PRICE = {
  essential: "price_test_essential",
  professional: "price_test_professional",
  starter: "price_test_starter",
  growth: "price_test_growth",
  receptionist: "price_test_receptionist",
} as const;

type FakeSubscription = {
  id: string;
  customer: string;
  livemode: boolean;
  status: string;
  cancel_at_period_end: boolean;
  latest_invoice: string;
  current_period_end: number;
  items: { data: { price: { id: string }; current_period_end: number }[] };
};

describe("Stripe webhook sync on real SQL (PGlite)", { skip: !pgliteAvailable() && "PGlite not installed" }, () => {
  const envNames = [
    "DATABASE_URL",
    "SAAS_DURABLE_STORE",
    "MISSED_CALL_DURABLE_STORE",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_TEST_SECRET_KEY",
    "STRIPE_TEST_WEBHOOK_SECRET",
    ...PLAN_IDS.map((id) => `STRIPE_TEST_PRICE_${id.toUpperCase()}`),
    "AUTH_SECRET",
  ];
  const savedEnv = new Map(envNames.map((name) => [name, process.env[name]]));
  const runtime = globalThis as typeof globalThis & {
    __tradecatchSaas?: { store: SaasStore; durable: boolean };
  };

  let db: PgliteDb;
  let pool: ReturnType<typeof poolOf>;
  let subscriptions: FakeSubscription[];
  let customerDeleted: boolean;
  let calls: { method: string; path: string; body?: string }[];
  let sequence = 0;

  function sub(status = "active", price: string = PRICE.professional, id = "sub_plan_1", extra: Partial<FakeSubscription> = {}): FakeSubscription {
    return {
      id,
      customer: CUSTOMER,
      livemode: false,
      status,
      cancel_at_period_end: false,
      latest_invoice: "in_plan_1",
      current_period_end: PERIOD_END,
      items: { data: [{ price: { id: price }, current_period_end: PERIOD_END }] },
      ...extra,
    };
  }

  /** A subscription event is only accepted when its subscription is in Stripe's current list. */
  function event(type = "customer.subscription.updated", id = `evt_plan_${++sequence}`, subscriptionId = "sub_plan_1") {
    return { id, type, livemode: false, data: { object: { id: subscriptionId, customer: CUSTOMER } } };
  }

  async function deliver(body: unknown) {
    const payload = JSON.stringify(body);
    const t = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", SIGNING_SECRET).update(`${t}.${payload}`).digest("hex");
    return stripeWebhook(
      new NextRequest("https://tradecatch.test/api/webhooks/stripe", {
        method: "POST",
        body: payload,
        headers: { "stripe-signature": `t=${t},v1=${signature}` },
      }),
    );
  }

  async function org() {
    return (await pool.query("SELECT plan, status FROM tc_organizations WHERE id=$1", [ORG])).rows[0] as {
      plan: PlanId;
      status: string;
    };
  }
  const rows = async (table: string) =>
    Number((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n);
  /** The same rule the tenant context applies: features only while the organization is active. */
  const hasAccess = (state: { plan: PlanId; status: string }, feature: FeatureId) =>
    state.status === "active" && orgHasFeature(state.plan, feature);
  const writes = () => calls.filter((c) => c.method !== "GET");

  before(async () => {
    db = await createPglite();
    pool = poolOf(db);
    await db.exec(`
      CREATE TABLE tc_users (id TEXT PRIMARY KEY);
      CREATE TABLE tc_organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        slug TEXT,
        plan TEXT NOT NULL,
        status TEXT NOT NULL,
        account_type TEXT NOT NULL DEFAULT 'pilot',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // The real billing schema, in the order db:schema applies it.
    for (const file of ["stripe-billing.sql", "plan-tiers.sql", "billing-v2.sql"]) {
      await db.exec(readFileSync(path.join(process.cwd(), "src", "product", "saas", file), "utf8"));
    }
    // The webhook now records payment outcomes in migration 041. Apply the
    // billing-events section of the real schema; this focused fixture does not
    // create the unrelated audit and website-request tables from that migration.
    const adminSchema = readFileSync(
      path.join(process.cwd(), "src", "product", "admin-console", "schema.sql"),
      "utf8",
    );
    const billingStart = adminSchema.indexOf("CREATE TABLE IF NOT EXISTS tc_billing_events");
    const billingEnd = adminSchema.indexOf("-- 3. Website requests", billingStart);
    assert.ok(billingStart >= 0 && billingEnd > billingStart);
    await db.exec(adminSchema.slice(billingStart, billingEnd));
    setPgPoolForTests(pool);
  });
  after(async () => {
    setPgPoolForTests(null);
    await db?.close();
  });

  beforeEach(async () => {
    for (const name of envNames) delete process.env[name];
    Object.assign(process.env, {
      DATABASE_URL: "postgresql://plan-sync-unit.invalid/plan_sync",
      SAAS_DURABLE_STORE: "1",
      STRIPE_TEST_SECRET_KEY: "sk_test_plan_sync_fixture",
      STRIPE_TEST_WEBHOOK_SECRET: SIGNING_SECRET,
      ...Object.fromEntries(PLAN_IDS.map((id) => [`STRIPE_TEST_PRICE_${id.toUpperCase()}`, PRICE[id]])),
    });
    // Referral bookkeeping after a sync is best effort; keep it in memory here.
    runtime.__tradecatchSaas = { store: createMemorySaasStore(), durable: false };
    await pool.query(
      "TRUNCATE tc_billing_events, tc_stripe_subscriptions, tc_stripe_events, tc_stripe_customers, tc_installation_checkouts, tc_billing_deferrals, tc_organizations CASCADE",
    );
    await pool.query(
      "INSERT INTO tc_organizations (id,name,slug,plan,status,account_type) VALUES ($1,'Plan sync','plan-sync','essential','suspended','demo')",
      [ORG],
    );
    subscriptions = [sub()];
    customerDeleted = false;
    calls = [];
    mock.method(console, "error", () => {});
    mock.method(console, "warn", () => {});
    mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = (init?.method || "GET").toUpperCase();
      const route = url.pathname.replace(/^\/v1\//, "");
      calls.push({ method, path: route, body: init?.body ? String(init.body) : undefined });
      if (method === "POST" && route === "subscriptions") {
        const body = new URLSearchParams(String(init?.body));
        const created = sub("trialing", body.get("items[0][price]")!, `sub_created_${subscriptions.length + 1}`);
        subscriptions.push(created);
        return Response.json(created);
      }
      if (method === "POST") return Response.json({ id: CUSTOMER });
      if (route === `customers/${CUSTOMER}`) {
        return customerDeleted
          ? Response.json({ id: CUSTOMER, deleted: true })
          : Response.json({ id: CUSTOMER, livemode: false, metadata: { organization_id: ORG } });
      }
      if (route.startsWith("payment_intents/")) return Response.json({ id: "pi_plan", payment_method: "pm_plan" });
      if (route === "subscriptions") return Response.json({ data: subscriptions, has_more: false });
      return Response.json({}, { status: 404 });
    });
  });
  afterEach(() => {
    mock.restoreAll();
    for (const [name, value] of savedEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    delete runtime.__tradecatchSaas;
  });

  /* ---------------------------------- 06 ---------------------------------- */

  it("PLAN-06 a subscription.created webhook records the plan, the status, the period end and the customer binding", async () => {
    const response = await deliver(event("customer.subscription.created"));
    assert.equal(response.status, 200);
    assert.deepEqual(await org(), { plan: "professional", status: "active" });
    const stored = (await pool.query("SELECT subscription_id, plan, status, cancel_at_period_end FROM tc_stripe_subscriptions")).rows;
    assert.deepEqual(stored, [
      { subscription_id: "sub_plan_1", plan: "professional", status: "active", cancel_at_period_end: false },
    ]);
    const summary = await getSubscriptionSummary(ORG);
    assert.equal(summary?.currentPeriodEnd, new Date(PERIOD_END * 1000).toISOString());
    assert.equal((await pool.query("SELECT customer_id FROM tc_stripe_customers WHERE organization_id=$1", [ORG])).rows[0]!.customer_id, CUSTOMER);
    assert.equal(await rows("tc_stripe_events"), 1);
  });

  it("PLAN-06 each Stripe price maps to exactly its own plan, and the internal id is kept", async () => {
    for (const plan of PLAN_IDS) {
      subscriptions = [sub("active", PRICE[plan])];
      assert.equal((await deliver(event())).status, 200, plan);
      assert.equal((await org()).plan, plan, plan);
      assert.equal((await pool.query("SELECT plan FROM tc_stripe_subscriptions")).rows[0]!.plan, plan, plan);
    }
  });

  it("PLAN-06 invoice events synchronize too, from Stripe's current state rather than the event body", async () => {
    for (const type of ["invoice.paid", "invoice.payment_succeeded"]) {
      await pool.query("UPDATE tc_organizations SET plan='essential', status='suspended' WHERE id=$1", [ORG]);
      assert.equal((await deliver(event(type))).status, 200, type);
      assert.deepEqual(await org(), { plan: "professional", status: "active" }, type);
    }
  });

  it("PLAN-06 a price nobody configured is refused without touching the account, so Stripe retries", async () => {
    subscriptions = [sub("active", "price_nobody_configured")];
    assert.equal((await deliver(event())).status, 503);
    assert.deepEqual(await org(), { plan: "essential", status: "suspended" });
    assert.equal(await rows("tc_stripe_events"), 0, "no receipt, so the retry is processed");
  });

  /* ---------------------------------- 05 ---------------------------------- */

  it("PLAN-05 an existing legacy subscription keeps its internal plan and active status, and Stripe is only read", async () => {
    await pool.query("UPDATE tc_organizations SET plan='growth', status='active' WHERE id=$1", [ORG]);
    await pool.query("INSERT INTO tc_stripe_customers (organization_id, customer_id, livemode) VALUES ($1,$2,false)", [ORG, CUSTOMER]);
    await pool.query(
      "INSERT INTO tc_stripe_subscriptions (subscription_id, organization_id, status, plan, cancel_at_period_end, current_period_end) VALUES ('sub_plan_1',$1,'active','growth',false,now())",
      [ORG],
    );
    subscriptions = [sub("active", PRICE.growth)];
    assert.equal((await deliver(event("invoice.paid"))).status, 200);
    assert.deepEqual(await org(), { plan: "growth", status: "active" });
    assert.equal(await rows("tc_stripe_subscriptions"), 1, "the same subscription, not a duplicate");
    assert.deepEqual(writes(), [], "the sync read from Stripe and changed nothing there");
    // What the customer sees is the public name, not the internal id.
    assert.equal(describePlan("growth").name, "Professional");
  });

  it("PLAN-05 a legacy subscription whose price is not configured is refused and the account is left alone", async () => {
    delete process.env.STRIPE_TEST_PRICE_GROWTH;
    await pool.query("UPDATE tc_organizations SET plan='growth', status='active' WHERE id=$1", [ORG]);
    subscriptions = [sub("active", PRICE.growth)];
    assert.equal((await deliver(event())).status, 503);
    assert.deepEqual(await org(), { plan: "growth", status: "active" });
  });

  /* ---------------------------------- 07 ---------------------------------- */

  it("PLAN-07 upgrading Essential to Professional unlocks the calendar and keeps one subscription", async () => {
    subscriptions = [sub("active", PRICE.essential)];
    await deliver(event());
    assert.equal(hasAccess(await org(), "APPOINTMENT_BOOKING"), false);

    subscriptions = [sub("active", PRICE.professional)]; // same subscription id, new price
    assert.equal((await deliver(event())).status, 200);
    const after = await org();
    assert.deepEqual(after, { plan: "professional", status: "active" });
    assert.equal(hasAccess(after, "APPOINTMENT_BOOKING"), true);
    assert.equal(hasAccess(after, "AI_PHONE_BOOKING"), true);
    assert.equal(await rows("tc_stripe_subscriptions"), 1);
    assert.equal((await pool.query("SELECT plan FROM tc_stripe_subscriptions")).rows[0]!.plan, "professional");
    assert.deepEqual(writes(), []);
  });

  it("PLAN-07 downgrading Professional to Essential removes the calendar and keeps the customer active", async () => {
    await deliver(event());
    assert.equal(hasAccess(await org(), "APPOINTMENT_BOOKING"), true);

    subscriptions = [sub("active", PRICE.essential)];
    await deliver(event());
    const after = await org();
    assert.deepEqual(after, { plan: "essential", status: "active" });
    assert.equal(hasAccess(after, "APPOINTMENT_BOOKING"), false);
    assert.equal(hasAccess(after, "AI_RECEPTIONIST_VOICE"), true, "still answers calls");
    assert.equal(await rows("tc_stripe_subscriptions"), 1);
  });

  it("PLAN-07 while an old Professional and a new Essential both exist the customer keeps Professional, then drops to Essential when the old one ends", async () => {
    subscriptions = [sub("active", PRICE.professional, "sub_old"), sub("active", PRICE.essential, "sub_new")];
    assert.equal((await deliver(event("customer.subscription.created", undefined, "sub_new"))).status, 200);
    assert.equal((await org()).plan, "professional");
    assert.equal(await rows("tc_stripe_subscriptions"), 2);

    subscriptions = [sub("canceled", PRICE.professional, "sub_old"), sub("active", PRICE.essential, "sub_new")];
    assert.equal((await deliver(event("customer.subscription.deleted", undefined, "sub_old"))).status, 200);
    assert.deepEqual(await org(), { plan: "essential", status: "active" });
  });

  /* ---------------------------------- 11 ---------------------------------- */

  for (const [stripeStatus, expected] of [
    ["canceled", "churned"],
    ["incomplete_expired", "churned"],
    ["past_due", "suspended"],
    ["unpaid", "suspended"],
    ["paused", "suspended"],
    ["incomplete", "suspended"],
  ] as const) {
    it(`PLAN-11 a ${stripeStatus} subscription leaves the organization ${expected}, keeps its plan and removes access`, async () => {
      await deliver(event());
      assert.equal(hasAccess(await org(), "APPOINTMENT_BOOKING"), true);
      subscriptions = [sub(stripeStatus)];
      assert.equal((await deliver(event(stripeStatus === "canceled" ? "customer.subscription.deleted" : "invoice.payment_failed"))).status, 200);
      const state = await org();
      assert.deepEqual(state, { plan: "professional", status: expected });
      assert.equal(hasAccess(state, "APPOINTMENT_BOOKING"), false);
      assert.equal(hasAccess(state, "AI_RECEPTIONIST_VOICE"), false);
      const summary = await getSubscriptionSummary(ORG);
      assert.equal(summary?.status, stripeStatus);
      assert.equal(subscriptionStatusKind(summary!.status), expected === "churned" ? "canceled" : "payment_needed");
    });
  }

  it("PLAN-11 a scheduled cancellation keeps full access until Stripe actually ends the subscription", async () => {
    subscriptions = [sub("active", PRICE.professional, "sub_plan_1", { cancel_at_period_end: true })];
    await deliver(event());
    assert.equal(hasAccess(await org(), "APPOINTMENT_BOOKING"), true);
    const summary = await getSubscriptionSummary(ORG);
    assert.equal(summary?.cancelAtPeriodEnd, true);
    assert.equal(subscriptionStatusKind(summary!.status), "active");

    subscriptions = [sub("canceled")];
    await deliver(event("customer.subscription.deleted"));
    assert.equal(hasAccess(await org(), "APPOINTMENT_BOOKING"), false);
    assert.equal((await org()).status, "churned");
  });

  it("PLAN-11 a deleted Stripe customer churns the organization without downgrading its plan", async () => {
    await deliver(event());
    customerDeleted = true;
    assert.equal((await deliver(event("customer.subscription.deleted"))).status, 200);
    assert.deepEqual(await org(), { plan: "professional", status: "churned" });
  });

  it("PLAN-11 paying again restores the plan and access", async () => {
    subscriptions = [sub("past_due")];
    await deliver(event("invoice.payment_failed"));
    assert.equal((await org()).status, "suspended");
    subscriptions = [sub("active")];
    await deliver(event("invoice.paid"));
    assert.deepEqual(await org(), { plan: "professional", status: "active" });
  });

  /* ---------------------------------- 08 ---------------------------------- */

  it("PLAN-08 the plan and billing state are read from the database on every request, so refresh and re-login agree", async () => {
    subscriptions = [sub("active", PRICE.professional, "sub_plan_1", { cancel_at_period_end: true })];
    await deliver(event());
    const reads = [];
    for (let visit = 0; visit < 3; visit++) {
      // Each loop is a fresh page load or a fresh login: nothing is carried between them.
      const summary = await getSubscriptionSummary(ORG);
      reads.push({ org: await org(), name: describePlan((await org()).plan).name, summary });
    }
    assert.deepEqual(reads[1], reads[0]);
    assert.deepEqual(reads[2], reads[0]);
    assert.equal(reads[0]!.name, "Professional");
    assert.equal(reads[0]!.summary?.cancelAtPeriodEnd, true);
  });

  it("PLAN-08 an organization with no subscription yet has no summary, not an invented one", async () => {
    assert.equal(await getSubscriptionSummary(ORG), null);
    assert.equal(await getSubscriptionSummary("org_unknown"), null);
  });

  /* ---------------------------------- 12 ---------------------------------- */

  it("PLAN-12 six concurrent deliveries (one event three times) leave one consistent state and never write to Stripe", async () => {
    const same = event("customer.subscription.updated", "evt_plan_same");
    const results = await Promise.all([
      deliver(same),
      deliver(same),
      deliver(same),
      deliver(event("customer.subscription.created")),
      deliver(event("invoice.paid")),
      deliver(event("invoice.payment_succeeded")),
    ]);
    assert.ok(results.every((r) => r.status === 200), `statuses: ${results.map((r) => r.status).join(", ")}`);
    const bodies = (await Promise.all(results.map((r) => r.json()))) as { duplicate?: boolean }[];
    assert.equal(bodies.filter((b) => b.duplicate).length, 2, "the two repeats of one event id are deduplicated");
    assert.equal(await rows("tc_stripe_events"), 4, "one receipt per distinct event id");
    assert.equal(await rows("tc_stripe_subscriptions"), 1, "one subscription, not one per event");
    assert.deepEqual(await org(), { plan: "professional", status: "active" });
    assert.deepEqual(writes(), [], "no subscription, charge or invoice was created by the sync");
  });

  it("PLAN-12 a paid setup checkout delivered five times creates exactly one subscription, then the sync activates it", async () => {
    await pool.query("UPDATE tc_organizations SET plan='professional' WHERE id=$1", [ORG]);
    subscriptions = [];
    await pool.query(
      "INSERT INTO tc_installation_checkouts (id, organization_id, plan, checkout_session_id, livemode, status) VALUES ('ic_plan_1',$1,'professional','cs_plan_1',false,'pending')",
      [ORG],
    );
    const checkout = (id: string) => ({
      id,
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: "cs_plan_1",
          payment_status: "paid",
          customer: CUSTOMER,
          payment_intent: "pi_plan",
          metadata: { organization_id: ORG, plan: "professional", flow: "installation" },
        },
      },
    });
    // Three copies of one event, and two further events for the same session.
    const results = await Promise.all([
      deliver(checkout("evt_co_1")),
      deliver(checkout("evt_co_1")),
      deliver(checkout("evt_co_1")),
      deliver(checkout("evt_co_2")),
      deliver(checkout("evt_co_3")),
    ]);
    assert.ok(results.every((r) => r.status === 200));
    const created = calls.filter((c) => c.method === "POST" && c.path === "subscriptions");
    assert.equal(created.length, 1, "exactly one subscription was created in Stripe");
    assert.equal(new URLSearchParams(created[0]!.body).get("items[0][price]"), PRICE.professional);
    assert.equal(subscriptions.length, 1);
    assert.equal((await pool.query("SELECT status FROM tc_installation_checkouts")).rows[0]!.status, "subscribed");

    // The subscription Stripe created arrives as a webhook and switches the account on.
    const createdId = subscriptions[0]!.id;
    assert.equal((await deliver(event("customer.subscription.created", "evt_sub_after_checkout", createdId))).status, 200);
    assert.deepEqual(await org(), { plan: "professional", status: "active" });
    assert.equal(await rows("tc_stripe_subscriptions"), 1);
  });
});
