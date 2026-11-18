/**
 * KAN-18: read-only consistency checks between the plan catalog, the Stripe
 * configuration and what Stripe actually holds.
 *
 * Everything here is a pure function over data the caller fetched, so it is
 * unit-testable and cannot touch Stripe or the database itself. The command
 * line wrapper (scripts/audit-stripe-plans.ts) fetches with GET requests only.
 *
 * It exists because the failures it catches are silent in production:
 *   - a Stripe Price that disagrees with the catalog bills customers a
 *     different amount than the website promised (Prices are immutable, so the
 *     fix is a new Price, never an edit);
 *   - a webhook endpoint that lacks an event never fails loudly, it just never
 *     arrives (no `checkout.session.completed` means a customer pays the setup
 *     fee and no monthly subscription is ever created);
 *   - a misspelt variable name such as STRIPE_WEBHOOK_SEKRET leaves the real
 *     one unset, so every webhook is rejected.
 */
import { PLAN_PRICES } from "@/lib/plans";
import { REFERRAL_REVERSAL_EVENTS } from "@/product/referrals/billing-hooks";
import { LEGACY_PLAN_IDS, PLAN_IDS, PUBLIC_PLAN_IDS, type PlanId } from "./entitlements";
import { ADD_ONS } from "./plan-catalog";
import { BILLING_EVENTS } from "./stripe-billing";
import { CHECKOUT_COMPLETED_EVENT } from "./stripe-checkout";

export type Severity = "error" | "warn" | "ok";
export type Finding = { severity: Severity; code: string; message: string };

export type PriceView = {
  id: string;
  active: boolean;
  livemode: boolean;
  currency: string;
  unit_amount: number | null;
  recurring: { interval: string; interval_count?: number } | null;
};
export type WebhookEndpointView = {
  url: string;
  status: string;
  enabled_events: readonly string[];
};
export type SubscriptionGroup = { priceIds: readonly string[]; status: string; count: number };
export type PortalConfigView = {
  is_default?: boolean;
  active?: boolean;
  subscription_update_enabled: boolean;
  subscription_cancel_enabled: boolean;
};

const cents = (dollars: number) => Math.round(dollars * 100);
const dollars = (amountCents: number | null) =>
  amountCents === null ? "no amount" : `$${(amountCents / 100).toFixed(2)}`;

/** The path Stripe must deliver billing events to. */
export const WEBHOOK_PATH = "/api/webhooks/stripe";

/** Events this application acts on; a missing one is a functional gap. */
export const REQUIRED_WEBHOOK_EVENTS: readonly string[] = [
  ...BILLING_EVENTS,
  CHECKOUT_COMPLETED_EVENT,
];
/** Events that only drive referral reward reversal; missing is a warning. */
export const RECOMMENDED_WEBHOOK_EVENTS: readonly string[] = [...REFERRAL_REVERSAL_EVENTS];

const prefix = (livemode: boolean) => `STRIPE_${livemode ? "" : "TEST_"}`;

export function planPriceVariable(plan: PlanId, livemode: boolean): string {
  return `${prefix(livemode)}PRICE_${plan.toUpperCase()}`;
}
export function installPriceVariable(plan: PlanId, livemode: boolean): string {
  return `${prefix(livemode)}PRICE_INSTALL_${plan.toUpperCase()}`;
}
export function websitePriceVariable(livemode: boolean): string {
  return `${prefix(livemode)}PRICE_WEBSITE_SERVICE`;
}

/** Every STRIPE_ variable the application reads, for typo detection. */
export function knownStripeVariables(): string[] {
  const names = new Set<string>();
  for (const livemode of [true, false]) {
    names.add(`${prefix(livemode)}SECRET_KEY`);
    names.add(`${prefix(livemode)}WEBHOOK_SECRET`);
    names.add(`${prefix(livemode)}BILLING_PORTAL_CONFIGURATION`);
    names.add(websitePriceVariable(livemode));
    for (const plan of PLAN_IDS) {
      names.add(planPriceVariable(plan, livemode));
      names.add(installPriceVariable(plan, livemode));
    }
  }
  return [...names];
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}

/**
 * Variable NAMES only (never values). Flags a STRIPE_ name the application does
 * not read but that is within a few characters of one it does: the signature of
 * a typo, e.g. STRIPE_WEBHOOK_SEKRET.
 */
export function auditVariableNames(names: readonly string[]): Finding[] {
  const known = new Set(knownStripeVariables());
  const findings: Finding[] = [];
  for (const name of names) {
    if (!name.startsWith("STRIPE_") || known.has(name)) continue;
    let best: { name: string; distance: number } | null = null;
    for (const candidate of known) {
      const distance = editDistance(name, candidate);
      if (!best || distance < best.distance) best = { name: candidate, distance };
    }
    if (best && best.distance <= 3) {
      findings.push({
        severity: "error",
        code: "env-typo",
        message: `${name} is not read by the application. Did you mean ${best.name}? The correctly spelt variable is what the application reads, so while this stays misspelt the real one is unset.`,
      });
    }
  }
  return findings;
}

/** Which configured price id maps to which plan; also reports ids used twice. */
export function priceToPlan(
  env: Readonly<Record<string, string | undefined>>,
  livemode: boolean,
): { map: Map<string, PlanId>; findings: Finding[] } {
  const map = new Map<string, PlanId>();
  const findings: Finding[] = [];
  for (const plan of PLAN_IDS) {
    for (const id of (env[planPriceVariable(plan, livemode)] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const other = map.get(id);
      if (other && other !== plan) {
        findings.push({
          severity: "error",
          code: "price-mapped-twice",
          message: `${id} is configured for both ${other} and ${plan}. The webhook refuses to guess and rejects every event for it.`,
        });
      }
      map.set(id, plan);
    }
  }
  return { map, findings };
}

/** Required variables are present and shaped correctly. Never prints values. */
export function auditEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  livemode: boolean,
): Finding[] {
  const findings: Finding[] = [];
  const has = (name: string) => Boolean(env[name]?.trim());
  const mode = livemode ? "live" : "test";

  const key = `${prefix(livemode)}SECRET_KEY`;
  const wantsKey = livemode ? "sk_live_" : "sk_test_";
  if (!has(key)) findings.push({ severity: "error", code: "env-missing", message: `${key} is not set (${mode} mode).` });
  else if (!env[key]!.trim().startsWith(wantsKey)) {
    findings.push({ severity: "error", code: "env-wrong-mode", message: `${key} does not look like a ${mode}-mode key (expected ${wantsKey}...).` });
  }

  const secret = `${prefix(livemode)}WEBHOOK_SECRET`;
  if (!has(secret)) {
    findings.push({
      severity: "error",
      code: "env-missing",
      message: `${secret} is not set, so every Stripe webhook is rejected and no subscription state ever syncs.`,
    });
  } else if (!env[secret]!.trim().startsWith("whsec_")) {
    findings.push({ severity: "warn", code: "env-shape", message: `${secret} does not start with whsec_.` });
  }

  for (const plan of PUBLIC_PLAN_IDS) {
    for (const [name, what] of [
      [planPriceVariable(plan, livemode), "monthly Price"],
      [installPriceVariable(plan, livemode), "one-time setup Price"],
    ] as const) {
      if (!has(name)) {
        findings.push({ severity: "error", code: "env-missing", message: `${name} is not set: the ${plan} ${what} cannot be used.` });
      } else if (!/^price_[A-Za-z0-9]+(,\s*price_[A-Za-z0-9]+)*$/.test(env[name]!.trim()) || (name.includes("INSTALL") && env[name]!.includes(","))) {
        findings.push({ severity: "error", code: "env-shape", message: `${name} must be a Stripe Price id${name.includes("INSTALL") ? "" : " (or a comma-separated list)"}.` });
      }
    }
  }
  if (!has(websitePriceVariable(livemode))) {
    findings.push({
      severity: "warn",
      code: "env-missing",
      message: `${websitePriceVariable(livemode)} is not set: the optional website service cannot be added at checkout.`,
    });
  }
  for (const plan of LEGACY_PLAN_IDS) {
    if (!has(planPriceVariable(plan, livemode))) {
      findings.push({
        severity: "warn",
        code: "legacy-price-unmapped",
        message: `${planPriceVariable(plan, livemode)} is not set. That is fine only if no Stripe subscription still uses a ${plan} Price; otherwise the webhook rejects events for it.`,
      });
    }
  }
  const { findings: mapping } = priceToPlan(env, livemode);
  findings.push(...mapping);
  return findings;
}

/**
 * The configured Prices against what Stripe says they are. `prices` holds the
 * retrieved object per id, or null when Stripe has no such Price.
 */
export function auditPrices(
  env: Readonly<Record<string, string | undefined>>,
  livemode: boolean,
  prices: ReadonlyMap<string, PriceView | null>,
): Finding[] {
  const findings: Finding[] = [];
  const check = (variable: string, expectedCents: number, recurring: boolean, label: string) => {
    const id = env[variable]?.split(",")[0]?.trim();
    if (!id) return; // reported by auditEnvironment
    const price = prices.get(id);
    if (price === undefined) return;
    if (price === null) {
      findings.push({ severity: "error", code: "price-not-found", message: `${variable} points at ${id}, which does not exist in this Stripe account (${livemode ? "live" : "test"} mode).` });
      return;
    }
    const problems: string[] = [];
    if (!price.active) problems.push("it is archived");
    if (price.livemode !== livemode) problems.push(`it belongs to ${price.livemode ? "live" : "test"} mode`);
    if (price.currency.toLowerCase() !== "cad") problems.push(`its currency is ${price.currency.toUpperCase()}, not CAD`);
    if (recurring) {
      if (!price.recurring || price.recurring.interval !== "month" || (price.recurring.interval_count ?? 1) !== 1) {
        problems.push("it does not bill every month");
      }
    } else if (price.recurring) problems.push("it is recurring, but a setup fee is one-time");
    if (price.unit_amount !== expectedCents) {
      problems.push(
        `Stripe charges ${dollars(price.unit_amount)} but the catalog and website say ${dollars(expectedCents)}`,
      );
    }
    if (problems.length) {
      findings.push({
        severity: "error",
        code: "price-mismatch",
        message: `${variable} (${id}, ${label}): ${problems.join("; ")}.${
          price.unit_amount !== expectedCents
            ? " Stripe Prices cannot be edited: create a new Price (node scripts/stripe-setup-plan-prices.js) and point this variable at it. Existing subscriptions keep their old Price and their old amount."
            : ""
        }`,
      });
    } else {
      findings.push({ severity: "ok", code: "price-ok", message: `${variable}: ${dollars(price.unit_amount)} CAD ${recurring ? "monthly" : "one-time"}, as the catalog says.` });
    }
  };

  for (const plan of PUBLIC_PLAN_IDS) {
    check(planPriceVariable(plan, livemode), cents(PLAN_PRICES[plan].monthly), true, `${plan} monthly`);
    check(installPriceVariable(plan, livemode), cents(PLAN_PRICES[plan].setup), false, `${plan} setup`);
  }
  check(websitePriceVariable(livemode), cents(ADD_ONS.websiteService.priceCad), false, "website service");
  return findings;
}

/** Webhook endpoints: one must deliver to this application and carry every event it acts on. */
export function auditWebhookEndpoints(
  endpoints: readonly WebhookEndpointView[],
  expectedHost?: string,
): Finding[] {
  const ours = endpoints.filter((endpoint) => {
    try {
      const url = new URL(endpoint.url);
      return url.pathname.replace(/\/$/, "") === WEBHOOK_PATH && (!expectedHost || url.host === expectedHost);
    } catch {
      return false;
    }
  });
  if (!ours.length) {
    return [{ severity: "error", code: "webhook-missing", message: `No Stripe webhook endpoint delivers to ${expectedHost ?? "this application"}${WEBHOOK_PATH}.` }];
  }
  const enabled = ours.filter((endpoint) => endpoint.status === "enabled");
  if (!enabled.length) {
    return [{ severity: "error", code: "webhook-disabled", message: `The webhook endpoint for ${WEBHOOK_PATH} exists but is not enabled.` }];
  }
  const events = new Set(enabled.flatMap((endpoint) => endpoint.enabled_events));
  const covers = (event: string) => events.has("*") || events.has(event);
  const findings: Finding[] = [];
  for (const event of REQUIRED_WEBHOOK_EVENTS) {
    if (!covers(event)) {
      findings.push({
        severity: "error",
        code: "webhook-event-missing",
        message:
          event === CHECKOUT_COMPLETED_EVENT
            ? `The webhook endpoint is not subscribed to ${event}. A customer who pays the setup fee would never get their monthly subscription created.`
            : `The webhook endpoint is not subscribed to ${event}, so that change in Stripe never reaches the dashboard.`,
      });
    }
  }
  for (const event of RECOMMENDED_WEBHOOK_EVENTS) {
    if (!covers(event)) {
      findings.push({ severity: "warn", code: "webhook-event-missing", message: `The webhook endpoint is not subscribed to ${event} (referral reward reversal).` });
    }
  }
  if (!findings.length) findings.push({ severity: "ok", code: "webhook-ok", message: "The webhook endpoint carries every event the application acts on." });
  return findings;
}

/** Every subscription in Stripe must use a Price the application can map to a plan. */
export function auditSubscriptions(
  groups: readonly SubscriptionGroup[],
  mapping: ReadonlyMap<string, PlanId>,
): Finding[] {
  const findings: Finding[] = [];
  const total = groups.reduce((n, g) => n + g.count, 0);
  const unmapped = groups.filter((g) => g.priceIds.some((id) => !mapping.has(id)));
  for (const group of unmapped) {
    findings.push({
      severity: "error",
      code: "subscription-price-unmapped",
      message: `${group.count} ${group.status} subscription(s) use a Price that is not configured for any plan (${group.priceIds.filter((id) => !mapping.has(id)).join(", ")}). The webhook rejects their events (503) and their accounts stop syncing.`,
    });
  }
  if (!unmapped.length) {
    findings.push({ severity: "ok", code: "subscriptions-ok", message: `${total} Stripe subscription(s), every Price maps to a plan.` });
  }
  return findings;
}

export function auditPortal(configs: readonly PortalConfigView[]): Finding[] {
  const active = configs.filter((c) => c.active !== false);
  if (!active.length) return [{ severity: "warn", code: "portal-missing", message: "No active billing portal configuration." }];
  const findings: Finding[] = [];
  if (!active.some((c) => c.subscription_update_enabled)) {
    findings.push({
      severity: "warn",
      code: "portal-no-plan-change",
      message: "The billing portal does not let customers change plan, so upgrades and downgrades are handled by TradeCatch in Stripe. Intended? The webhook keeps the dashboard in step either way.",
    });
  }
  if (!active.some((c) => c.subscription_cancel_enabled)) {
    findings.push({ severity: "warn", code: "portal-no-cancel", message: "The billing portal does not let customers cancel." });
  }
  return findings;
}

export const hasErrors = (findings: readonly Finding[]) => findings.some((f) => f.severity === "error");

export function formatReport(findings: readonly Finding[]): string {
  const marker = { error: "FAIL", warn: "warn", ok: " ok " } as const;
  return findings.map((f) => `[${marker[f.severity]}] ${f.message}`).join("\n");
}
