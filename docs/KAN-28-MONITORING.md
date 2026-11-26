# KAN-28: monitoring, error detection and automatic admin alerts

Status: built and verified locally, **uncommitted, not deployed, not marked
complete**. Read [What was not verified](#what-was-not-verified) and
[Owner steps](#owner-steps-before-this-is-live) first: several acceptance
criteria can only be proven against the real Cloudflare Worker and the
production database, and that has not been done.

TradeCatch now detects failures across the website, API, voice receptionist,
SMS and automations, calendar, Stripe and the database, groups them into
incidents, emails administrators with a priority, and shows all of it, live, on
the admin **System health** page.

## What was reused, and what was missing

Reused, not replaced: the reliability service and its stores
(`src/product/reliability/`), `tc_system_errors` / `tc_system_incidents`, the
per-job health checks, the Cloudflare cron that already runs every minute, the
Resend notifier, the admin console and its role checks.

Missing, now added: request-level measurement (error rate, latency, 401/403/429
counts), a website availability probe, signals from the call, SMS, automation,
calendar and Stripe tables, one incident per distinct problem (instead of one per
error), an email outbox with bounded retries, recovery notices, storm control,
and a dashboard that reads real data for each area.

## How it works

```
 every request ──► Worker observer ──► /api/monitoring/ingest ──► minute buckets (counts only)
                       (after the response is sent; never in the request path)

 every minute ─► /api/monitoring/watch ──► probe site + database
 (cron)                                 ├─► read signals from existing tables (counts only)
                                        ├─► evaluate rules against thresholds
                                        └─► incident engine ──► alert outbox ──► email (retried, bounded)

 a failure in app code ──► recordFailure (1.5 s cap, circuit breaker) ──► incident engine

 admin ──► System health ◄── incidents, areas, alert deliveries, monitor freshness
```

* **Request measurement.** `worker.ts` counts each response (status class and a
  latency histogram, per minute) in memory and flushes it after the response via
  `ctx.waitUntil`, through an authenticated internal call. Counts only: no URLs,
  headers, bodies or customer data. The latency measured is time to response
  headers, not to the last byte.
* **The monitor** (`watch.ts`) runs in the existing every-minute cron. It starts
  alongside the other jobs, not after them (`MONITOR_ROUTES`), so a database
  that makes every job wait cannot delay or starve it (2026-11-24, see
  [DATABASE_AUTHENTICATION_RECOVERY.md](DATABASE_AUTHENTICATION_RECOVERY.md)).
  Each stage is isolated: one failing stage never stops the others and the run
  itself never throws.
* **Database unavailable.** If the database can still store a row, the outage
  becomes a normal critical incident (`health:database`). If it cannot, the
  monitor emails administrators directly (one email per 15-minute window,
  idempotency key in the provider call, no database needed) and the route answers
  503 so the scheduler records the failure. That email names the failure code
  (SQLSTATE such as `28P01`, a network code, `CONNECT_TIMEOUT`, `QUERY_TIMEOUT`,
  or `NOT_CONFIGURED` when `DATABASE_URL` is missing although durable storage is
  on) and its likely cause, never the driver message. When the database
  returns, the outage is recorded after the fact as a resolved critical incident
  with a recovery notice, dated from the last successful run and naming the
  `dbdown-…` references it closes.
* **A gap in the monitor itself** (no run for 4 minutes while the database is
  healthy) is also recorded as a past outage.
* **Customer operations are never affected.** Recording is outside the request
  path or capped at 1.5 seconds with a circuit breaker (30 s, 2 min, 10 min); every
  stage swallows its own errors; logs carry short codes only.

## What is detected, and when

Defaults live in `src/product/reliability/thresholds.ts`. All are tunable (see
[Changing thresholds](#changing-thresholds)).

| Area | Condition | Priority | Default threshold |
| --- | --- | --- | --- |
| Website | Page or `/api/health` unreachable (5xx, timeout, network) | Critical | 3 consecutive failed probes (a probe runs each minute) |
| API | Server-error rate | Critical | at least 20 requests in 5 min and 50% 5xx |
| API | Server-error rate, lower | High | at least 20 requests in 10 min and 10% 5xx |
| API | Sign-in or permission failures (401/403) | Warning | at least 40 in 10 min and 40% of traffic |
| API | Rate limiting (429) | Warning | at least 100 in 10 min and 10% of traffic |
| API | Slow responses | Warning | p95 over 4 s, at least 30 requests in 10 min |
| Database | Unavailable | Critical | 3 probe attempts of 2.5 s each; also a failed write probe |
| Database | Slow | Warning | 5 consecutive probes over 1.5 s |
| Receptionist | Genuine call failures (routing or agent errors) | High | at least 3 failed sessions in 15 min and 30% of calls |
| Receptionist | Calls that never reached a final status | High | at least 3 older than 20 min |
| SMS | Delivery failures | Warning, then High | 5 and 25%, then 15 and 50%, in 15 min |
| Automations | Stuck or retry-exhausted jobs | High | 5 stuck over 20 min, or 3 exhausted in 60 min |
| Calendar | Revoked or expired credentials | High | any, with the number of businesses affected |
| Calendar | Failed syncs | Warning | at least 5 in 30 min |
| Stripe | Webhook processing failures | High | at least 2 in 30 min |
| Stripe | Subscription records out of step with billing | High | any |
| Stripe | Rejected webhook signatures | Warning | at least 20 in 30 min (see limitations) |
| Scheduled jobs | A cron job missing or failing | per job | existing freshness rules |
| Any service | Same error repeating | High / Warning | 3 in 10 min (high), 5 in 15 min (medium); a critical error opens at once |

What deliberately does **not** alert: one isolated 403 or 429; callers who hang
up (that is normal); a single failed probe; anything counted only in a simulation.

## Alerts

* **Priorities.** Critical, High, Warning. The subject is
  `[TradeCatch CRITICAL] …`; a recovery uses `RESOLVED`.
* **Content.** Service, time, severity, category, status, the business id when
  one business is affected (otherwise "Platform-wide" or a count), first and last
  seen, number of occurrences, a short counts-only summary, a diagnostic
  reference (the incident id) and a request reference, plus a link that opens the
  incident on the System health page.
* **Never included:** passwords, API keys, tokens, payment data, call transcripts
  or customer names, emails and phone numbers. Every string is scrubbed, and the
  finished payload is checked again and refused outright if anything sensitive
  survived. The same scrubbing is applied to error details before they are stored.
* **Recipients.** `ADMIN_ALERT_EMAIL`, else `RESEND_NOTIFY_EMAIL`, else the
  addresses on `TRADECATCH_ADMIN_EMAILS` (at most 5, one email each).
* **One incident per distinct problem.** Repeated identical failures raise a
  count, not new emails. A problem that returns within 15 minutes of resolving
  reopens the same incident without a new alert.
* **Cooldowns:** Critical 15 min, High 30 min, Warning 60 min between alerts for
  the same incident. A higher priority alerts immediately (escalation). A
  Critical incident that stays open is reminded every 6 hours.
* **Storm control.** At most 6 alert emails per 10 minutes. Beyond that, further
  incidents are still recorded and one summary email says how many were held back.
* **Recovery.** When the condition stays clear for the quiet period, the incident
  resolves itself and a recovery notice goes out (Critical and High).
* **Delivery is tracked.** Every email is a row in `tc_alert_deliveries` with up
  to 5 attempts (1, 5, 15 and 60 minutes apart), 8 seconds per send. A failure
  stores a short code (`send_failed`, `timeout`, `not_configured`), never the
  provider's message. Rows that give up are listed on the dashboard.
* **Simulations** (the "Test monitoring" scenarios) create real records marked
  simulated, are never emailed, and never change area status.

## The System health page

`/admin/system-health` (English and French), refreshed every minute:

* **Monitor freshness.** When the monitor last ran. If it never ran, or is more
  than 4 minutes late, the page says so and shows every area as *not measured*.
* **Areas.** Website, API, voice receptionist, SMS, Stripe billing, database,
  calendar, automations: *Healthy*, *Degraded*, *Incident* or *Not measured*.
  An area is *Healthy* only if the monitor measured it recently and nothing is
  active. If a signal could not be read, or has no source (no database, no public
  address, no traffic yet), it is *Not measured* and says why. It is never shown
  as healthy by default.
* **Traffic.** Requests, server errors and rate, sign-in/permission failures,
  rate-limited requests, p95 and median latency, from the recorded buckets. With no
  recorded traffic the tiles show "—", not zero.
* **Alert emails.** Waiting, gave up, sent in 24 hours, and the failed deliveries
  with their short reason.
* **Incidents.** Priority (Critical / High / Warning), state (**Active**,
  **Acknowledged**, **Resolved**), occurrence count, last seen, business. Open one
  for its facts, its history (opened, escalated, acknowledged, resolved, each alert
  email), the alert emails sent for it and the errors behind it. The alert email's
  link opens the incident directly.
* **Acknowledge / Mark resolved.** Recorded against the administrator's email.
  Acknowledging twice is harmless. Resolving asks first; an incident whose
  condition is still present reopens by itself.

Access: reading needs `admin.read`; acknowledging and resolving need
`admin.manage` (super administrator only), are blocked cross-site when carried on
a sign-in cookie, and are rate-limited per administrator. Support and read-only
administrators can read incidents but not change them, and the page says so.

## Data, retention and cost

Migration `063_monitoring_alerts` (`src/product/reliability/monitoring.sql`,
applied by `npm run db:schema`) adds incident columns, the alert outbox, minute
buckets, website/database probe results and a few indexes. All additive and
idempotent. Request counters are one row per minute per scope (about 2,900 rows
in 48 hours). Retention, pruned about hourly: errors 30 days, resolved incidents
180 days, probes and buckets 72 hours, alert deliveries 90 days. Unresolved
incidents and pending alerts are never pruned.

The signal collectors read existing tables with indexed time windows and return
counts only. If one table or column is missing, only that signal is marked not
measured.

## Changing thresholds

Set `MONITOR_THRESHOLDS_JSON` to a partial object with the same shape as
`DEFAULT_THRESHOLDS`, for example:

```json
{ "website": { "consecutiveFailures": 2 }, "alerts": { "cooldownMs": { "critical": 600000 } } }
```

Values are clamped to safe bounds (rates 1 to 100%, durations 1 second to 14 days,
counts at least 1), and invalid JSON falls back to the defaults with a warning.

## Owner steps before this is live

None of these has been done, and nothing has been deployed.

1. Apply migration 063 to each database (`npm run db:schema`), staging first.
2. Provision `MONITORING_SECRET` as a Worker secret (it authorizes
   `/api/monitoring/tick`, `/watch` and `/ingest`). Without it, request
   measurement and the per-minute monitor refuse to run.
3. Set `ADMIN_ALERT_EMAIL` (or rely on `RESEND_NOTIFY_EMAIL` /
   `TRADECATCH_ADMIN_EMAILS`) and confirm Resend has a verified sender.
4. **Add an external uptime check** (Cloudflare Health Checks, or any outside
   service) on the public site and `/api/health`, alerting the same people. The
   monitor runs inside the same Worker and database it watches, so a stopped
   scheduler or a fully down Worker cannot report itself.
5. On first deploy, the new per-minute job may briefly appear as missing in the
   scheduled-jobs check until it has run once.
6. Send a simulated incident in staging and confirm: the email arrives, the link
   opens the incident, acknowledge and resolve work, a recovery email follows, and
   turning the email provider off produces a failed delivery on the dashboard.
7. Deployment needs explicit approval.

## What was not verified

* The Worker entry (`worker.ts`), the ingest flush from a real Worker isolate, and
  the monitor's self-probe of the public site were never run against real
  Cloudflare. They are covered with fakes and the same code paths in Node.
* The signal collectors and the migration ran on PGlite (an in-process
  PostgreSQL), not on the production database. Real concurrent connections and
  `FOR UPDATE SKIP LOCKED` under contention are not proven.
* No real alert email was sent.
* Stripe rejected-signature failures are recorded by sampling, so the default
  threshold of 20 in 30 minutes is hard to reach; webhook processing failures and
  billing inconsistencies are the reliable Stripe signals.
* Appointment conflicts are not alerted. Grouping is per distinct problem, not
  per service.
* If an alert goes to several recipients and one fails, the retry may email the
  recipients who already received it (each attempt has its own idempotency key).
* Latency is time to response headers, not to the end of a streamed body.
* The simulated-incident behaviour changed: simulated incidents no longer reach
  the notifier. One assertion in `tests/unit/reliability.test.ts` was updated for it.
* Firefox, Safari and a real phone were not used; the browser tests ran in Chrome.

## Verification record

Automated tests, grouped by acceptance criterion. All run with
`npx tsx --test <file>` (unit) or Playwright (browser).

| Criterion | Where it is proven |
| --- | --- |
| MON-01 website down is Critical | `monitoring-rules`, `monitoring-watch` |
| MON-02 API error rate over threshold alerts | `monitoring-rules`, `monitoring-watch` |
| MON-03 isolated 403 or 429 does not alert | `monitoring-rules`, `monitoring-watch` |
| MON-04 routing failure is High | `monitoring-rules`, `monitoring-collectors`, `monitoring-watch` |
| MON-05 normal hang-ups do not alert | `monitoring-rules`, `monitoring-collectors`, `monitoring-watch` |
| MON-06 SMS failure detected and logged | `monitoring-rules`, `monitoring-collectors` |
| MON-07 calendar sync failure detected | `monitoring-rules`, `monitoring-collectors` |
| MON-08 repeated Stripe webhook failure alerts | `monitoring-rules`, `monitoring-collectors` |
| MON-09 database unavailable is Critical | `monitoring-watch` (both the storable and the unreachable case) |
| MON-10 identical errors grouped | `monitoring-incidents`, `monitoring-service`, `monitoring-postgres`, `monitoring-watch` |
| MON-11 recovery resolves the incident | `monitoring-incidents`, `monitoring-postgres`, `monitoring-watch` |
| MON-12 alert failure recorded and retried | `monitoring-incidents`, `monitoring-postgres`, `monitoring-notify` |
| MON-13 unauthorized access denied | `monitoring-watch-route`, `monitoring-ingest-route`, `monitoring-admin-routes`, browser `monitoring-health.spec.ts` |
| MON-14 System health shows accurate live data | `monitoring-health`, `monitoring-postgres`, browser `monitoring-health.spec.ts` |
| MON-15 no sensitive data in payloads | `monitoring-incidents`, `monitoring-rules`, `monitoring-service`, browser `monitoring-health.spec.ts` |
| MON-16 monitoring failure never breaks operations | `monitoring-hooks`, `monitoring-observations`, `monitoring-worker-observer`, `monitoring-watch`, `monitoring-service` |

### Results (2026-11-20, on this machine, Node via `tsx`, Chrome for the browser tests)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run lint` (`--max-warnings=0`) | clean |
| `npm run check:i18n` | OK (3088 keys) |
| `npm run check:secrets` | OK |
| Monitoring unit tests (`tests/unit/monitoring-*.test.ts`, 14 files) | 240 of 240 pass |
| Full unit suite (`npm run test:unit`) | 3402 pass, 3 skipped, 1 fail: `call-activity` "shows the stored UTC time in the business's own zone", which also fails on the untouched base (this Node's time zone data); not related to this work |
| Browser: `tests/monitoring-health.spec.ts` | 6 of 6 pass |
| Browser: `tests/admin-dashboard.spec.ts` (the console this work changed) | 18 of 18 pass |

Notes on the browser run: one earlier run had `ADM-09` (website requests, not
touched by this work) fail once and pass on every other run, so treat it as an
intermittent test under parallel load, not a regression. The new spec runs in
order on one worker because its tests share one simulated incident.

The browser harness has no database, public address or providers, so its areas
are always *Not measured*; the wording for measured areas (healthy, degraded,
incident) is checked by editing a real response (the "UI contract" test), and the
derivation behind it by `monitoring-health.test.ts`.
