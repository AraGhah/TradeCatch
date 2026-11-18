#!/usr/bin/env node
/**
 * KAN-18 read-only audit: do the Stripe configuration and Stripe's own data
 * agree with the plan catalog (names, prices, setup fee, webhook events)?
 *
 *   npm run billing:audit -- --env-file <file> [--live] [--names A,B,C]
 *
 * SAFETY
 *   - Only GET requests are ever sent: the helper below has no method argument.
 *     It cannot create, edit, archive or charge anything.
 *   - Nothing is printed except Price ids, amounts, event names and counts.
 *     No key, secret, customer id or subscription id is ever written out.
 *   - No environment file is loaded implicitly (the repo's .env.local points at
 *     production). Pass --env-file, or export the variables yourself.
 *   - Exit code 1 when any check fails, 0 otherwise (warnings do not fail it).
 *
 * Test mode is the default; --live audits the live account with
 * STRIPE_SECRET_KEY. --names takes extra variable NAMES (for example from
 * `wrangler secret list`) to check for misspellings; values are never needed.
 * --host narrows the webhook check to one hostname, e.g. tradecatch.ca.
 */
import fs from "node:fs";
import {
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
  type PortalConfigView,
  type PriceView,
  type SubscriptionGroup,
  type WebhookEndpointView,
} from "../src/product/saas/stripe-plan-audit";
import { PUBLIC_PLAN_IDS } from "../src/product/saas/entitlements";

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) out[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
  return out;
}

async function main() {
  const livemode = process.argv.includes("--live");
  const file = argument("--env-file");
  const env: Record<string, string | undefined> = { ...(file ? readEnvFile(file) : process.env) };
  const key = (livemode ? env.STRIPE_SECRET_KEY : env.STRIPE_TEST_SECRET_KEY)?.trim();

  console.info(`Mode: ${livemode ? "LIVE" : "test"} (read-only). Source: ${file ? "the env file you named" : "process environment"}.\n`);

  const findings: Finding[] = [
    ...auditEnvironment(env, livemode),
    ...auditVariableNames([...Object.keys(env), ...(argument("--names")?.split(",").map((s) => s.trim()) ?? [])]),
  ];

  if (!key) {
    console.info(formatReport(findings));
    console.info("\nStripe was not queried: no secret key for this mode.");
    process.exit(hasErrors(findings) ? 1 : 0);
  }

  // GET only, by construction.
  async function get(path: string): Promise<{ status: number; body: any }> {
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}`, "Stripe-Version": "2025-02-24.acacia" },
      signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }
  const page = async (path: string, pages = 20) => {
    const rows: any[] = [];
    let after = "";
    for (let i = 0; i < pages; i++) {
      const sep = path.includes("?") ? "&" : "?";
      const r = await get(`${path}${sep}limit=100${after ? `&starting_after=${after}` : ""}`);
      if (r.status !== 200) throw new Error(`Stripe answered ${r.status} for ${path.split("?")[0]}`);
      rows.push(...r.body.data);
      if (!r.body.has_more) break;
      after = r.body.data.at(-1).id;
    }
    return rows;
  };

  try {
    const wanted = new Set<string>();
    for (const plan of PUBLIC_PLAN_IDS) {
      for (const variable of [planPriceVariable(plan, livemode), installPriceVariable(plan, livemode)]) {
        const id = env[variable]?.split(",")[0]?.trim();
        if (id) wanted.add(id);
      }
    }
    const website = env[websitePriceVariable(livemode)]?.trim();
    if (website) wanted.add(website);

    const prices = new Map<string, PriceView | null>();
    for (const id of wanted) {
      const r = await get(`prices/${encodeURIComponent(id)}`);
      prices.set(id, r.status === 200 ? (r.body as PriceView) : null);
    }
    findings.push(...auditPrices(env, livemode, prices));

    const groups = new Map<string, SubscriptionGroup>();
    for (const sub of await page("subscriptions?status=all")) {
      const priceIds = (sub.items.data as { price: { id: string } }[]).map((item) => item.price.id).sort();
      const groupKey = `${priceIds.join("+")}|${sub.status}`;
      const existing = groups.get(groupKey);
      if (existing) existing.count += 1;
      else groups.set(groupKey, { priceIds, status: sub.status, count: 1 });
    }
    findings.push(...auditSubscriptions([...groups.values()], priceToPlan(env, livemode).map));

    const endpoints: WebhookEndpointView[] = (await page("webhook_endpoints")).map((w) => ({
      url: w.url,
      status: w.status,
      enabled_events: w.enabled_events,
    }));
    findings.push(...auditWebhookEndpoints(endpoints, argument("--host")));

    const portals: PortalConfigView[] = (await page("billing_portal/configurations", 3)).map((c) => ({
      is_default: c.is_default,
      active: c.active,
      subscription_update_enabled: Boolean(c.features?.subscription_update?.enabled),
      subscription_cancel_enabled: Boolean(c.features?.subscription_cancel?.enabled),
    }));
    findings.push(...auditPortal(portals));
  } catch (error) {
    findings.push({ severity: "error", code: "stripe-unreachable", message: `Could not finish querying Stripe: ${(error as Error).message}` });
  }

  console.info(formatReport(findings));
  const failures = findings.filter((f) => f.severity === "error").length;
  console.info(`\n${failures ? `${failures} check(s) FAILED.` : "All checks passed."}`);
  process.exit(failures ? 1 : 0);
}

void main();
