# KAN-26: Loading, processing and feedback states

Status: built and verified locally, **uncommitted, not deployed, not marked
complete**. Read [Verification record](#verification-record) and
[What was not verified](#what-was-not-verified) before treating this as done.

Every button, form and page that waits on the server now says so, cannot be
submitted twice, and tells the truth about what happened: "Saved" only after the
server confirmed it, and "we could not confirm this" (not "it failed") when the
answer was lost. This reuses the KAN-11 request layer (`requestJson`,
`ApiError`) and the server-side protections that already exist. No server route,
migration or dependency was changed.

## Audit findings

What the audit of the website, the customer dashboard and the admin console
found, most serious first.

1. **No request had a ceiling.** A `fetch` that never answered left a spinner (or
   a disabled button) on screen for ever, with no way out but a reload.
2. **No synchronous lock.** The only guard was `disabled` driven by React
   state, which lags the first click, and no handler had a lock of its own. Anything
   that reached a handler without going through the button (an Enter-key submit,
   a second event before the re-render, a programmatic submit) could run it twice,
   which for a payment, a booking or an SMS means a duplicate.
3. **A lost answer on a write was reported as a failure.** After a timeout or a
   dropped connection the request may well have been applied, yet the screen said
   "failed" and invited a second attempt. The same was true of a 2xx answer with
   an unreadable body ("not saved" for something that was saved).
4. **Busy buttons changed their words and nothing else.** "Save" became "Saving"
   with no spinner, no `aria-busy`, and in several files no status for a screen
   reader.
5. **Typed text was lost on failure** in `ReceptionistTestPanel`.
6. **Coming back from Stripe showed nothing about payment.** The success URL
   carried `?checkout=success` but the page looked identical until the webhook
   had landed, so a customer could pay a second time.
7. **Loading was invisible to assistive technology, and the calendar misled.**
   The route-level loading shells were skeletons marked `aria-hidden` with no
   status, so a screen reader heard nothing. The appointment calendar's "no
   appointments" message was not conditional on the first load having finished.
8. **A decorative "…" with `aria-hidden`** stood in for the receptionist demo's
   "replying" state, so assistive technology heard nothing.
9. **Support tickets and ticket replies have no server-side idempotency.**
   See [Open decisions](#open-decisions).

## What was built

### Primitives (`src/lib/client`, `src/components/ui`)

| Piece | What it does |
| --- | --- |
| `timedFetch` / `RequestTimeoutError` | `fetch` with a 30 s ceiling (per call override), aborting the request and naming the timeout |
| `createActionRunner` / `useAction` | Runs one async action: `pending`, a classified `failure`, a hard timeout that always settles, cancellation on unmount, no state update after unmount |
| `classifyFailure(error, { write, idempotent })` / `failureFromStatus` | Turns an error into `network`, `timeout`, `rate_limited`, `server`, `invalid_response`, etc., and decides `outcomeUnknown` and `retrySafe` |
| `createSingleFlight` / `useSingleFlight` | A **synchronous** lock: a second call while one is in flight is dropped before any render |
| `createGuardedHandler` / `useGuarded` | The same lock for event handlers; a dropped submit is still `preventDefault`ed so the browser never submits the form itself; a dropped call resolves `undefined` |
| `Spinner`, `BusyLabel`, `InlineStatus` | Inline spinner plus words ("Saving…"); `InlineStatus` is `role="status"` |
| `Skeleton`, `SkeletonRows`, `SkeletonCalendar`, `LoadingRegion` | Placeholders that keep the final size (no layout shift); `LoadingRegion` sets `aria-busy` and an `sr-only` status |
| `FeedbackMessage`, `useFailureText`, `FailureMessage` | One error component: tone, retry button, "retrying" state, translated text per failure kind |
| `feedback` i18n namespace | `loading`, `saving`, `working`, `sending`, `replying`, `retry`, `errors.*` in English and French |

### The unknown-outcome rule

After a timeout, a dropped connection, or a 2xx whose body cannot be read, on a
**write**, the screen says it could not confirm the result and that it may have
gone through. It never says "failed" or "saved". A retry button is offered only
when the operation is idempotent (booking with its `idempotencyKey`, checkout
with the server's pending claim, privacy settings with `expectedVersion`). For
everything else the message tells the person to check the list first, and the
list is re-read.

### Coverage

* 63 files under `src/components/app/` (one of them new) and 23 under
  `src/components/admin/` were moved to the primitives: sign-in, password
  reset and recovery, set password, account management, privacy and notification
  settings, business and receptionist settings, automations, the calendar and its
  integration, availability and service types, leads and pipeline, inbox and
  Gmail, notifications, support, referrals, every test panel, billing and
  checkout, and the admin console and legacy admin desks. The full list is in
  [Modified files](#modified-files).
* `src/app/[locale]/app/loading.tsx` and `src/app/[locale]/admin/loading.tsx` now
  render a skeleton shell with an `sr-only` status instead of a bare "Loading…".
* The public forms (`WebsiteRequestForm`, `BookAuditForm`, `ReferralForm`,
  `CallDemo`) use the same lock, timeout and wording.

### Coming back from Stripe

`/billing?checkout=success` used to look like any other visit. It now shows
**Confirming your payment…** with a spinner, hides the pay button, and re-reads
the page every 4 s for at most 15 checks (`CheckoutReturnWatcher`). It then stops
polling and says the confirmation has not arrived yet, not to pay again, and
offers "Try again". The state comes from the server's own record
(`getInstallationStatus`, written by the Stripe webhook), **not from the URL**:
`?checkout=success` alone confirms nothing. `?checkout=canceled` shows "Checkout
was canceled and nothing was charged" and brings the pay button back.

## Request protections

| Operation | Client protection | Server protection reused |
| --- | --- | --- |
| Sign in, password reset, account recovery | synchronous lock, 30 s ceiling, input kept | KAN-11 rate limiter |
| Privacy settings | lock; "saved" only after a confirming answer; an unreadable 2xx is "could not confirm" | `expectedVersion` |
| Booking | lock; confirming again after a lost answer reuses the same `idempotencyKey` and books once | booking idempotency key |
| Reschedule, cancel | lock; unknown-outcome wording; the calendar is re-read | none added |
| Stripe Checkout | lock; 50 clicks give one request; a lost answer is not called a failure | pending-checkout claim |
| SMS, notifications, test panels | lock; unknown-outcome wording | the central `/api` limiter |
| Admin actions | lock; progress and result shown once | none added (the existing audit log records them) |
| Support tickets and replies | lock; unknown-outcome wording; list re-read; an `idempotencyKey` per attempt (`useAttemptKey`) | the key names the row (`ON CONFLICT (id) DO NOTHING`), so a repeat returns the first ticket or reply |

## Tests

* `tests/loading-states.spec.ts`: LOAD-01 to LOAD-15 plus LOAD-08b (19 tests;
  LOAD-02 runs against three forms, LOAD-14 has a form test and a calendar test).
* `tests/unit/action-runner.test.ts`: the runner, the timeout race, failure
  classification (including the unreadable 2xx), unmount handling.
* `tests/unit/guarded-handler.test.ts`: the lock, the dropped-submit
  `preventDefault`, a dropped call resolving `undefined`.
* `tests/unit/feedback-audit.test.ts`: a source scan that fails the build when
  an async control is added without the pattern: a word swap with no spinner, a
  control disabled while busy in a file that shows no busy state, an
  `aria-hidden` "…" label, a public-site component reading a translation
  namespace the browser is not sent, a stale allow-list entry. The one busy-state allow-list entry is
  `SubscriptionsConsole.tsx`, with its reason recorded next to it.
* Existing specs updated for the new, more accurate wording:
  `privacy-settings`, `notification-preferences-loading`,
  `appointment-calendar` (`reveal()` now waits for the calendar to load instead
  of paging past a skeleton), `live-phone-testing` (unit).

## Verification record

Run from this worktree on the final source.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit -p .` | clean |
| `npx eslint --max-warnings=0 src tests/unit` | clean (exit 0, no output) |
| `node scripts/check-i18n-parity.js` | OK, 3140 keys |
| `npm run test:unit` | 3205 tests: 3201 pass, 3 skipped, **1 fails** |
| `tests/loading-states.spec.ts` | 19 of 19 pass |
| Full Playwright suite, `--workers=2`, production build, final source | 384 pass, 2 skipped, **3 fail**: `CAL-04` (fails on the unmodified commit too) and two `privacy-settings` tests that hit the harness's own rate limiter (below). All 19 `loading-states` tests pass. **The suite has not been fully green in any run.** |
| Mutation spot-checks (unit level) | 8 of 8 caught, each file restored byte-identical (hash-checked) |

The one unit failure is `call-activity.test.ts:676` ("shows the stored UTC time
in the business's own zone"). Its `America/Vancouver` assertion expects B.C.'s
permanent UTC-7 from November 2026 (`7:05`), which this machine's Node time-zone
data apparently does not know. It is unrelated to this work and was already
failing before it.

**Mutations** (each applied, the covering test run, the file restored):
removing the single-flight lock; removing `preventDefault` on a dropped submit;
removing the timeout race; `timedFetch` no longer naming its timeout; a lost
write answer no longer "unknown outcome"; an unreadable 2xx on a write called a
plain failure; a busy button reverting to a bare word swap; a public component
reading the `feedback` namespace (see below). All eight made a test fail.

**Failures seen while verifying, and what they were.** The first full run (default
workers) had 17 failures. Triage:

* Two were regressions this work introduced, fixed: `InboxActions` refreshed the
  page after a failed action (the spec requires no refresh), and
  `NotificationCenter` lost its "Loading…" status for the first read after a
  filter change.
* One was a test race, fixed in the test: `reveal()` in the calendar spec paged
  forward while the calendar still showed its (new) skeleton.
* LOAD-08b stepped the fake clock in one 70 s jump, which skips the re-renders
  the watcher schedules between checks; it now steps.
* `CAL-04` fails identically on a build of the unmodified commit (`ee470320`, in
  a separate worktree): it needs four free slots on one day and there are three.
  Not caused by this work, **not fixed**.
* The `plan-sync`, `privacy-settings` and `receptionist-workspace` failures were
  429s, `ERR_NETWORK_IO_SUSPENDED` and 60 s timeouts from running the whole suite
  at default parallelism; each passed when re-run at two workers.
* Three `receptionist-voice` tests also failed in that first run, waiting for the
  demo's next reply, and passed on re-run. I did not establish why. That spec is
  the one to watch: a later full run failed one of its tests for a **real
  defect of this work**, below.

**The 429s are the harness, not this work, shown rather than assumed.** Every
test provisions its workspace from the same loopback address, so they share one
default write bucket (60 at once, then 1 a second), and a faster run can empty
it. Which test loses changes run to run (`privacy-settings` failed 4 tests in the
first full run, 2 others in the last; `plan-sync` and `receptionist-workspace`
failed once). The evidence:

* `privacy-settings` alone, two repeats, 2 workers: 22 of 24 pass on this branch
  (a provisioning 429 and a sign-in callback that never landed).
* The same spec on a build of the **unmodified** commit: 24 of 24 at 2 workers
  (2.5 minutes), but **27 of 36** at 4 workers, with the same signatures: 429 on
  provisioning and on saves, and the callback stall.
* API traffic is not higher on this branch: over a 25 s window on five dashboard
  pages the branch made 17 requests and the unmodified commit 18, all reads, no
  polling added. No rate-limit file was changed.

What this does not show is that the branch is exactly as likely to trip it as
the baseline; one pair of samples cannot. It shows that the unmodified code fails
the same way, so it is not a regression of this work.

**A defect only the full suite found.** `CallDemo` (the receptionist demo on the
public site) read its new "Replying…" and "Sending…" words from the `feedback`
namespace. The public layout ships the browser only `PUBLIC_CLIENT_NAMESPACES`,
so on the public site the demo showed the raw key `feedback.replying` while it
waited, and its Send button the key for "Sending". The signed-in and admin trees
load the whole catalog, so none of the LOAD specs (which run there) could see it.
The words now travel in the demo's own `copy` prop (`receptionist.demo.sending`
and `.replying`, English and French), like the rest of that component's text. A
new audit test fails the build when a client component outside the signed-in and
admin trees reads a namespace the public layout does not ship, or imports
`FeedbackMessage`; it was shown to catch the original mistake (mutation 8). A
scan of every other public client component found no other case.

## What was not verified

* **Firefox, WebKit, a real phone and a screen reader.** Playwright ran in
  Chrome only; the phone tests use an emulated viewport. `aria-live` and
  `aria-busy` are asserted in the DOM, not heard.
* **PostgreSQL paths.** The e2e harness has no database, so the transition from
  "Confirming your payment…" to "Payment confirmed" (the webhook writing the
  checkout record) is not exercised end to end. Only the confirming, slow and
  canceled states are tested.
* **Stripe itself.** No Checkout session was opened against Stripe.
* **The burst-click e2e tests prove less than they look like.** React also
  disables the button after the first click, so a fifty-click burst can pass
  without the lock. The lock is proven by `guarded-handler.test.ts` and
  mutation 1, not by LOAD-02 alone.
* **Fifteen of the 23 changed admin files have no translations at all** (no
  `useTranslations`), so their wording is English only and the French language
  switch (LOAD-13) is not exercised on them. Five of those, `QaDesk`,
  `MonitoringDesk`, `PilotDesk`, `LaunchReadinessPanel` and `AdminSupportDesk`,
  got the 30 s ceiling and the lock, but their busy cue is still plain text
  ("Running…", "Checking…") with no spinner. They were not converted further.
* **No real-network timeout.** Timeouts are tested with held and aborted
  requests and a fake clock, not a slow link.
* **Latency was not measured**, and nothing here was run against production.

## Open decisions

1. **Support tickets and replies: resolved.** The forms send an `idempotencyKey`
   per attempt; the service derives the row id from it (scoped to the
   organization, or to the ticket for a reply), so a retry after a lost answer
   returns the first ticket instead of opening a second. No schema change.
2. **`SubscriptionsConsole`** disables its row buttons while a request runs but
   imports no spinner itself: those buttons only open the confirm panel, and the
   panel's own button (`ConfirmPanel` in `admin/console/ui.tsx`) shows the
   spinner and "Working…". It is on the audit's allow-list with that reason.
3. **The five English-only desks above** still show plain-text busy cues. Say if
   they should get spinners and French wording too; it is mechanical but touches
   five more files.
4. **CAL-04** fails on `ee470320` as well. Someone should decide whether to fix
   the test's slot assumption.
5. **The harness 429 flake.** Giving `workspaceSession`'s provisioning call its
   own `X-Forwarded-For` per session, as its sign-in step already has, would stop
   tests sharing one loopback bucket. It is a `tests/support` change outside this
   ticket and was not made.
6. **Whether to call KAN-26 complete.** All 19 LOAD tests pass, but the suite as
   a whole is not green (CAL-04, and the intermittent harness 429s above), and the
   items under "What was not verified" are not covered, so it has not been marked
   complete.

## Modified files

New: `src/lib/client/timed-fetch.ts`, `src/lib/client/use-action.ts`,
`src/components/ui/{Spinner,Skeleton,FeedbackMessage}.tsx`,
`src/components/app/CheckoutReturnWatcher.tsx`,
`tests/loading-states.spec.ts`, `tests/unit/{action-runner,guarded-handler,feedback-audit}.test.ts`.

Changed: `src/lib/client/use-single-flight.ts`, `src/messages/{en,fr}.json`,
`src/app/[locale]/{app,admin}/loading.tsx`, `src/app/[locale]/billing/page.tsx`,
`src/components/{BookAuditForm,CallDemo,ReferralForm,WebsiteRequestForm}.tsx`,
62 more components under `src/components/app/` and 23 under
`src/components/admin/` (including `admin/console/`), and the specs
`privacy-settings`, `notification-preferences-loading`, `appointment-calendar`
and the unit test `live-phone-testing`.

`git status` is the exact list; nothing here has been committed.
