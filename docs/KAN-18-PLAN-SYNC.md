# KAN-18: plans synchronized across the website, the dashboard and Stripe

Historical record: KAN-20 subsequently changed the launch catalog to $249.99 /
$349.99 per month. See `docs/KAN-20-ADMIN-DASHBOARD.md` and
`docs/STRIPE_BILLING.md` for the current prices. The figures below describe the
KAN-18 state before that change.

Status (2026-11-18): **code work done and verified; KAN-18 is not complete.** Live
Stripe still charges $249.99 / $349.99 and the live Worker has no live billing
configuration. Both need owner action (see [Not done](#not-done-needs-the-owner)).
The code is committed, but it has not been deployed or written to live Stripe or
the production database. No database migration is needed.

## Final plan mapping

Two plans are on sale. Amounts are CAD.

| Customer sees | Internal id    | Monthly | Setup     |
| ------------- | -------------- | ------- | --------- |
| Essential     | `essential`    | $249    | $1,999.99 |
| Professional  | `professional` | $349    | $1,999.99 |

Retired ids are **kept** (database rows, Stripe Price mappings, entitlements) and
only their label changes (`src/lib/plan-names.ts`):

| Internal id    | Shown as     | Why                                                   |
| -------------- | ------------ | ----------------------------------------------------- |
| `starter`      | Essential    | cheapest tier, no voice receptionist                  |
| `growth`       | Professional | sold with appointments, review automation, voice      |
| `receptionist` | Professional | sold with everything Growth has, plus phone booking   |

The label is **label only**. A retired-plan customer's dashboard lists the features
their plan really grants and shows no catalog price (they pay what they signed up
at), so relabelling grants and removes nothing. Entitlements are unchanged and
pinned by test (PLAN-05).

## Inconsistencies found and what changed

### In the code

| Where                                                    | Problem                                                                                  | Now                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `PLAN_DISPLAY_NAMES`, `app.plan.*`, `plans.names.*`      | Three separate name sources; retired names (Starter, Growth, Receptionist Plus) in all   | One: `src/lib/plan-names.ts`; messages trimmed to the public plans |
| Billing page                                             | Name and catalog price for every id, so a `growth` customer saw "Growth" at the old $649.99; first-charge date only from the installation record; no Stripe status, next charge / end date, or feature list | Public name, price (new plans only), Stripe status, next charge or end date, feature list from the real entitlements, Professional pointer |
| Settings page                                            | Name only, retired name, no price                                                        | Public name, price (new plans only), same pointer to Professional |
| App header, referrals page                               | Own hard-coded plan lists                                                                | Shared mapping; unknown id shows no invented name                |
| Upgrade hints (`tenant.ts`, voice routes)                | Hard-coded `"growth"`                                                                    | `soldPlanWith(feature)`: a plan that is actually sold, or none   |
| Onboarding (`isGrowth`)                                  | Gated on the retired plan's name                                                         | Gated on the real entitlement (`REVIEW_AUTOMATION`)              |
| Demo video, profile errors, account export, voice copy   | Customer-facing text naming a retired plan                                               | Neutral wording                                                  |
| Checkout                                                 | Only the website add-on's Price was checked against the catalog                           | Setup and monthly Prices are checked too, before any Session is created: a wrong Price fails closed |
| Billing card logic                                       | Decisions inline in the page, untestable                                                 | `billingPlanCard()` pure view-model, unit-tested for every state |

### In Stripe and the live environment (read-only audit, 2026-11-18)

| Finding                                                                                                      | Effect                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Live monthly Prices are **$249.99 and $349.99**, not $249 / $349                                              | Customers would be billed more than the website says. 0 subscriptions exist, so nobody is affected yet |
| The live Worker has no live Stripe key, no price variables and no webhook secret; it has a plain-text `STRIPE_WEBHOOK_SEKRET` (misspelt) binding | Live billing cannot work; every webhook would be rejected                                |
| Live webhook endpoint lacks `checkout.session.completed` and `invoice.payment_failed` (and `charge.refunded`, `charge.dispute.created`) | A customer who pays the setup fee would never get a monthly subscription; payment failures would not sync |
| `STRIPE_PRICE_ESSENTIAL/PROFESSIONAL` ids in `.env.local` do not exist in the live account                    | Same as above                                                                           |
| Billing portal has plan changes disabled                                                                     | Customers cannot self-upgrade; changes go through TradeCatch (webhook still syncs)      |
| Staging `wrangler.jsonc` carries test price ids for `starter`/`growth` only                                  | Staging checkout for Essential/Professional is unconfigured                              |
| 2 existing organizations are on `growth` (1 demo, 1 pilot) with no Stripe link                               | Nothing to migrate; they show as Professional with no catalog price                      |

`npm run billing:audit` re-checks all of the Stripe items above read-only and fails
when any is still wrong.

## Not done (needs the owner)

1. **Create live $249 / $349 monthly Prices.** Prices are immutable. Run
   `node scripts/stripe-setup-plan-prices.js --dry-run --live --product-essential
   prod_... --product-professional prod_...`, review, then run it without
   `--dry-run`. It only adds and never edits Prices. The live products are named
   "TradeCatch Essentials" and "TradeCatch AI Receptionist", not the names the
   script searches for, so without the two `--product-*` flags it would create
   duplicate products. Take the ids from the Stripe Dashboard product catalogue.
2. **Set the live Worker secrets and variables:** `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`, the four `STRIPE_PRICE_*` / `STRIPE_PRICE_INSTALL_*`
   ids, and `STRIPE_PRICE_WEBSITE_SERVICE`.
3. **Delete the `STRIPE_WEBHOOK_SEKRET` binding** (misspelt, plain text).
4. **Subscribe the live webhook endpoint** to `checkout.session.completed`,
   `invoice.payment_failed`, `charge.refunded` and `charge.dispute.created`.
5. **Deploy** (the checkout price guard and the dashboard changes ship with it).
6. Re-run `npm run billing:audit -- --live --env-file <file>` and expect no failures.

Until step 1-2 are done, live checkout stays closed by design: the new guard
refuses a Price that does not match the catalog.

## Decisions for the user

- **Legacy labels.** `growth` and `receptionist` show as Professional, `starter`
  as Essential, with their real (smaller) feature lists. Growth lacks AI call
  transcripts and AI phone booking; Starter has no voice. Moving those customers
  onto the new plans and entitlements is a billing change and needs a per-customer
  decision. Today it only changes the label.
- **Self-serve plan changes.** The portal has them off. Turn them on in Stripe if
  customers should upgrade or downgrade themselves; the webhook already handles it.

## Files

Added: `src/lib/plan-names.ts`, `src/product/saas/billing-summary.ts`,
`src/product/saas/billing-view.ts`, `src/product/saas/stripe-plan-audit.ts`,
`scripts/audit-stripe-plans.ts`, `tests/unit/plan-sync.test.ts`,
`tests/unit/stripe-plan-audit.test.ts`, `tests/plan-sync.spec.ts`.

Changed: `entitlements.ts`, `plan-catalog.ts`, `stripe-checkout.ts`, `tenant.ts`,
`billing/page.tsx`, `app/settings/page.tsx`, `app/referrals/page.tsx`,
`app/onboarding/page.tsx`, `pricing/page.tsx`, `AppShell.tsx`,
`OnboardingWizard.tsx`, `receptionist/voice/_shared.ts`, `profile-service.ts`,
`account-export/sources.ts`, `demo-video/timeline.ts`, `messages/en.json`,
`messages/fr.json`, `missed-call/postgres-store.ts` (test seam
`setPgPoolForTests`, unused by application code), `package.json`
(`billing:audit`), `scripts/stripe-setup-plan-prices.js` (`--product-essential` /
`--product-professional` to reuse existing products; checked against a faked
Stripe, a dry run sends no writes), `.env.example`, `docs/STRIPE_BILLING.md`, and the tests
`plan-catalog`, `saas-foundation`, `stripe-checkout`, `receptionist-voice-routes`,
`support/workspace-session`.

## Test results

| Criterion | Covered by                                                                                  |
| --------- | ------------------------------------------------------------------------------------------- |
| PLAN-01   | unit: Essential name, $249 + $1,999.99, features; e2e: en and fr                             |
| PLAN-02   | unit: Professional name, $349 + $1,999.99, features; e2e: en and fr                          |
| PLAN-03   | unit: `billingPlanCard` in every state; e2e: dashboard shows the provisioned plan            |
| PLAN-04   | unit: dashboard features = website comparison table, names and prices identical; e2e: pricing page vs billing and settings |
| PLAN-05   | unit: mapping, entitlements pinned, legacy sync keeps plan and active status, Stripe only read; e2e: growth and starter customers |
| PLAN-06   | unit on real SQL (PGlite): subscription and invoice events, every price maps to its plan, unmapped price refused with 503 |
| PLAN-07   | unit on real SQL: upgrade, downgrade, overlapping subscriptions, one subscription row, Stripe never written |
| PLAN-08   | unit on real SQL: repeated reads agree; e2e: refresh and fresh login                         |
| PLAN-09   | unit: messages and source scanned; e2e: customer pages scanned in both languages              |
| PLAN-10   | unit: bookings route 402 for Essential, 200 for Professional, locked when inactive; e2e: link, API and notice |
| PLAN-11   | unit on real SQL: every Stripe status, scheduled cancellation, deleted customer, recovery     |
| PLAN-12   | unit on real SQL: six concurrent deliveries; five concurrent paid-setup events create exactly one subscription |

Run on 2026-11-18: `tsc --noEmit` clean; `npm run lint` clean (0 warnings);
`npm run check:i18n` OK (3,058 keys); `npm run test:unit` 2,861 pass, 1 fail,
3 skipped of 2,865; Playwright `plan-sync` + `pricing` 23/23 (system Chrome,
webpack build), no `MISSING_MESSAGE`.

The 1 failure is `call-activity` "shows the stored UTC time in the business's own
zone" (a timezone-data test that fails the same way on `main` on this Node). The 3
skips are the suites gated on `*_TEST_DATABASE_URL`.

### Not verified here

- **True multi-connection lock contention (PLAN-12).** PGlite has one connection, so
  the advisory lock is never contended. The real-Postgres suite in
  `tests/unit/stripe-billing.test.ts` (`STRIPE_BILLING_TEST_DATABASE_URL`) was not
  run: there is no Postgres or Docker on this machine.
- **The Stripe-synced dashboard in a browser.** The e2e harness has no Postgres, so
  status and next-charge text are verified through `billingPlanCard` and the SQL
  tests, not on a rendered page with a live subscription.
- **Anything against live Stripe, the live Worker or the production database.** The
  Stripe MCP needs a fresh sign-in (`mcp__claude_ai_Stripe__authenticate`); the
  audit above used read-only API calls.
