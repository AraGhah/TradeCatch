# KAN-22 — Google Calendar integration and two-way synchronization

Status: **built and verified against a fake Google. Not verified against real Google. Not deployed.**
No live Google account or OAuth client was available, so every claim below about
Google's behaviour is modelled on its documented API and tested against
`tests/support/fake-google-calendar.ts`. The checklist in
[Before you switch it on](#before-you-switch-it-on) is the live acceptance that
remains.

## What an owner gets

On **Settings → Calendar** (Professional plan, business enrolled):

- **Connect Google Calendar** → Google's own consent screen → back to TradeCatch →
  choose which of their writable calendars to use (a dropdown, not a typed id).
- A status panel that is read from stored state, so it is identical after a
  refresh or a new login: status, Google account, calendar, **last successful
  sync** (shown in the business's time zone), whether instant updates are on,
  pending and failed changes, the last problem in plain words, and appointments
  whose Google event was moved or deleted by the owner.
- **Sync now**, **Change calendar**, **Reconnect**, **Disconnect** (two-step, says
  what is kept).
- Two settings: how much of the customer reaches Google (*service only* by
  default; or *name, phone and address*) and what a cancellation does (*remove the
  event* by default; or *keep it, marked canceled and free*).

## The rule that prevents conflicts

Written once at the top of `src/product/scheduling/gcal/types.ts`:

1. A TradeCatch appointment is **never changed, moved or canceled because of
   something that happened in Google.** A Google edit to an event TradeCatch wrote
   is recorded on its link and shown to the owner; the appointment stays as it was.
2. Every other event in the chosen calendar is **only read**: it blocks times in
   TradeCatch, nothing else.
3. TradeCatch writes to Google **only because an appointment changed in
   TradeCatch.** A change that came *from* Google never causes a write back, so the
   two systems cannot ping-pong.

Consequences: no loop is possible by construction; a double booking is prevented
before confirmation (the booking path reads the calendar first and refuses a time
Google says is busy); and an owner dragging an event in Google never silently
moves a customer's appointment.

## How it works

```
 dashboard / receptionist ──► SchedulingService.book / reschedule / cancel
                                     │  CalendarPort (one interface, three adapters)
                                     ▼
                           gcal/port.ts  (Google adapter)
        freeBusy ◄── reads the stored mirror          createEvent/updateEvent/deleteEvent
        prepare()  = a short pull, then "is the mirror fresh?"    │ enqueue + send inline (3 s)
                                     │                             ▼
                           gcal/sync.ts  (engine) ── push: claim → send → save ── retries/backoff
                                     │            └─ pull: events.list(syncToken) → mirror → busy blocks
                                     ▼
                           gcal/client.ts  (Google REST, never throws on Google answers)
```

- **Mirror.** Google events are read as *times only* (the request names the
  fields; titles, notes, attendees and locations are not requested) into
  `tc_gcal_events`, then reduced to busy blocks. Free/transparent, declined,
  cancelled and informational events (working location, out of office…) do not
  block. All-day events are interpreted as the **business's** days (a 25-hour
  fall-back day is 25 hours).
- **Mapping.** `tc_gcal_event_links`: one row per appointment, a deterministic
  Google event id (`tc…`, derived from the appointment), unique per calendar, plus
  a private marker `tcAppointmentId` on the event. Creating twice, or after a lost
  answer, hits Google's `409` and adopts the existing event instead of duplicating.
- **Incremental sync.** `events.list` with a `syncToken`; a `410` starts over with
  a full read; a full read also detects deletions inside the window. A full read
  runs at least daily, and rolls the window forward.
- **Push + safety net.** `events.watch` channels (7-day TTL, renewed when under a
  day is left). Each business has its own channel id and secret token, stored only
  as a hash; the webhook identifies the business by those alone. Repeated or older
  message numbers are acknowledged and ignored. Without push (not https, or Google
  refusing), the cron pass reads every 3 minutes instead of every 15.
- **Cron.** `/api/calendar/google/tick` runs every minute (`src/lib/cloudflare-scheduler.ts`,
  also called from the existing reconcile route as a fallback). It pulls, renews
  channels and sends due changes.
- **Never block on Google.** Booking waits at most 3 seconds for Google; past that
  the appointment is confirmed and the event is delivered by the retry queue.
- **Never trust an unknown calendar.** If the mirror has not been read in the last
  30 minutes (or never), a booking is saved as a *request* instead of being
  confirmed against a calendar nobody has seen.

### Concurrency

- Booking uses the existing `insertIfFree` (`pg_advisory_xact_lock` per business):
  two simultaneous bookings for one time → exactly one wins.
- Sending uses **row claims**: `FOR UPDATE SKIP LOCKED` plus a lease
  (`next_attempt_at` pushed forward), so two Workers never send the same change.
  Results are saved against a fresh read: a change made while a send was in
  flight stays queued rather than being overwritten by that send's success.
- Pulls take a per-business lease with a `rerun` flag, so a notification that
  arrives mid-pull is not lost.

### Reliability

| Situation | Behaviour |
|---|---|
| Google 5xx / timeout | transient: retry with exponential backoff 30 s → 1 h cap, ±20 % jitter |
| 429 / rate-limit 403 | same, and never sooner than Google's `Retry-After` |
| Access token expired | refreshed once, request retried; owner never notices |
| Grant revoked (`invalid_grant`) | status → *Expired*, one in-app notice, no attempts burned; changes wait, then go out after reconnecting |
| Outage during refresh | recognised as an outage, **not** as a revoked grant |
| 10 failed attempts | change marked *failed*, shown on the dashboard, never retried silently; **Sync now** gives it a fresh set |
| Owner presses Sync now | waiting changes go now (one attempt per press), a `410`/stale token is handled |
| Plan downgraded / unenrolled | all Google calls stop at once; nothing is deleted |
| Disconnect | revoke at Google, stop the channel, delete tokens and mirror; **appointments untouched**; events already in Google stay; links become `detached` and re-attach (no duplicates) if reconnected |

A failure in sync is caught at every boundary: it cannot crash the receptionist
or the dashboard.

## Security

- **Least privilege.** Two scopes: `calendar.events` (read/write events) and
  `calendar.calendarlist.readonly` (to offer the calendar picker). A grant missing
  `calendar.events`, or lacking a refresh token, is rejected and revoked at Google.
  Only calendars the account can write to are offered.
- **Tokens** are sealed with AES-256-GCM keyed from `AUTH_SECRET`, never returned by
  any API, never in a page (the e2e test searches the HTML for them), and removed
  on disconnect. The channel secret is stored only as a SHA-256 hash, compared in
  constant time. The old clear-text `channel_token` column is blanked by the migration.
- **OAuth state** is HMAC-signed and bound to one user and one business; opened in
  another person's session it attaches nothing.
- **Tenant isolation.** Every route re-checks the caller's membership for the business
  in the URL; the webhook identifies a business only by channel id + secret token.
- **Privacy of the owner's events.** Not requested, not stored (a test scans every
  table). Customer details reach Google only if the owner opts in.
- **Plan.** Enforced in the backend: the access gate refuses plans without
  appointment booking (403), then the enrollment gate; the UI is not trusted.
- Google never emails anyone because of TradeCatch (`sendUpdates=none`, no guests).

## Before you switch it on

These are the steps that need a person with Google Cloud and Cloudflare access.

1. **Database.** Apply the scheduling schema (`npm run db:schema`). Migration
   `062_scheduling_google_sync` is *additive and idempotent*: new columns on
   `tc_calendar_connections` / `tc_calendar_sync_state`, new tables
   `tc_gcal_events` and `tc_gcal_event_links`. It was executed on PGlite and on a
   real PostgreSQL 16 server in tests, **not on production**. Take a backup first
   (`npm run db:backup`).
2. **Google Cloud.** Enable the Google Calendar API; create an OAuth client (Web);
   authorized redirect URI `https://<domain>/api/calendar/oauth/callback`;
   consent screen with the two scopes above. `calendar.events` is a *sensitive*
   scope: unverified apps are limited to 100 test users and show a warning; plan for
   Google's OAuth verification before opening it to all customers.
3. **Environment** (see `.env.example`): `GOOGLE_CALENDAR_CLIENT_ID`,
   `GOOGLE_CALENDAR_CLIENT_SECRET`, optionally `GOOGLE_CALENDAR_REDIRECT_URI` and
   `GOOGLE_CALENDAR_WEBHOOK_URL`. `AUTH_SECRET` already seals tokens.
   `GOOGLE_CALENDAR_WEBHOOK_TOKEN` is **gone** (replaced by per-business secrets);
   remove it from the Worker.
4. **Cron.** The `* * * * *` trigger now also calls `/api/calendar/google/tick`.
   Confirm the Worker has the ops secret the other ticks use.
5. **Enrollment.** `GOOGLE_CALENDAR_PILOT_ORG_IDS` is unchanged and still
   fail-closed (`*` is not a wildcard; a test asserts it). Putting a business's id
   there is what "switches it on". Making this generally available to every
   Professional customer is a **release decision for you**; it would mean changing
   `googleCalendarPilotAllowed` and its test, which I deliberately did not do.
6. **Live acceptance** (needs a real test Google account): connect; pick a calendar;
   book from the dashboard and by phone; reschedule; cancel; add/move/delete an event in
   Google and watch the dashboard; revoke access from Google's account page and
   reconnect; confirm instant updates arrive (watch for `POST /api/webhooks/google-calendar`).

## Known limits and decisions

- **Not run against real Google.** The fake is faithful to the documented behaviour
  (sync tokens, 409, 410, `showDeleted`, `Retry-After`, `fields` projection, grants),
  but a documented behaviour is not a tested one.
- **Changing the selected calendar** leaves events already created in the old
  calendar; new and changed appointments go to the new one. (Said in the UI.)
- **A small enqueue-vs-send race** can leave a change queued one extra cycle; it
  self-heals on the next pass and never loses or duplicates a change.
- **Receptionist booking** still treats a Google outage as "confirm if the mirror is
  fresh, else take a request". It does not offer times it cannot confirm.
- **Outlook** is not built (the task marked it optional/later); the `CalendarPort`
  seam is where it would go.
- **Notifications.** A revoked grant emits the existing `calendar_disconnected`
  business event. A separate notification for *failed* changes was not added: they
  are shown on the dashboard.
- Time zones: appointments are stored in UTC and sent to Google with the business's
  IANA zone. Tests cover the fall-back and spring-forward days and a zone ahead of UTC.

## Acceptance matrix

Shared scenarios live in `tests/unit/gcal-scenarios.ts` and run **twice**: against
the in-memory store (`gcal-sync.test.ts`) and against the real SQL in `schema.sql`
(`gcal-sync-postgres.test.ts`, PGlite by default, a real PostgreSQL server when
`TEST_DATABASE_URL` points at a local one). Browser/HTTP tests: `tests/gcal.spec.ts`.

| ID | Criterion | Where |
|---|---|---|
| SYNC-01 | Connect OAuth success | `gcal.spec.ts` (consent → callback → chooser → connected; scopes asserted) |
| SYNC-02 | OAuth denied | `gcal.spec.ts` (denied, and a grant missing the event scope) |
| SYNC-03 | Import busy periods | scenarios SYNC-03 (busy/free/declined/all-day; nothing private stored; paging; 410) |
| SYNC-04 | Appointment → Google event | scenarios SYNC-04 · `gcal.spec.ts` |
| SYNC-05 | Reschedule updates the event | scenarios SYNC-05 · `gcal.spec.ts` |
| SYNC-06 | Cancel removes/marks the event | scenarios SYNC-06 · `gcal.spec.ts` |
| SYNC-07 | External edit | scenarios SYNC-07 · `gcal.spec.ts` |
| SYNC-08 | External delete | scenarios SYNC-08 (incl. learning it from Google's own `410`) · `gcal.spec.ts` |
| SYNC-09 | Duplicate webhook/event | scenarios SYNC-09 · `webhook-hardening.test.ts` · `gcal.spec.ts` |
| SYNC-10 | Concurrent bookings | scenarios SYNC-10 (also on a real server with 10 connections) |
| SYNC-11 | Expired token refresh / reconnect | scenarios SYNC-11 |
| SYNC-12 | Google down: retry + error recorded | scenarios SYNC-12 · `gcal.spec.ts` (shown on the dashboard) |
| SYNC-13 | Another business denied | scenarios SYNC-13 · `gcal.spec.ts` (APIs and a reused OAuth link) |
| SYNC-14 | Disconnect stops sync, keeps appointments | scenarios SYNC-14 · `gcal.spec.ts` |
| SYNC-15 | Time zone and DST | scenarios SYNC-15 · `gcal.spec.ts` |
| SYNC-16 | Essential plan denied | scenarios SYNC-16 · `gcal.spec.ts` (backend 403, no Google contact) |
| SYNC-17 | Status persists after refresh/relogin | scenarios SYNC-17/17b · `gcal.spec.ts` (reload + a new session) |
| SYNC-18 | Two-way, no loops, no duplicates | scenarios SYNC-18 (settles to zero writes) |

Extra checks: storage contains no readable token, channel secret or private event
text; two workers pushing at once send each change once (fails with 10 sends
instead of 5 if leases are removed — verified by breaking it on purpose).

## Verification results (2026-11-19)

All against the fake Google. Nothing here touched real Google or production.

| Check | Result |
|---|---|
| Sync scenarios, in-memory store + real SQL on PGlite (`gcal-sync*.test.ts`) | 100 / 100 |
| The same scenarios plus two PG-only tests on a real PostgreSQL 16 server (Docker, throwaway, removed afterwards) | 48 / 48 — run **before** the last small edits (Sync-now retry, status of a half-finished or disconnected connection); PGlite covers those edits, a real-server rerun is still open |
| Full unit suite (`npm run test:unit`) | 3267 pass, 3 skipped, **1 fail**: `call-activity.test.ts` "shows the stored UTC time…" expects the 2026 B.C. permanent-time rule, which this Node's bundled tz data (2025b) predates. Unrelated to calendar work and failing before it |
| Browser: `gcal.spec.ts` (11) with `calendar-release`, `help-center`, `plan-sync`, `appointment-calendar`, `schedule-picker`, `a11y-smoke`, `route-matrix` | 152 pass, 0 fail, 2 skipped (opt-in help-screenshot capture) |
| `tsc --noEmit`, `eslint --max-warnings=0` | clean |
| Planted bugs the tests must catch (own-event blocking, token compare, `gone` handling, claim lease) | each was caught |

The browser run found a defect the unit scenarios had missed: an owner who pressed
Disconnect was shown "Simulated" instead of "Disconnected" (the stored state was
right; the status the dashboard was given was not). It is fixed and now pinned by
the SYNC-14 unit scenario. A related one, a half-finished OAuth connection that
vanished on refresh, was found earlier and is pinned by SYNC-17b.

The help guide's calendar screenshot (`UPDATE_HELP_SCREENSHOTS=1`) was **not**
regenerated; it shows the "switched on by our team" notice, which still exists,
but the reviewed image should be re-captured before release.

## Files

New: `src/product/scheduling/gcal/{types,events,client,open,sync,port}.ts`,
`src/app/api/businesses/[id]/calendar/sync/route.ts`,
`src/app/api/calendar/google/tick/route.ts`,
`tests/support/fake-google-calendar.ts`, `tests/unit/gcal-*.ts`,
`tests/unit/support/gcal-*.ts`, `tests/gcal.spec.ts`, this document.

Changed: `schema.sql` (migration 062), `store.ts`, `postgres-store.ts`, `google.ts`
(legacy adapter removed), `service.ts`, `runtime.ts`, `availability.ts` (harness-only
enrollment), `types.ts`, the calendar OAuth callback, calendars, status and
disconnect routes, the Google webhook, `cloudflare-scheduler.ts`, the reconcile
route, the reliability probe, `reset-demo-data.ts`, `CalendarIntegrationPanel.tsx`,
`en.json`/`fr.json`, `playwright.config.ts`, `.env.example`, and the tests that
described the old behaviour (`calendar-release`, `scheduling-atomic`,
`webhook-hardening`, `cloudflare-scheduler`).
