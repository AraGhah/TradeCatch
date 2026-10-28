#!/usr/bin/env node
/**
 * Creates (or verifies) the six Stripe Prices the three plans need: one
 * recurring monthly price and one one-time installation price per plan.
 *
 * This script is NEVER run automatically — it is for the repository owner
 * to run by hand, after reviewing the amounts, with their own Stripe secret
 * key. It checks for an existing active price with the same amount, product
 * name and recurrence before creating anything, so running it twice does
 * not create duplicates.
 *
 * Usage (test mode, default):
 *   STRIPE_TEST_SECRET_KEY=sk_test_... node scripts/stripe-setup-plan-prices.js
 * Usage (live mode — only after you have reviewed the amounts below):
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-setup-plan-prices.js --live
 *
 * Prints the resulting Price IDs so they can be copied into .env as
 * STRIPE_PRICE_<PLAN> / STRIPE_PRICE_INSTALL_<PLAN> (or the TEST_ variants).
 * It does not write to .env itself.
 */
const PLANS = {
  STARTER: { product: "TradeCatch Starter", installCents: 79999, monthlyCents: 34999 },
  GROWTH: { product: "TradeCatch Growth", installCents: 149999, monthlyCents: 64999 },
  RECEPTIONIST: {
    product: "TradeCatch AI Receptionist Pro",
    installCents: 199999,
    monthlyCents: 94999,
  },
};

async function stripe(key, method, path, body) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": "2025-02-24.acacia",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(body) : undefined,
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`Stripe ${method} ${path} failed: ${JSON.stringify(json)}`);
  }
  return json;
}

async function findOrCreateProduct(key, name) {
  const existing = await stripe(key, "GET", `products/search?query=${encodeURIComponent(`name:'${name}'`)}`);
  if (existing.data?.length) return existing.data[0].id;
  const created = await stripe(key, "POST", "products", { name });
  return created.id;
}

async function findOrCreatePrice(key, productId, params, label) {
  const existing = await stripe(key, "GET", `prices?product=${productId}&active=true&limit=100`);
  const match = (existing.data || []).find((price) => {
    if (price.currency !== "cad" || price.unit_amount !== params.unit_amount) return false;
    const wantsRecurring = Boolean(params["recurring[interval]"]);
    return wantsRecurring ? Boolean(price.recurring) : !price.recurring;
  });
  if (match) {
    console.info(`  already exists: ${label} -> ${match.id}`);
    return match.id;
  }
  const created = await stripe(key, "POST", "prices", {
    product: productId,
    currency: "cad",
    ...params,
  });
  console.info(`  created: ${label} -> ${created.id}`);
  return created.id;
}

async function main() {
  const live = process.argv.includes("--live");
  const key = (live ? process.env.STRIPE_SECRET_KEY : process.env.STRIPE_TEST_SECRET_KEY)?.trim();
  if (!key || !key.startsWith(live ? "sk_live_" : "sk_test_")) {
    console.error(
      `Set ${live ? "STRIPE_SECRET_KEY (sk_live_...)" : "STRIPE_TEST_SECRET_KEY (sk_test_...)"} first.`,
    );
    process.exit(1);
  }
  console.info(`Mode: ${live ? "LIVE — this creates real billable prices" : "TEST"}`);
  const envPrefix = live ? "" : "TEST_";
  const results = {};
  for (const [plan, cfg] of Object.entries(PLANS)) {
    console.info(`\n${cfg.product}`);
    const productId = await findOrCreateProduct(key, cfg.product);
    const installPriceId = await findOrCreatePrice(
      key,
      productId,
      { unit_amount: String(cfg.installCents), "metadata[kind]": "installation" },
      "installation (one-time)",
    );
    const monthlyPriceId = await findOrCreatePrice(
      key,
      productId,
      {
        unit_amount: String(cfg.monthlyCents),
        "recurring[interval]": "month",
        "metadata[kind]": "subscription",
      },
      "monthly (recurring)",
    );
    results[`STRIPE_${envPrefix}PRICE_INSTALL_${plan}`] = installPriceId;
    results[`STRIPE_${envPrefix}PRICE_${plan}`] = monthlyPriceId;
  }
  console.info("\nAdd these to your environment (.env / platform secrets):\n");
  for (const [name, value] of Object.entries(results)) {
    console.info(`${name}=${value}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
