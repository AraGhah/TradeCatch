# KAN-20: TradeCatch administration console

Status: built and verified locally, **committed and pushed, not deployed**. Read
[Verification record](#verification-record) and
[What was not verified](#what-was-not-verified) before treating this as done.

This replaces the loose set of admin pages with one console: Overview,
Businesses, Subscriptions, Payments, Website requests, System health and Audit
logs. It reuses the existing authentication (the session cookie, the second
factor and the short-lived admin token), the existing PostgreSQL stores, Stripe
sync, reliability service and rate limiter. It does not add a second login, a
second user table or a second Stripe integration.

## Access control

Who is an administrator is unchanged: an address on `TRADECATCH_ADMIN_EMAILS`, a
user with `platform_role = 'admin'`, or the operations secret. **What an
administrator may do** is new, and is decided on the server for every request.

```
TRADECATCH_ADMIN_EMAILS="founder@x.ca, helper@x.ca:support, cfo@x.ca:read_only"
```

An entry without a suffix is a `super_admin` (what every existing entry already
meant, so nothing changes on deploy). An unknown suffix fails closed to
`read_only`. Roles are set only in this operator-controlled list; there is no
form that assigns one, so an administrator cannot promote themselves.

| Permission | super_admin | support | read_only |
| --- | :-: | :-: | :-: |
| `admin.read` (dashboards, lists, health, billing data) | yes | yes | yes |
| `audit.read` (audit log) | yes | yes | no |
| `business.write` (edit a business, activate/suspend/deactivate) | yes | yes | no |
| `business.create` (create a customer account) | yes | no | no |
| `billing.write` (change a subscription through Stripe) | yes | no | no |
| `website.write` (review requests, quote, record payment) | yes | yes | no |
| `admin.manage` (every other state-changing admin route) | yes | no | no |

The operations secret is a `super_admin` named `ops:<actor>` in the audit log.

Every route under `/api/admin` goes through `guardAdmin(request, permission)`:
CSRF/origin check, then authentication (session + verified second factor +
admin token, or the ops secret), then the permission, then the
`admin.console-write` rate limit on mutations (60 per second per administrator;
documented in `docs/RATE_LIMITS.md`). `tests/unit/admin-route-authz-coverage.test.ts`
fails the build if any admin route file lacks that guard or names a permission
that does not exist, so a new route cannot ship unprotected. The pages are
protected by the admin layout (redirects a customer to `/app`); the page check
is a convenience, the API check is the control.

A customer can never reach another business's data through these routes: they
all refuse a non-administrator with 403, and the customer-facing `/api/app/*`
routes are unchanged and still scoped to the caller's own organization.

## Views

| View | Route | Data |
| --- | --- | --- |
| Overview | `/admin` | `GET /api/admin/overview` |
| Businesses | `/admin/businesses`, `/admin/businesses/[id]` | `GET/POST /api/admin/businesses`, `GET/PATCH /api/admin/businesses/[id]`, `POST .../status` |
| Subscriptions | `/admin/subscriptions` | `GET /api/admin/subscriptions`, `POST /api/admin/subscriptions/[id]` |
| Payments | `/admin/payments` | `GET /api/admin/payments` |
| Website requests | `/admin/website-requests` | `GET /api/admin/website-requests`, `GET/PATCH .../[id]` |
| System health | `/admin/system-health` | `GET /api/admin/health` |
| Audit logs | `/admin/audit-logs` | `GET /api/admin/audit-logs` |

`/admin/billing` redirects to Subscriptions. The existing reliability desk is
kept under `/admin/monitoring` (renamed "Reliability desk" in the menu), because
it carries the incident workflow and per-area drill-downs this console does not
replace.

Every view shows loading, empty, error (with retry) and success states; keeps
the previous rows on screen (dimmed) while a filter or page change loads; shows
when it was last updated with a Refresh button; and Overview and System health
refresh themselves every minute while the tab is visible. Tables become cards
below 768 px, the menu folds into a button, and controls are at least 40 px
tall. Every action button is disabled while its request runs, and the shared
`useAdminAction` hook refuses a second call outright (a ref, not just a disabled
button), so a double-click or a held Enter key sends one request.

### Businesses

Search (name, city, owner email), filter (status, plan, account type, created
date), pagination. The detail page shows plan, status, the Stripe subscription,
the services the plan includes (and whether each is launched platform-wide), the
receptionist/phone line and the integration status, and lets an administrator
edit name, industry, city, phone, service area, time zone and default language.
Only changed fields are sent. Plan is **not** editable there: plan changes go
through Stripe (below), so the database and Stripe cannot disagree.

Creating a customer account (`business.create`): business name, owner name and
email, plan (Essential or Professional), language, optional phone, city and
industry. The server validates strictly (unknown fields are refused), creates the
business and its owner, and optionally emails the owner a single-use link to
choose a password. No password is ever shown, set or stored by an administrator.
The create runs under an in-process queue and a PostgreSQL advisory lock keyed on
the owner's email, so concurrent identical requests produce one business and the
rest get `409 email_exists`. Public registration stays closed: an address nobody
created cannot obtain a session.

Deactivating (`churned`), suspending or reactivating a business needs the typed
confirmation word (`deactivate` / `suspend` / `activate`). A non-active business
is refused by the tenant check on every customer API call (403).

### Subscriptions and Payments

Reads go to Stripe through one injectable client. Keys follow the existing rule
(`sk_live_` / `sk_test_` only; a test key is accepted from either variable and
the page says "test mode"). The page shows the real Stripe price for Essential
and Professional next to the catalog price (`PLAN_PRICES` in `src/lib/plans.ts`:
$249.99 and $349.99 CAD a month) and flags a difference, for example a Stripe
price left at an old amount. The catalog was moved from $249 / $349 to
$249.99 / $349.99 to match the live Stripe prices (see "Plan price change"
below); the console never edits a Stripe price.

Each subscription shows its status (`active`, `trialing`, `past_due`, `unpaid`,
`canceled`, `incomplete`, ...), amount, next billing or end date, and whether
TradeCatch's own record agrees (in sync / differs in status, plan or
cancellation / not recorded yet). Payments shows Stripe invoices with status,
amounts due/paid/remaining, due date, a hosted-invoice link, and the outstanding
and overdue balance per currency, plus every payment outcome Stripe has reported
to the webhook (`invoice.payment_failed`, `payment_action_required`,
`invoice.paid`). Those outcomes are stored in `tc_billing_events`, so a failed
payment stays visible even if Stripe cannot be reached.

If Stripe is not configured, or cannot be reached, the pages say so and fall back
to TradeCatch's own subscription records (labelled as such). They never invent
numbers.

Changing a subscription (`billing.write`) supports exactly three actions on an
**existing** subscription: switch between Essential and Professional, cancel at
the end of the billing period, and resume a pending cancellation. It never
creates a subscription, an invoice or a charge:

- a plan change updates the existing subscription item with
  `proration_behavior=none` and `payment_behavior=error_if_incomplete`, so the new
  price applies from the next invoice and a change that would need a payment is
  refused rather than attempted;
- the request carries an idempotency key (per subscription, action, target and
  minute) so a retry cannot apply it twice;
- the administrator types a confirmation word, and the dialog spells out the
  consequence before it can be confirmed;
- only subscriptions TradeCatch manages (mapped to a business in the database)
  that are active/trialing, single-item and in the same Stripe mode as the server
  can be changed;
- after Stripe accepts the change, the subscription is read back and the existing
  `synchronizeStripeBilling` is run, which updates the business's plan and
  entitlements. The response and the page say whether the database now agrees
  with Stripe and whether entitlements were updated; if either is not yet true the
  page says so, and Stripe's own webhook converges it.

MRR on Overview comes from Stripe (cached 60 seconds). If Stripe is unavailable it
falls back to the catalog price of each active subscription and **says it is an
estimate**.

### Website requests

Lists requests with customer details, services (type and focus areas), submitted
date, status and payment status; filter by status (chips with counts), payment,
business, date and text. Statuses shown to administrators: Pending, Under review,
Approved, Quote sent, In progress, Completed, Rejected, Cancelled. The transition
rules live in one place (`src/product/website-services/model.ts`) and are enforced
by the server, not the buttons:

- a request must be **reviewed** before it can be approved, quoted or started;
- a rejection needs a written reason (the internal note) and a typed confirmation;
  rejection and cancellation are final;
- nothing moves to Quote sent, In progress or Completed without a written scope
  and a final price; the website service has one published price ($699.99 CAD),
  so any other price is refused, and once work has started the agreed scope and
  price are locked;
- payment can only be **requested** once the work is approved, quoted or in
  progress and has a price (the button is disabled and says so until then), and
  "requested", "paid" and "waived" only **record** the state: this code path has
  no Stripe call, so nothing is ever charged from this page;
- every step is appended to an append-only history (who, when, from/to) that is
  protected by a database trigger.

When a request arrives, the configured team mailbox is emailed and the result is
recorded on the request as `sent`, `not_configured` or `failed` (shown in the
detail and in its history). A failed or missing email never blocks saving the
request: the row is the record.

### System health

Real backend data from the reliability service and the environment: database
connectivity, per-provider checks (Twilio voice/SMS, Bland AI receptionist,
Stripe, Google Calendar, notifications, jobs), which integrations have their
credentials configured (presence only, never values), API request volume, server
error rate and latency, recent errors, webhook failures, failed jobs and
incidents. Filter by business, status, service and date range. A forged webhook
delivery (bad signature) is recorded at low severity at most once a minute per
server instance, so it is visible but cannot flood storage or raise a false
incident. Anything that cannot be known is shown as Unknown / Not configured /
Not connected rather than healthy. **Cloudflare's own analytics are not connected**:
the "Worker/API errors" here are the failures this app recorded itself, and the
page says so.

### Audit logs

`tc_audit_logs` is append-only: a database trigger rejects `UPDATE` and
`DELETE`, and there is no write route (`POST/PATCH/PUT/DELETE` on
`/api/admin/audit-logs` return 405). Each sensitive action records who (user id,
email, role, or `ops:<actor>`), what (action, target, business), when, the
outcome (`success`, `denied`, `failed`) and a field-by-field before/after
summary. Contact details are masked (`j***@x.ca`, `***0142`), values are capped,
and any field named like a password, secret, token, key or card is recorded as
"changed" with no value; anything that looks like a secret is redacted. A refused
attempt (wrong role, wrong confirmation word) is recorded too, which is how
repeated refusals by one administrator become visible. Search by text, action,
business, outcome and date range; paginated. `TRUNCATE` is intentionally left
open for the staging demo reset; revoke it before relying on the log as evidence.

## Alerts

Overview lists open alerts, each with a link to where it is handled: failed
payments (30 days) and past-due subscriptions, webhook failures, service errors,
open incidents, failed jobs, website requests awaiting review, and suspicious
administrator activity (any administrator request refused in the last 24
hours: a warning, and critical from five).

## Database changes

`migration 041_admin_console` (idempotent; registered in
`scripts/apply-missed-call-schema.js`, SQL in
`src/product/admin-console/schema.sql`):

- `tc_audit_logs`: `actor_email`, `actor_role`, `outcome`, `changes`, indexes, and
  the append-only trigger.
- `tc_billing_events`: payment outcomes from Stripe (idempotent on the Stripe
  event id), row-level security on.
- `tc_website_requests`: widened status and payment-status checks,
  `review_note`, `notification_status`.
- `tc_website_request_events`: append-only history, row-level security on.

**Deploy order:** run `npm run db:schema` against the production database
**before** deploying the code. The code tolerates the migration being absent (the
console reports "unavailable" rather than crashing), but audit detail, payment
history and website-request history are only stored once it has run. The
migration is additive: it adds columns and tables and widens two check
constraints; it drops nothing.

## Environment

No new required variables. Existing: `TRADECATCH_ADMIN_EMAILS` (now optionally
`email:role`), `STRIPE_SECRET_KEY` / `STRIPE_TEST_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET` / `STRIPE_TEST_WEBHOOK_SECRET`, the Stripe price ids,
`RESEND_API_KEY` / `RESEND_FROM_EMAIL`, and the team notification address
(`ADMIN_ALERT_EMAIL` / `RESEND_NOTIFY_EMAIL`). If no notification address is
configured the console shows the request's email status as "Not configured".

## Plan price change

Requested after the first build: the launch plans are **$249.99** (Essential) and
**$349.99** (Professional) CAD a month, each with the same $1,999.99 setup fee.
The catalog had said $249 and $349.

- **Source of truth:** `PLAN_PRICES` in `src/lib/plans.ts`. Everything that shows
  or compares a plan price reads it: the pricing, home, receptionist and billing
  pages, upgrade deltas, the MRR figures on the admin Overview and Businesses
  views, and the admin plan-price comparison.
- **Copy:** every "$249" / "$349" in `src/messages/en.json` and "249 $" / "349 $"
  in `fr.json` (18 per language) now reads `$249.99` / `$349.99` and
  `249,99 $` / `349,99 $`. `tests/unit/plan-prices.test.ts` compares the copy with
  the catalog, so a string that drifts fails the unit suite.
- **Stripe setup script:** `scripts/stripe-setup-plan-prices.js` now looks for
  (and would create) `24999` / `34999` cent prices. It was not run.
- **Website add-on email:** the team notification email said the website service
  was "starting at $349 CAD". It is a fixed $699.99, so the email now reads the
  amount from the catalog (`ADD_ONS.websiteService`).
- **What this does not do:** it does not change any Stripe price, any existing
  subscription, or any customer's billing. Existing subscribers keep whatever
  Stripe already charges them; the admin console will flag a Stripe price that
  differs from the catalog.
- **Not updated on purpose:** the `founder/` strategy documents and a captured
  `Videos/_site_probe` page still quote the old figures. They are analysis
  outputs, not product copy.
- **Corroboration:** `docs/KAN-18-PLAN-SYNC.md` records that Stripe charged
  $249.99 / $349.99 before the catalog changed (and that no subscriptions existed
  then). This branch now aligns the catalog and pricing copy with those amounts.

## Files

New: `src/lib/admin-rbac.ts`, `src/lib/admin-route.ts`,
`src/product/admin-console/*`, `src/product/security/audit-changes.ts`,
`src/product/website-services/notify.ts`, `src/app/api/admin/{audit-logs,
businesses,health,me,overview,payments,subscriptions}/**`,
`src/components/admin/console/*`, the five new pages under
`src/app/[locale]/admin/`, `tests/admin-dashboard.spec.ts`,
`tests/support/admin-session.ts`, `tests/unit/admin-*.test.ts`,
`tests/unit/support/pglite-db.ts` (also runs the same suites on a real local
PostgreSQL when `TEST_DATABASE_URL` is set), `tests/unit/e2e-harness-isolation.test.ts`,
`tests/unit/admin-real-postgres.test.ts` and `tests/unit/admin-stripe-mock.test.ts`
(the last two skip unless `TEST_DATABASE_URL` / `STRIPE_MOCK_URL` is set).

Modified: `src/lib/admin-auth.ts`, `src/lib/rate-limit-policy.ts`,
`src/product/saas/platform-admin.ts`, `src/product/security/*`,
`src/product/reliability/service.ts`, `src/product/website-services/*`,
`src/lib/validation/website-request.ts`, `src/app/api/website-requests/route.ts`,
`src/app/api/app/website-services/route.ts`,
`src/app/api/webhooks/stripe/route.ts`,
`src/app/api/admin/{businesses/[id]/status,website-requests}/**`,
`src/components/admin/{AdminNav,BusinessControls,AdminDemoBusinesses}.tsx`
(the last only changes its heading from `h1` to `h2`, so the Overview has one
`h1`),
`src/app/[locale]/admin/{page,billing/page,businesses/page,businesses/[id]/page}.tsx`,
`src/i18n/routing.ts`, `src/messages/{en,fr}.json`,
`scripts/apply-missed-call-schema.js`, `docs/RATE_LIMITS.md`,
`playwright.config.ts` (synthetic administrators, and `__NEXT_PROCESSED_ENV` so
the e2e server reads no `.env*` file).

**Changed after the first build, outside the admin console** (price change and
the accessibility failures the wider browser run turned up; each is small):

- Price: `src/lib/plans.ts`, `src/messages/{en,fr}.json` (plan price copy),
  `src/lib/email.ts` (website price in the team email),
  `scripts/stripe-setup-plan-prices.js`, a comment in
  `src/components/WebsiteServiceAddOn.tsx`; tests `plan-prices`, `plan-catalog`,
  `admin-businesses`, `admin-billing` (unit) and `pricing.spec.ts`.
- WCAG 2.5.3 "label in name" (axe `label-content-name-mismatch`), found on public
  and customer pages: `src/components/LocaleSwitcher.tsx` (the name now starts
  with the visible "EN" / "FR"), `src/components/StoryDemos.tsx` (the video card
  is named from its visible text, with a hidden "Watch the video:" cue; the
  `demoStories.watchLabel` copy lost its `{title}` placeholder) and
  `src/components/app/NotificationBell.tsx` (named from its content, so the
  unread count is announced). Spec selectors updated in `demo-and-pilot.spec.ts`.
- Test stability: `tests/referral-link.spec.ts` and `tests/support/hydration.ts`
  wait for the "Get your link" button to be interactive before clicking it;
  `playwright.config.ts` starts the e2e server with `--keepAliveTimeout 65000`
  (shared by every spec: it removes the rare `read ECONNRESET`); the admin spec
  and `tests/support/admin-session.ts` were hardened as described under
  "Verification record".

## Verification record

Run on 2026-11-18 in this worktree. The code was committed and pushed; nothing
was deployed.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | pass |
| `npm run lint` (whole repo, zero warnings) | pass |
| `npm run check:i18n` | pass, 3088 keys, EN/FR parity on current `main` |
| `npm run check:secrets` | pass, 1693 files on current `main` |
| `npm run check:legal` | pass |
| `npm run test:unit` | 3166 tests: 3162 pass, 3 skipped, 1 known time-zone-data failure on this Node |
| Focused admin and plan tests | 265 pass; another 101 plan-sync, checkout and audit tests pass |
| `tests/admin-dashboard.spec.ts` (Playwright, system Chrome, webpack production build, `TRADECATCH_E2E=1`) | 18 of 18; three runs in a row, each on a fresh server, after the last app change |
| Admin dashboard plus plan sync browser tests after rebasing on current `main` | 33 of 33 with system Chrome and the webpack production build |
| **Entire** Playwright suite (32 spec files, 2 workers) | **308 passed, 0 failed, 2 skipped** (the skips are the help-center screenshot-capture tests, which skip by design) |

The full unit count above is after rebasing onto the KAN-19 `main` branch. Its
one failure is the pre-existing `tests/unit/call-activity.test.ts` Vancouver
time-zone expectation on this Node's older time-zone data; the KAN-20 and
updated plan tests pass. The Playwright totals in the table are from the
original KAN-20 worktree before that rebase.

**Acceptance tests.** `tests/admin-dashboard.spec.ts` has one test per
criterion, titled `ADM-01` to `ADM-16`, plus a French-locale test and a test
that a failed load is never shown as an empty list.

| ID | Proves | How it is exercised |
| --- | --- | --- |
| ADM-01 | An authorized administrator signs in (magic link, MFA, admin token) and reaches every view | real server, in-memory stores |
| ADM-02 | A customer is refused every admin page and API | real server |
| ADM-03 | An administrator creates a customer; public registration stays closed | real server |
| ADM-04 | Business updates persist across reload | real server |
| ADM-05 | Deactivating a business locks its signed-in customer out on the next call; activating restores it | real server, two browser contexts |
| ADM-06 | Subscriptions show Stripe prices, statuses and billing dates | **UI contract**: `/api/admin/subscriptions*` is mocked (see below) |
| ADM-07 | A plan change needs a typed confirmation, is sent once, and reports billing and entitlement sync | **UI contract** for the Stripe path; the real route is also called and refuses with `stripe_unconfigured` |
| ADM-08 | A website request is saved, shown, and its email notification state is tracked | real server; no email provider in the harness, so the state shown is `Not configured` |
| ADM-09 | Review moves a request through the statuses; payment is only recorded, never charged | real server |
| ADM-10 | A failed payment is visible on Payments and as an Overview alert | **UI contract**: `/api/admin/payments*` and `/overview*` are mocked |
| ADM-11 | A webhook with a bad signature and a Worker/API error appear on System Health | real server |
| ADM-12 | Sensitive actions create audit rows (actor, role, time, outcome); rows are masked and read-only; search by action, target and administrator | real server |
| ADM-13 | The console is consistent after reload and after signing in again | real server |
| ADM-14 | Rapid repeated clicks and concurrent requests create one record | real server |
| ADM-15 | Wrong role, wrong identity, wrong ops secret, cross-site origin and malformed ids are refused | real server |
| ADM-16 | The console is usable at a phone width (folded menu, no horizontal scroll, cards instead of tables) | real server, Chromium phone viewport |

The server-side half of ADM-06, ADM-07 and ADM-10 (Stripe reads, plan change,
cancel, resume, drift detection, payment history, outstanding balances) is
covered by `tests/unit/admin-billing.test.ts`, which runs the real code against
a fake Stripe (`StripeHttp` is injectable) and a PGlite database.

**The wider browser run, and what it turned up.** After the price change the
whole suite was run, not only the admin spec. It failed in places this work did
not set out to touch; each was reproduced, fixed and re-run:

- Three components failed axe's `label-content-name-mismatch` (WCAG 2.5.3, the
  accessible name must contain the visible text): the EN/FR switcher, the home
  and receptionist video card, and the notification bell when it shows an unread
  count. The accessible names that satisfy the rule were checked with axe in
  Chrome before the components were changed.
- Four spec races, all in how the tests wait, none in the product: a click on a
  button before React attached to it (`referral-link`; failed 2 of 20 repeats
  before the fix, 0 of 25 after), a navigation aborted by the signed-out console
  redirecting its own tab (ADM-13), and `read ECONNRESET` from a reused idle
  socket (ADM-07, ADM-15). The last is fixed at the source by starting the e2e
  server with `--keepAliveTimeout 65000` in `playwright.config.ts`. One more
  admin test (ADM-16) once missed a 5 s wait for its first render in a full run
  with no server error logged; the admin spec now waits up to 15 s. That one is
  an inference from circumstantial evidence, not a proven cause.
- Two earlier admin-spec runs were disturbed by the machine, not the code (one had
  `net::ERR_NETWORK_IO_SUSPENDED`). `--repeat-each` cannot be used on the admin
  spec: its administrators have fixed e-mail addresses, so a second repetition
  provisions the same account twice and fails on that line. Stability was checked
  with separate runs instead.

## Verified against real services (local, throwaway), 2026-11-19

A second pass ran the work against a real PostgreSQL server and Stripe's own API
validator instead of fakes. All of it was local: a Docker container bound to
`127.0.0.1`, deleted afterwards. Nothing touched production, staging or a real
Stripe account.

| Check | Result |
| --- | --- |
| Browser harness isolation | In a checkout that has a production `.env.local`, all 18 admin tests failed at setup (500, `Refusing in-memory SaaS store when SAAS_REQUIRE_DURABLE=1`) and about 58 further production names (live provider keys among them) reached the test server. `playwright.config.ts` now sets `__NEXT_PROCESSED_ENV`, so `next build` and `next start` read no `.env*` file. With a synthetic `.env.local` containing `SAAS_REQUIRE_DURABLE=1` planted, the admin spec passes 18 of 18, and also 18 of 18 in the clean worktree. `tests/unit/e2e-harness-isolation.test.ts` proves it on the installed Next (with a control showing the leak is real) and fails loudly if an upgrade changes it. |
| Real migration chain | PostgreSQL 16.14. `npm run db:schema` applied all 41 files, twice, exit 0 both times. Migration `041_admin_console` recorded; the four tables and both append-only triggers exist. |
| Store suites on the real server | `admin-audit`, `admin-billing`, `admin-website-requests`: 72 of 72 on PGlite and on PostgreSQL 16 (3 runs, 75 tests with the lock tests below). Run them on a real server with `TEST_DATABASE_URL` (a local host only; each test gets its own database, dropped afterwards). |
| Advisory lock across connections | `tests/unit/admin-real-postgres.test.ts`: six connections asking for one key run one at a time; different keys run together; the lock is released when the work throws; `pg_locks` shows none left. |
| Two live app instances, one database | The production build on ports 3101 and 3102, ops secret. All 7 admin GET APIs 200, health `SELECT 1 succeeded`. Eight concurrent creates for one owner email, split across both instances: one 201, seven 409. In the database: 1 organization, 1 user, 1 membership; audit rows 1 `admin_business_created`, 7 `admin_business_create_refused`, actor `ops:...`; an `UPDATE` on the audit table is rejected by the trigger. No errors in either server log. |
| Requests against Stripe's API specification | `stripe-mock` 0.206.0 (Stripe's official validator) with the console's real client: every subscription status filter, every invoice filter, pagination cursors, price and subscription retrieval, the plan-switch request (`items[0][id]`, `items[0][price]`, `proration_behavior=none`, `payment_behavior=error_if_incomplete`) and resume are accepted. A bad enum value, a misspelled parameter and a non-boolean are each refused with 400, so the test can fail. `tests/unit/admin-stripe-mock.test.ts`, opt in with `STRIPE_MOCK_URL`. |

Full default unit suite after these changes: 3169 tests, 3165 pass, 3 skipped,
1 fail (the known `call-activity` Vancouver time-zone test on this Node).
`tsc --noEmit` and lint are clean.

**Things the real server showed that the in-process one hid**

- The `tests/unit/admin-website-requests.test.ts` double-click test assumed that
  of two concurrent approvals exactly one succeeds. Over 200 runs on PostgreSQL,
  199 gave one success and one `conflict`, and 1 gave two successes: the second
  call read the request after the first committed, saw it already approved, and
  succeeded as a no-op. The history held exactly one `approved` row in all 200.
  The test now asserts that invariant (one history row; a loser is refused with
  `conflict`) instead of the scheduling assumption. **Residual:** in that rare
  race the route audits both calls from the `before` it read earlier, so one
  extra `admin_website_request_updated` audit row can repeat a change the other
  call made. State and history are never duplicated. Not changed; fixing it means
  letting `adminUpdate` report "nothing changed" so the route can skip the row.
- `withAdvisoryLock` takes a session-level `pg_advisory_lock`, which waits without
  limit, although its comment says a lock that cannot be taken never blocks the
  work forever. It is correct on a direct connection (tested above). It is only
  safe if `DATABASE_URL` is a direct or **session-mode** connection (port 5432).
  Through a transaction-mode pooler (Supabase port 6543, PgBouncer transaction
  mode, Cloudflare Hyperdrive) the lock and its unlock can land on different
  backends, so a lock can stay held and later creates for that email would wait.
  Which one production uses was not checked. Decide before deploying whether to
  confirm session mode or switch to `pg_try_advisory_lock` with a time limit.

## What was not verified

These need an environment this session did not have. Until they are checked,
KAN-20 should not be called complete.

- **Real Stripe.** No call was made to a real Stripe account, test mode or live.
  `stripe-mock` (above) proves the requests are valid against Stripe's
  specification; it returns canned fixtures, so it cannot show real prices,
  statuses, invoices, proration or what a plan change does to a real customer.
  ADM-06, ADM-07 and ADM-10 remain UI-contract tests in the browser. The catalog
  says `$249.99` / `$349.99`, which is what the live Stripe prices were reported
  to be; that came from earlier notes and was not re-read from Stripe, so the
  first real look at the Subscriptions page will confirm whether they agree. The
  webhook signature path was not exercised against Stripe either.
- **Production-like PostgreSQL.** The migration, the stores and the lock now run
  on a real PostgreSQL 16 (above), but a plain local server: no SSL, not the
  production pooler or connection mode, and migration `041` has not been run on
  staging or production.
- **Real email.** The `sent` and `failed` notification states are unit-tested
  with an injected sender. No message was delivered; the browser test shows
  `Not configured`.
- **Twilio, Bland and Cloudflare.** System Health reads existing configuration
  and recorded failures. No live provider was called, and Cloudflare is reported
  as "Not connected" because the harness has no Cloudflare data.
- **Cloudflare Worker entry.** The browser tests ran the webpack production
  build under `next start`, not the OpenNext Worker bundle on Cloudflare.
- **Phones.** ADM-16 uses a Chromium phone viewport, not a real device.
- **Deployment.** Nothing was deployed, as instructed. `npm run db:schema` must
  run against the production database before the code is deployed.
