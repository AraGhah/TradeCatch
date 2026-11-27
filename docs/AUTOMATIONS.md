# Automations: how they work, and what KAN-17 fixed

Applies to the Automations screens (`/app/automations/*`), the SMS automation module
(`src/product/sms-automation`), its API (`/api/businesses/{id}/automation*`), and the cron
tick (`/api/automations/tick`).

The words on these screens (English and French), the Active / Paused / Scheduled / Needs Attention
status and how it is decided are described in [KAN-24-AUTOMATIONS-COPY.md](KAN-24-AUTOMATIONS-COPY.md).

## Root causes

| # | Symptom | Cause | Fix |
| --- | --- | --- | --- |
| R1 | A switch or a setting "came back off" after a reload or a second tab | Every page load ran an **upsert** that wrote the default row over the stored one; two first requests at once could reset an enabled automation or a customized template | Seeding is now one **insert-only** statement (`ON CONFLICT DO NOTHING`). It never touches an existing row |
| R2 | A save could silently undo a toggle (and the reverse) | Both read the whole row, changed their part, and wrote the whole row back (lost update) | The switch and the settings are separate writes. The toggle is a single statement that **sets** a value; the save locks the row (`SELECT … FOR UPDATE`) and writes only the settings |
| R3 | Buttons did nothing, or clicking fast sent several requests, or the screen showed "Saved" for a save that failed | The busy flag was React state, so it only took effect after a re-render and a second click in the same tick got through; no `finally`, so one failure left the button stuck; success was shown before the answer; nothing re-read the server after a failure; the template editor kept the page's first-load text | A synchronous per-control lock (`useKeyedSingleFlight`), `requestJson` (timeouts, rate-limit cool-down, typed errors), values always taken from the server's answer, a re-read of the stored state after any failure, "Not saved" markers, and pending labels ("Turning on…") |
| R4 | Enabling twice, or disabling then enabling, behaved differently each time; reminders canceled by a disable never came back; an old quote got every missed reminder in one burst | `activate` was a toggle-like write that always re-scheduled; jobs canceled with `automation_disabled` could not be revived; every overdue step was scheduled at "now" | Activate/deactivate **set** the state and are safe to repeat. A job canceled only because the switch was off is revived by the next enable. Of the steps already overdue only the latest is kept, and none if it is more than 14 days late |
| R5 | A provider 5xx was retried and could text the customer twice | The retry decision treated any thrown error as retryable, including timeouts that can happen after the provider accepted the text | Errors are classified by the SMS port: only an explicit `retry` (or a rate limit, after its reset time) is retried, with growing waits (1, 5, 15 min plus jitter) and a limit of 3 attempts. Anything unclassified (a timeout, a dropped connection) is **`uncertain`**: never resent, shown to the owner |
| R6 | A crash after the provider call could send the text again; a disable racing a send could still send | The job was only marked "sent" after the provider answered, and the worker did not re-check the job at the last moment | A write-ahead marker (`payload.sendStartedAt`) is stored, by compare-and-set against the claim, **before** the provider call. A job with the marker and no sid can only become `uncertain`, never `pending`. If the job was disabled or taken over meanwhile, the compare-and-set fails and nothing is sent. The result of the send is saved with retries; bookkeeping after it (log, CRM) can fail without turning a sent text into a failure |
| R7 | Quote reminders could go out for a quote that was stopped or deleted, or depended on the owner's "stop on accept" tick | Eligibility looked only at won/lost, and only when the owner left the checkboxes on | Accepted, rejected, stopped or missing quotes **always** stop reminders. The two checkboxes were removed from the form (a static note replaces them) |
| R8 | Smaller: the category (which consent a text needs) was editable through the API; the list order changed between loads; a database error looked like "no sender number" and failed a job for good; a delivery callback that arrived before its job was recorded was thrown away; "scheduled" was reported for a call that was already scheduled; the scheduler did not flag `uncertain` sends | | Category is locked to the automation's type; fixed order; a database error in `smsFrom` is thrown and retried; the callback is matched to a job **before** it is marked processed; the duplicate is reported as `duplicate`; the scheduler and the tick report `failed`, `uncertain` and `retry` outcomes as failed work |

## How a text is decided

1. **Trigger**: a missed call (`scheduleMissedCall`) or a sent quote (`scheduleQuoteFollowUps`) creates a job
   with an idempotency key: `mcr:{callId}` or `qf:{thread}:{step}`. A second report of the same call, or a second scheduling of the same quote, finds the key and adds nothing, even when
   two workers race (the database has a unique key).
2. **A worker claims the job** (`FOR UPDATE SKIP LOCKED`; one worker per job). A claim not finished after 10 minutes is
   released, unless a send had begun: then it becomes `uncertain`.
3. **Checks, in order, at send time** (not only at scheduling): business active; automation still enabled; valid number;
   not opted out (this automation's list **and** the call workflow's list); not already submitted; attempts within
   the limit; recorded consent for the message category; quote still open; lead not closed and no human contact;
   the sending window (see below); template complete.
4. **Send**: write-ahead marker, provider call, result saved.
5. **Every outcome is logged** in the execution log (status, result, error class, time) and counted on the
   automation (`successCount`, `failureCount`, `lastExecutionStatus`). A failure is never counted as a success.

Job statuses: `pending`, `processing`, `submitted`, `sent`, `delivered`, `failed`, `undelivered`, `canceled`, `skipped`, `uncertain`.
`uncertain` means the text may have been sent. It is never retried, never overwritten by a disable, and shows in the history and in the cron result.

### Missed-call recovery

- Qualifies: an unanswered call (`missed`, `after_hours_missed`) from a valid number. Answered and abandoned calls, other event types,
  anonymous callers and numbers that opted out do not.
- One text per call. A second call from the same number within 24 hours is not texted again while duplicate protection is on.
- **Quiet hours are an opt-in** (`respectQuietHours`, default off). Off: the caller gets the text right away, at any hour, because it answers their own call.
  On: a call missed outside the sending window gets **no** text (never one delayed to the morning).
  A text still unsent after the maximum age (`MISSED_CALL_RECOVERY_MAX_AGE_MINUTES`) is dropped as `stale`.
  `MISSED_CALL_RECOVERY_SMS=off` is the operator kill switch and cancels queued texts.

### Quote follow-up reminders

- Steps are scheduled from the quote's sent time with the configured delays (default 1 and 5 days, at most 2).
- A reminder that comes due outside the sending window waits for the next one, in the **business's timezone** (weekends skipped unless enabled).
- Stops for: accepted, rejected, canceled/stopped, deleted, customer reply (when "stop on reply" is on), a person taking over (when on), opt-out.
- Turning the automation off cancels what has not been sent. Turning it on again revives those jobs (not ones canceled for another reason) and schedules open quotes that have none.

### Appointment reminders

Same engine: a confirmation and a reminder 24 hours before the appointment, with idempotency keys per appointment and start time. The reminder has no settings page yet
(the board shows its switch only).

## Execution log

`GET /api/businesses/{id}/automation-history?executions=1` returns `history` (messages) and `executions`
(one row per attempt, skip, retry and failure: status, result, error class, time, simulated or not). No phone numbers or provider
text are stored in the error field. The cron result (`/api/automations/tick`) reports each job's status; `failed`, `uncertain` and
`retry` make the scheduler record the run as failed work.

## Settings changes apply to new events

Saving settings changes how **new** calls and quotes are scheduled. Jobs already queued keep their time. The worker re-checks the switch, the
opt-out lists, consent, the quote and the quiet-hours choice at send time, so turning something off, or an opt-out, takes effect on queued texts at once.

## Request protection

PATCH settings, activate, deactivate, template save and job cancel share the `sensitive.automation-settings` policy
(30 changes, then 1 per 10 s, per business and user; see `docs/RATE_LIMITS.md`). The screens obey `Retry-After` and say how long to wait.
Errors from these routes are JSON (`{ error, fields? }`); anything unexpected is logged with a request id and shown as a plain sentence.

## Decisions to confirm

1. **Quiet hours** are opt-in and skip rather than delay. The previous behavior (text right away) is the default.
2. **Quote reminders always stop** on accepted, rejected, stopped or missing quotes. The two owner checkboxes were removed.
3. **Message category is locked** to the automation's type.
4. **Legacy fallback when the automation is OFF is unchanged.** With missed-call recovery off, the call workflow still sends its own opening text; with
   quote follow-up off, the starter quote flow still runs its own reminder. The automation owns the text only when it is on. If "off" should mean "no automated text at all", that is a separate product decision.
   When the automation is on but scheduling throws (database down), the call workflow falls back to its opening text; in the narrow case where another worker has already
   scheduled the same call, that could produce two texts. This is existing cross-module behavior and was not changed.

## Verification record (2026-11-18)

| Check | Result |
| --- | --- |
| `tsc --noEmit`, `npm run lint` (`--max-warnings=0`), `npm run format:check`, `npm run check:i18n` | clean (3,062 i18n keys in parity) |
| `npm run test:unit` | 2,782 tests: 2,778 pass, 3 skipped, 1 fail. The failure (`call-activity` "shows the stored UTC time…") fails identically on untouched `main`: a timezone-data issue in this Node, unrelated |
| New unit tests | `sms-automation-reliability` (62, memory store), `sms-automation-postgres` (16, real SQL on PGlite), `sms-automation-http` (3), 5 added to `cloudflare-scheduler`; the 18 existing automation tests pass (the retry test now throws a classified `SmsDeliveryError`) |
| Playwright `tests/automations.spec.ts` | 15 of 15 pass (production build, webpack, harness env with no provider keys, system Chrome) |
| Mutation check | with the click lock removed, the 50-click tests fail (50 requests instead of 1) for both the switch and Save; the lock was restored |

Scenario map: AUTO-01/02/03 (unit + e2e), AUTO-04 (e2e, both a same-instant burst and 50 forced clicks), AUTO-05/06 (unit, memory and Postgres), AUTO-07 (unit),
AUTO-08 (unit, with exact times in the business timezone), AUTO-09 (unit), AUTO-10 (unit for the service, e2e for the screen: 503, network down, 500, 401, 403, 429,
an OK answer without the stored value, and a lost answer), AUTO-11 (unit and Postgres claim, see limits), AUTO-12 (unit for the service, e2e for the HTTP routes between two businesses),
AUTO-13 (e2e), AUTO-14 (unit, memory and Postgres).

### What was not run

- **Real Twilio, the Cloudflare Worker cron, the production database.** The Postgres store ran on PGlite (the shipped `schema.sql`), not on Supabase.
- **True multi-connection concurrency.** PGlite has one connection, so `FOR UPDATE SKIP LOCKED` under real contention and two truly parallel transactions were not exercised. The in-memory store and the single-connection SQL tests prove the logic (one claimant, the compare-and-set, the unique keys), not the lock behavior of a live server.
- The rest of the existing Playwright suite: only `tests/automations.spec.ts` was run. `tests/help-center.spec.ts`, which links to the Automations pages, was not.
- French copy was checked for key parity, not read by a native speaker.

## Not deployed

No migration is needed: settings are in the existing JSONB column and the marker is in the job payload. The code is not committed and not deployed.
The new `sensitive.automation-settings` limit is a named policy, so it is enforced from the first request (`RATE_LIMIT_MODE` only switches the default limit, see `docs/RATE_LIMITS.md`).
After a deploy, watch the cron result for `uncertain` and `retry` outcomes.
