# Billing & subscriptions (Task 10)

Stripe-backed SaaS billing for TradeCatch. Stripe owns payment methods, invoices, and subscription money movement. TradeCatch owns entitlements, usage limits, and the contractor dashboard.

## Layout

| Area | Path |
| --- | --- |
| Plan catalog | `plans.ts` |
| Effective access | `entitlementService.ts` |
| Checkout / portal / webhooks | `stripe/` |
| Durable tables | `schema.sql` (`014_billing`) |
| Memory store (tests) | `memory-store.ts` |

## Secrets (Cloudflare / env)

```bash
npx wrangler secret put STRIPE_SECRET_KEY --env staging
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env staging
```

Also set approved price IDs (never accept price IDs from the browser):

- `STRIPE_PRICE_STARTER_MONTHLY` / `STRIPE_PRICE_STARTER_ANNUAL`
- `STRIPE_PRICE_GROWTH_MONTHLY` / `STRIPE_PRICE_GROWTH_ANNUAL`
- `STRIPE_PRICE_AI_RECEPTIONIST_MONTHLY` / `STRIPE_PRICE_AI_RECEPTIONIST_ANNUAL`

Optional: `STRIPE_AUTOMATIC_TAX=1`, `BILLING_GRACE_PERIOD_DAYS=3`, `BILLING_CURRENCY=cad`.

Keep test (`sk_test_…`) and live (`sk_live_…`) credentials on separate Workers.

## Webhook

`POST /api/webhooks/stripe` — verifies `Stripe-Signature`, dedupes by event id, reconciles subscription + entitlements.

Never activate paid features from a Checkout success URL alone.

## Local / unit tests

```bash
BILLING_USE_MEMORY_STRIPE=1 npm run test:unit
```

Memory Stripe never charges real money.
