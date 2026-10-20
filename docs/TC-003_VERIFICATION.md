# TC-003 verification — 2026-10-20

Development branch: `tc-003-stripe-subscriptions`. No commits or pushes were made.

## Implemented behavior

Subscription creation, changes, cancellation, pause/resume, and invoice payment
success/failure reconcile the organization's plan/status in Supabase. Backend
authorization reloads those values for existing sessions. Event receipts and
account updates commit atomically; errors return 503 for Stripe retries. Current
Stripe state handles reordered events and multiple/replacement subscriptions.
Trusted price IDs select plans. Test signatures and keys are separated from live
configuration; test billing can only update demo organizations.

Customer metadata supplies the initial organization mapping, which becomes a
durable unique binding. Customer deletion revokes its previously bound access
even after Stripe removes metadata. See [configuration and access policy](STRIPE_BILLING.md).

## Staging evidence

The configured remote staging Worker is not provisioned. Verification used an
isolated native PostgreSQL database named `tc003_staging`, labelled synthetic
organizations, and the connected Stripe test account. Test helpers refuse remote
or differently named databases before truncating test tables.

- 26 billing/database checks passed: signature and mode boundaries, durable-storage
  requirements, Growth activation, plan downgrade, payment failure/recovery,
  scheduled/immediate cancellation, replacement subscriptions, trials, duplicate
  concurrent events, reordered events, unknown prices, tenant isolation,
  customer deletion, rollback after API/database failures, and socket cleanup.
- Real Stripe test PaymentMethods verified declined initial payment, successful
  payment recovery activating Growth, downgrade, scheduled cancellation, and
  cancellation followed by an old paid event. Test customers were deleted.
- Full unit suite: 619 passed; one existing unrelated integration test skipped.
- Production browser suite: all 157 passed.
- TypeScript, changed-file lint/format, i18n, legal, media, and secret checks passed.
- Next production build, OpenNext build, and Wrangler bundle dry run passed.

Existing repository-wide gates still fail outside this change: lint has 10
existing errors and 13 warnings, format check reports existing unformatted files,
and `worker-configuration.d.ts` is stale. Changed billing/connection files pass
their targeted checks; the SaaS store retains its existing unused `PlanId` warning.

## Cloudflare runtime finding

The initial live permission probe exposed a pre-existing connection lifecycle
problem. A first Growth request returned 200; subsequent requests intermittently
returned 500. The local Cloudflare runtime reproduced a canceled/hung request
after a prior request's PostgreSQL socket was reused.

The billing, SaaS, and Growth adapters now keep a connection facade that opens
connections within the current Worker invocation and closes them after each
query/transaction. Node servers retain normal pooling. Five successive
authenticated Growth requests returned 200 in the rebuilt local Worker runtime.

## Production verification

Migration `021_stripe_billing` was applied transactionally. All three billing
tables have RLS enabled, with no public API policies; the app's server role retains
access. A checksum of every pre-existing organization's ID, plan, status, and
update timestamp confirmed the migration changed none of them.

The deployed test endpoint uses separate secret bindings and labelled test-only
prices. Both durable-store flags remain enabled. No existing secrets were removed.

Final production version: `0997de1e-b002-4f62-a589-97523606bc2c`, verified as the
only active version at 100%. The live health endpoint returned HTTP 200.

Stripe's own signed test deliveries created the persisted subscription record
before any synthetic replay was sent. The following production checks passed:

- Declined initial payment stored the subscription and kept access suspended.
- Paying the invoice activated Growth. An existing session cookie still claiming
  Starter gained access to the Growth pipeline endpoint (HTTP 200).
- Replaying the same signed event returned `duplicate: true`.
- A Stripe price downgrade changed the organization to Starter; the Growth
  pipeline endpoint returned HTTP 402.
- Scheduling cancellation retained Growth and allowed HTTP 200 until cancellation.
- Immediate cancellation changed the organization to churned and denied account
  access (HTTP 401). A late paid event did not reactivate it.
- A replacement subscription activated Growth; deleting the Stripe customer then
  automatically revoked access through Stripe's subscription-deletion delivery.
- Checksums confirmed all pre-existing organization plans/statuses were unchanged.

The test Stripe customer, demo organization, owner, session, and associated billing
rows were removed after verification. The temporary local signing-secret file was
deleted. The labelled test prices and test webhook configuration remain available
for demo-only billing tests. No existing customer data was changed.

## Live billing readiness

The available Stripe API key is test mode. No live API key, live endpoint signing
secret, or live Starter/Growth Price IDs are configured. This change must not be
marked fully complete for live billing until those are configured and the live
customer-to-organization mappings are established. No real charges were made.
