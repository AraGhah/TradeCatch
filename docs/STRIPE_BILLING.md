# Stripe subscription synchronization

`POST /api/webhooks/stripe` verifies the raw-body signature and reconciles current
Stripe subscriptions into the Supabase PostgreSQL organization record. Backend
authorization loads that record on each request, so existing sessions immediately
receive the updated plan and account status.

## Configuration

Apply migration `021_stripe_billing` using `npm run db:schema`. The webhook requires
`DATABASE_URL` and either `SAAS_DURABLE_STORE=1` or `MISSED_CALL_DURABLE_STORE=1`.
It never uses the memory store.

For live billing configure these server secrets/variables:

- `STRIPE_SECRET_KEY`: the account's live secret API key.
- `STRIPE_WEBHOOK_SECRET`: the live endpoint's signing secret.
- `STRIPE_PRICE_STARTER` and `STRIPE_PRICE_GROWTH`: trusted recurring Price IDs.
  Comma-separated values support monthly, annual, and retired prices. Keep legacy
  IDs while historical subscriptions still reference them. A price must map to
  exactly one plan. Unknown or mixed-plan subscription items fail with HTTP 503
  and do not change access.

Register a **snapshot** webhook endpoint at
`https://tradecatch.ca/api/webhooks/stripe`, with these events:

- `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `customer.subscription.paused`,
  `customer.subscription.resumed`
- `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`,
  `invoice.payment_action_required`
- `charge.refunded`, `charge.dispute.created` — **referral program only**
  ([docs/REFERRAL_PROGRAM.md](./REFERRAL_PROGRAM.md)). They reject or flag the
  referral reward a payment earned and never change subscription or access
  state. Optional: a reward is also re-verified against Stripe at approval.

The server reads Stripe using API version `2025-02-24.acacia`. Event snapshots are
only routing hints; each delivery retrieves current customer/subscription state.
This also supports invoice events whose subscription reference moved between
Stripe API versions.

Before a customer's first subscription, set the Stripe **Customer** metadata
`organization_id` to the existing TradeCatch organization ID using your trusted
server integration or Stripe Dashboard. The first successful synchronization
persists a unique customer-to-organization binding. Emails, subscription amounts,
and metadata claiming a plan cannot grant permissions. Changing customer metadata
cannot reassign an existing binding. Each organization has one billing customer;
multiple subscriptions for that customer are reconciled together. An unrelated
customer with no mapping is acknowledged without modifying an account. Connect
events are unsupported and cannot modify platform organizations.

For testing, configure `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`,
`STRIPE_TEST_PRICE_STARTER`, and `STRIPE_TEST_PRICE_GROWTH` separately. A test key
in `STRIPE_SECRET_KEY` can serve as the test API key fallback, but cannot process
live events. Test signatures cannot authorize live events. Test subscriptions
may only change organizations whose `account_type` is `demo`. Never use test
billing to activate a production organization.

## Access policy

| Current Stripe state                                    | Organization access                                   |
| ------------------------------------------------------- | ----------------------------------------------------- |
| `active` or `trialing`                                  | Active with the mapped plan                           |
| Active, cancellation scheduled at period end            | Retain plan/access until Stripe ends the subscription |
| `past_due`, `unpaid`, `incomplete`, or `paused`         | Suspended; Growth permissions removed                 |
| All subscriptions canceled/expired, or customer deleted | Churned; Growth permissions removed                   |
| Payment recovered and subscription becomes active       | Restore the mapped plan/access                        |

An active Growth subscription takes precedence over Starter; cancellation of an
old subscription cannot revoke access provided by its active replacement.
Suspension starts immediately on `past_due`; Stripe remains responsible for
payment retries and customer billing communications. This webhook does not change
Stripe's retry settings or charge a customer.

## Delivery safety

Private, RLS-protected tables store customer bindings, subscription status, and
processed event IDs. An event receipt and its organization changes commit in the
same transaction. Database/API/configuration failures return HTTP 503, roll back
the receipt, and allow Stripe to retry. Historical `tc_webhook_receipts` are not
used for billing deduplication because the earlier handler acknowledged events
without updating subscriptions; old events can therefore be replayed for repair.

A customer lock serializes reconciliation before reading Stripe. Refreshing
current subscriptions handles late, reordered, and same-second events without
sorting by event timestamps. Duplicate committed event IDs return HTTP 200 with
`duplicate: true`. No event payload, key, card details, or customer email is logged.

Cloudflare sockets cannot be reused across requests. The billing, tenant, and
Growth database adapters retain a facade that opens query/transaction connections
inside the current Worker request and closes them after use. Ordinary Node servers
retain connection pooling. This prevents a successful first request from leaving
a socket that causes a later permission check or webhook to hang.

Replay an undelivered event through Stripe Workbench after correcting a missing
configuration or database issue. A previously synchronized event is deduplicated;
use a later event or a fresh Stripe subscription update to refresh its state.

References: [subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks),
[event ordering and retries](https://docs.stripe.com/webhooks), and
[Stripe test PaymentMethods](https://docs.stripe.com/testing).

## Overage invoicing (built, switched off)

Usage past a plan's written allowance is metered (`tc_usage_counters`) and, the
first time an allowance is passed in a month, a `pending` confirmation is opened
and the owner is emailed (`tc_usage_overage_confirmations`). A pending or declined
overage bills nothing. Allowances in `src/lib/plans.ts` are still marked
provisional.

`POST|GET /api/billing/overage-invoices/tick` (ops bearer, same as the other
ticks) turns last month's **owner-confirmed** overage into one pending Stripe
invoice item per business and metric, which Stripe rolls into the customer's next
subscription invoice. It is **not scheduled**: nothing calls it until someone does.

It does nothing unless every one of these is set:

| Variable                          | Meaning                                              |
| --------------------------------- | ---------------------------------------------------- |
| `OVERAGE_INVOICING`               | must be exactly `1`                                  |
| `OVERAGE_RATE_SMS_SEGMENT_CENTS`  | whole cents per SMS segment past the allowance (CAD) |
| `OVERAGE_RATE_VOICE_MINUTE_CENTS` | whole cents per call minute past the allowance (CAD) |

There are deliberately no default rates. With the flag off or a rate missing the
route answers `{ ok: true, enabled: false, reason }` without reading the database
or calling Stripe.

How it stays safe:

- **Only confirmed units.** Units come from `confirmedOverageUnits()`, which is 0
  for a pending, declined or never-opened overage. A confirmed or declined answer
  cannot be changed afterwards.
- **Closed months only.** The month before "now" is billed; the month still
  accruing never is.
- **Claim, then send.** A row in `tc_usage_overage_invoices` (primary key
  organization + metric + month) is inserted first with the units, rate and amount
  frozen. A month with a row is never recalculated, so usage that arrives after
  the month closed is not billed on top.
- **Idempotent Stripe call.** The invoice item is created with the idempotency
  key `overage:{organization}:{sms_segments|voice_minutes}:{YYYY-MM-01}`, so a
  retry after a crash or a timeout cannot create a second charge.
- **Stale claims go to a person.** A claim still `pending` after 20 hours (inside
  Stripe's 24-hour idempotency window) is marked `needs_review` instead of being
  retried blindly. Resolve it in Stripe, then update the row by hand.
- **No Stripe customer, no claim.** A business without a customer row is skipped
  and picked up on a later run once it has one.
- **Test and live stay separate.** The invoice item uses the key matching the
  customer's stored `livemode`.

Before enabling: the owner must approve the allowances, the per-unit rates and the
customer-facing overage terms; apply the schema (`npm run db:schema` creates the
table); then set the three variables and call the tick once for the month. Check
the pending items in Stripe before the next invoice finalizes.

Verified with a fake Stripe in `tests/unit/overage-invoicing.test.ts` and with the
real SQL (concurrent counters, single overage open, claims, retries, constraints)
in `tests/unit/usage-billing-postgres.test.ts`, which needs a disposable `*_staging`
database in `USAGE_BILLING_TEST_DATABASE_URL`. No real Stripe call has been made.

## TC-009 / TC-010 — Subscription checks and customer billing portal

TC-009 repeats the subscription-sync finding originally fixed as Problem 3.
The current webhook already covers creation, updates, cancellation, payment
failure and recovery. Its PostgreSQL suite is now mandatory in the quality job,
using a disposable PostgreSQL 16 service and fictional data. It no longer skips
that suite in GitHub Actions. Local validation ran 50 focused tests with zero
failures/skips against isolated PostgreSQL, covering billing, portal access and
login confirmation.

TC-010 replaces STRIPE_BILLING_PORTAL_URL with POST /api/billing/portal.
Owners/admins of the signed-in organization can create a fresh Stripe session.
The endpoint reads customer_id and livemode from tc_stripe_customers, never from
the browser, an email address, a URL parameter or organization metadata supplied
by the caller. Unlinked businesses receive HTTP 409; provider/storage/configuration
failures return a generic HTTP 503. No customer is automatically created.

The existing live/test API keys are reused. Demo organizations require test-mode
bindings, and production organizations require live-mode bindings. The portal
uses the Stripe account's default Billing Portal configuration in the matching
mode: enable the desired invoice, payment-method and subscription features in
Stripe's portal settings before customer use. A missing/default inactive portal
configuration fails visibly; it never falls back to a shared static URL.

The server fixes return_url to /billing (French /fr/facturation) on the configured
NEXT_PUBLIC_SITE_URL origin. Browser-supplied return URLs and customer/mode/org
overrides are rejected. JSON clients receive the validated Stripe session URL
and navigate there; ordinary form POSTs receive a 303 redirect. The only allowed
destination is an HTTPS billing.stripe.com portal session. Responses are private
and not cached. Session URLs/tokens and provider response bodies are not logged
or included in audit events.

The endpoint verifies a signed, unexpired, non-revoked session and current
membership. It requires the organization's own owner/admin role; platform-admin
status alone grants no billing override. It rejects cross-site cookie writes and
oversized/invalid bodies, limits requests to five per user/business per ten
minutes, and records billing_portal_created / billing_portal_failed audit events.

Billing recovery is available outside /app. Inactive owners/admins may complete
normal magic-link confirmation and reach the billing page; inactive members
cannot sign in. Billing access returns no product features for inactive accounts.
All normal tenant/feature helpers still reject inactive organizations, and only
the webhook can restore the plan/access after Stripe confirms an active state.
The page and button are available in English and French, with retryable errors.

Focused tests cover authorization, tenant isolation, forged/revoked/expired and
mismatched sessions, POST/303 behavior, CSRF, input bounds, mode separation, bad
provider responses, missing bindings, recovery restrictions and rate limits.
Browser coverage exercises missing-link/provider errors and a fake Stripe portal
redirect without contacting payment providers. Full CI remains the release gate.

No new database migration or Stripe package is required. The customer-binding
tables from migration 021_stripe_billing remain the system of record.

Portal API reference:
[Create a portal session](https://docs.stripe.com/api/customer_portal/sessions/create).

Optional server-only configuration selectors: STRIPE_BILLING_PORTAL_CONFIGURATION
(live) and STRIPE_TEST_BILLING_PORTAL_CONFIGURATION (test). Set a bpc_ ID to use
an API-created configuration instead of Stripe's dashboard default. Test-mode
sessions never fall back to the live configuration selector. A dedicated test
configuration was provisioned for verification; it enables invoice history,
payment-method updates and cancellation at period end. No live configuration
or live credential was created or changed.
