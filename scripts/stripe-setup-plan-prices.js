#!/usr/bin/env node
/**
 * Creates (or verifies) the Stripe Prices for the two launch plans and the
 * optional website service:
 *
 *   Essential      $249.00 CAD / month   + $1,999.99 CAD one-time setup
 *   Professional   $349.00 CAD / month   + $1,999.99 CAD one-time setup
 *   Website service $349.99 CAD one-time (optional add-on, only charged when the
 *                  customer ticks it at checkout)
 *
 * It only ADDS. It never edits, archives or deletes an existing product, price,
 * customer or subscription, so legacy Starter / Growth / Receptionist products
 * and the subscriptions on them are untouched. Before creating anything it looks
 * for an existing active price with the same product, currency, amount and
 * recurrence, so running it twice creates no duplicates.
 *
 * This script is NEVER run automatically. The repository owner runs it by hand,
 * after reviewing the amounts, with their own Stripe secret key.
 *
 *   Dry run (reads Stripe, creates nothing, prints what it would do):
 *     STRIPE_TEST_SECRET_KEY=sk_test_... node scripts/stripe-setup-plan-prices.js --dry-run
 *   Test mode (default):
 *     STRIPE_TEST_SECRET_KEY=sk_test_... node scripts/stripe-setup-plan-prices.js
 *   Live mode (only after the dry run looks right):
 *     STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-setup-plan-prices.js --live
 *
 * It prints the resulting Price IDs for the environment (STRIPE_PRICE_*,
 * STRIPE_PRICE_INSTALL_*, STRIPE_PRICE_WEBSITE_SERVICE, or the TEST_ variants).
 * It does not write to .env itself.
 */
const PLANS = {
  ESSENTIAL: { product: "TradeCatch Essential", installCents: 199999, monthlyCents: 24900 },
  PROFESSIONAL: { product: "TradeCatch Professional", installCents: 199999, monthlyCents: 34900 },
};
const WEBSITE = { product: "TradeCatch Website Service", oneTimeCents: 34999 };

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

async function findOrCreateProduct(key, name, dryRun) {
  const existing = await stripe(
    key,
    "GET",
    `products/search?query=${encodeURIComponent(`name:'${name}' AND active:'true'`)}`,
  );
  if (existing.data?.length) {
    console.info(`  product exists: ${name} -> ${existing.data[0].id}`);
    return existing.data[0].id;
  }
  if (dryRun) {
    console.info(`  [dry run] would create product: ${name}`);
    return null;
  }
  const created = await stripe(key, "POST", "products", { name });
  console.info(`  created product: ${name} -> ${created.id}`);
  return created.id;
}

async function findOrCreatePrice(key, productId, params, label, dryRun) {
  if (productId) {
    const existing = await stripe(key, "GET", `prices?product=${productId}&active=true&limit=100`);
    const match = (existing.data || []).find((price) => {
      if (price.currency !== "cad" || price.unit_amount !== Number(params.unit_amount)) return false;
      const wantsRecurring = Boolean(params["recurring[interval]"]);
      return wantsRecurring ? price.recurring?.interval === "month" : !price.recurring;
    });
    if (match) {
      console.info(`  already exists: ${label} -> ${match.id}`);
      return match.id;
    }
  }
  if (dryRun || !productId) {
    console.info(`  [dry run] would create price: ${label} (${params.unit_amount} cents CAD)`);
    return null;
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
  const dryRun = process.argv.includes("--dry-run");
  const key = (live ? process.env.STRIPE_SECRET_KEY : process.env.STRIPE_TEST_SECRET_KEY)?.trim();
  if (!key || !key.startsWith(live ? "sk_live_" : "sk_test_")) {
    console.error(
      `Set ${live ? "STRIPE_SECRET_KEY (sk_live_...)" : "STRIPE_TEST_SECRET_KEY (sk_test_...)"} first.`,
    );
    process.exit(1);
  }
  console.info(
    `Mode: ${live ? "LIVE (creates real billable prices)" : "TEST"}${dryRun ? ", DRY RUN (creates nothing)" : ""}`,
  );
  const envPrefix = live ? "" : "TEST_";
  const results = {};
  for (const [plan, cfg] of Object.entries(PLANS)) {
    console.info(`\n${cfg.product}`);
    const productId = await findOrCreateProduct(key, cfg.product, dryRun);
    results[`STRIPE_${envPrefix}PRICE_INSTALL_${plan}`] = await findOrCreatePrice(
      key,
      productId,
      { unit_amount: String(cfg.installCents), "metadata[kind]": "installation" },
      "setup (one-time)",
      dryRun,
    );
    results[`STRIPE_${envPrefix}PRICE_${plan}`] = await findOrCreatePrice(
      key,
      productId,
      {
        unit_amount: String(cfg.monthlyCents),
        "recurring[interval]": "month",
        "metadata[kind]": "subscription",
      },
      "monthly (recurring)",
      dryRun,
    );
  }
  console.info(`\n${WEBSITE.product}`);
  const websiteProduct = await findOrCreateProduct(key, WEBSITE.product, dryRun);
  results[`STRIPE_${envPrefix}PRICE_WEBSITE_SERVICE`] = await findOrCreatePrice(
    key,
    websiteProduct,
    { unit_amount: String(WEBSITE.oneTimeCents), "metadata[kind]": "website_service" },
    "website service (one-time)",
    dryRun,
  );

  console.info("\nEnvironment variables (.env / platform secrets):\n");
  for (const [name, value] of Object.entries(results)) {
    console.info(`${name}=${value ?? "(not created in a dry run)"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
