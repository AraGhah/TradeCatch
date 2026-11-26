# Incident report: recurring 503 outages, 2026-11-25

Investigated 2026-11-26. Times are given as **Eastern (ET, UTC−5)** as in the
original report, with **UTC** beside them; Cloudflare and the incident database
store UTC. The ET reading was confirmed by the password-reset emails (sent
17:54:34 and 17:55:15 UTC = 12:54:34 and 12:55:15 ET, the times reported).

Evidence was gathered read-only: Cloudflare Worker analytics (GraphQL
`workersInvocationsAdaptive`, per minute, status and CPU time), `wrangler
deployments list`, the production admin API (`GET /api/admin/incidents`,
`/incidents/:id`, `/audit-logs`, `/health`, `/monitoring/overview`) with the ops
bearer, and the alert emails' Gmail metadata. Nothing in production was changed.

## 1. Summary

All eight incidents have **one confirmed cause**: Cloudflare stopped the Worker
for exceeding its CPU limit (status `exceededResources`, Error 1102, HTTP 503)
on the monitor's own once-a-minute checks of `/` and `/api/health`. Every
stopped check died at **exactly 10.0 ms of CPU**, which is the Workers **Free**
plan's per-request limit; the pages themselves need 20 to 1,800 ms of CPU. The
503s were real answers from Cloudflare, not a bug in the check, but almost every
one hit the monitor's probes: visitors' requests in the same windows mostly
succeeded (for example 20:41 UTC: 138 successful requests, 2 stopped, both probes).

The monitoring system then made a real but intermittent condition look like
eight separate 3–5 minute outages, resolved incidents while checks were still
failing, sent two emails per event, sent one event's emails with no content, and
sent no resolution for an incident closed by hand. Those are fixed in code.

The CPU limit itself cannot be fixed in code: Next.js server rendering does not
fit in 10 ms. **The fix is the Workers Paid plan** (owner action, about US$5–6
per month at current usage).

## 2. Incident by incident

"Stopped checks" counts the monitor's probes stopped at 10.0 ms CPU, from
Cloudflare analytics. Incident IDs are `tc_system_incidents.id`.

| ET (reported) | UTC | Incidents (prod DB) | What Cloudflare shows | Emails |
| --- | --- | --- | --- | --- |
| 10:54–10:57 | 15:54:47–15:57:57 | `inc_7d40cf65` API, `inc_77743999` page | both probes stopped 15:52, :53, :54, :55, :57; checks failing 15:45–16:04 | 2 opened, 2 resolved |
| 12:26–12:29 | 17:25:58–17:28:58 | `inc_03e7e2a8` page | page probe stopped 17:23, :24, :25 (API had one success at 17:24), both 17:27–:28 | 1 opened, 1 resolved |
| 13:18–13:22 | 18:18:47–18:22:01 | `inc_74b995e7` API, `inc_7baa4a5b` page | both stopped 18:16, :17, :18 | 2 opened, 2 resolved |
| 13:53–14:20 | 18:53:47–19:20:03 | `inc_76c32f1e` page (reopened twice), `inc_9b3c43d3` API | stopped 18:49, :51–:53, 19:00, 19:06–:08, 19:10–:15, 19:20, :22, then still 19:26–:27, :29–:30, :32, :36, :39 | 3 opened, 4 resolved |
| 15:43–"unknown" | 20:42:57–20:48:01 | `inc_c8be8960` page, `inc_a4946704` API | both stopped 20:40–20:44 | 2 opened, 1 resolved (page closed by hand: no email) |
| 16:11–16:15 | 21:11:47–21:15:53 | `inc_2b27d852` API, `inc_0e331908` page | both stopped 21:09–21:12 | 2 opened, 2 resolved |
| 16:56–17:01 | 21:56:47–22:01:04 | `inc_035be548` page, `inc_94872f6d` API | both stopped 21:54–21:57 | 2 opened, 2 resolved |
| 17:19–17:25 | 22:19:47–22:24:57 | `inc_9fc51ebf` page, `inc_4b8cba43` API | stopped 22:18–22:20, :22, :24 | 2 opened, 2 resolved; the page incident's two arrived as "Incident requires attention" |

Hourly totals on 2026-11-25 (UTC): stopped fetches were 0–7 per hour before
15:00, then 20, 16, 44, 34, 44, 19, 34, 24 per hour from 15:00 to 22:59, and
0–5 per hour after 23:00. Cloudflare does not publish how its CPU allowance
for over-limit requests is spent, so **why the kills cluster in that afternoon is
not established**; what is established is that each stopped request died at the
plan's 10 ms limit.

## 3. Root causes

### Confirmed (with evidence)

1. **CPU limit of 10 ms per request (Workers Free plan).** Every stopped probe
   shows `exceededResources` at CPU p50 = 10.0 ms; successful renders use
   20–1,800 ms. The plan itself is not readable with the available API token
   (subscriptions endpoint 403), so the plan name is inferred from the limit:
   **confirm in the Cloudflare dashboard (Workers & Pages → Plans).**
2. **The site's own scheduled work is most of its load.** About 90% of
   invocations are the per-minute cron and its two self-probes. The cron run
   uses 100–1,800 ms CPU every minute. Probes were stopped mainly in DFW and LHR
   (the data centres that run the cron) while visitors in YYZ/EWR succeeded.
3. **The per-minute cron has failed on every run since 2026-11-22 19:31 UTC**
   (`scriptThrewException` ~60 per hour): `/api/calendar/google/tick` fails each
   time (System Health job incident open since then, 357 occurrences). Google
   Calendar is not configured in production, and the route still read the sync
   tables, which are missing from the production database (scheduling schema
   drift; `node scripts/schema-targeted.js --check` reports it).
4. **Monitoring defects** that turned one intermittent condition into the eight
   reported outages:
   * *Premature resolution.* Resolution only needed 3 minutes without a new
     "3 failures in a row" finding. One successful check broke the run of
     three, so the incident resolved at 19:11:58 UTC while 19:10 and 19:11 had
     failed; the 19:20:03 resolution was followed by failures until 19:39.
   * *Why 3–5 minutes.* The durations are the monitor's own windows: 3 failed
     checks to open, 3 quiet minutes to close. The underlying kills were not
     3–5 minute events; they came and went all afternoon.
   * *Duplicates.* `/` and `/api/health` had separate incidents
     (`website:unavailable:page` / `:api`) for the same Worker, so most events
     sent 2 opened + 2 resolved emails.
   * *No resolution email at 15:43 ET.* The page incident was resolved by hand
     (`POST /api/admin/incidents/inc_c8be8960…/resolve` at 20:45:33 UTC, audit
     log, your super-admin session). Manual resolution never queued a
     notification. The API incident, also resolved by hand at 20:44:49, reopened
     8 seconds later because checks were still failing, then resolved itself at
     20:48:01 with an email.
   * *Empty 17:19 ET emails.* Incident ID `inc_9fc51ebf-83e6-4992-b530-272773860567`
     ends in twelve decimal digits, which the phone-number redaction pattern
     matched. The alert failed its final safety check and was replaced by the
     fallback, which kept 6 fields and labelled even the resolution
     "[TradeCatch CRITICAL] Incident requires attention". Reproduced by
     replaying the real incident rows through `composeAlert` + `safePayload`.
   * *No diagnostics.* The summary was only "3 consecutive availability checks
     failed (page); last status 503." No time range, no Cloudflare error code,
     no request ID.

### Not established (hypotheses or unknowns)

* Why Cloudflare's tolerance for over-limit requests ran out around 15:00 UTC
  and recovered after 23:00 UTC. Cloudflare does not document the mechanism.
* After 23:00 UTC the pattern changed: few stopped page requests, but 11–30
  stopped **cron** runs per hour (at 50 ms CPU). Three "Database or monitoring
  was unavailable" incidents on 2026-11-26 (00:27, 01:02, 01:55 UTC) were
  monitor runs that did not finish, not database failures (the database answered;
  no database-down email was sent). In the 00:53–01:02 gap the cron did run
  every minute, so why the monitor stage did not record its heartbeat is
  unknown: Worker logs are not readable with the current token (observability
  scope missing).
* Provider checks in the 2026-11-26 14:08 UTC health read (Twilio voice/SMS,
  Stripe "check failed or timed out") were not investigated; they may relate to
  the secret changes deployed 2026-11-25 22:49 and 2026-11-26 04:01 UTC.

### Ruled out

* **The 2026-11-24 database outage.** The last database-down email was sent
  2026-11-25 02:14 UTC; none during the eight incidents; the database probe was
  healthy throughout (the gap and website incidents carry no database code). The
  kills happen at 10 ms, before any database work.
* **A deployment.** No code deployment since 2026-11-22 19:34 UTC (version
  6bfe3c2b, git 7b5ac1ac). Only two secret changes (2026-11-25 22:49 UTC,
  2026-11-26 04:01 UTC), both after the last of the eight incidents.
* **Rate limiting, database pool exhaustion, memory.** No 429s in the incident
  windows; stopped requests die at the CPU limit, with memory at 40–63 MiB of 128.

## 4. Email reconciliation

The incident database holds, for the eight events, **16 "opened" and 16
"recovered" alert rows, all `sent` on the first attempt**. By subject they
arrived as:

* 15 × "[TradeCatch CRITICAL] Website is unreachable / Public API is unreachable"
* 15 × "[TradeCatch RESOLVED] Resolved: …"
* 2 × "[TradeCatch CRITICAL] Incident requires attention": the opening
  (22:19:49 UTC) **and the resolution** (22:25:01 UTC) of `inc_9fc51ebf`.

So the "15 critical" are the 15 unreachable emails, and the
two "attention" emails are one opening and one resolution. If 16 resolutions
were counted, one of the two attention emails was counted as a resolution.
Every opened incident has a resolution row except `inc_c8be8960` (closed by
hand, see above).

## 5. Security review: password reset 12:54:34 → 12:55:15 ET

Audit log (`tc_audit_logs`, read through `/api/admin/audit-logs`), UTC:

| Time | Event | Account |
| --- | --- | --- |
| 17:46:12 | `password_login` | a second (business) account |
| 17:49:17 | `logout` | that business account |
| 17:49:30 | `password_login_failed` | the platform super-admin account |
| 17:54:33 | `password_reset_requested` | super-admin |
| 17:55:13 | `password_reset` | super-admin |
| 17:55:14 | `password_change_notice_sent` | super-admin |
| 17:58–18:46 | 5 × `mfa_enroll_started`, `password_login` 18:47:27, `mfa_enabled` 18:48:08 | super-admin |
| 20:16:56 | `mfa_verified` | super-admin |
| 20:44:49, 20:45:33 | resolve incidents "via session" | super-admin |

Findings:

* **The mechanism behaved correctly.** The deployed code (7b5ac1ac, which
  includes the KAN-27 hardening) issues a random token stored only as a hash,
  valid 30 minutes, sent to the account's own address; completing it is one
  transaction that spends the token only if unused and unexpired, sets the
  password, cancels every other open link and revokes every session
  (`UPDATE tc_sessions SET revoked_at …`), then signs the browser in. The reset
  email was delivered to the owner's Gmail at 17:54:34 and the "password
  changed" notice at 17:55:15. Using the link required access to that mailbox.
* **The sequence matches an owner setting up a new admin account**: a failed
  sign-in, a reset 4 minutes later, MFA enrolment straight after, and the same
  session resolving incidents later. The previous day's investigation records
  the owner describing exactly this flow (forgot password on the new admin
  account, then Error 1102 on `/fr/admin` at 17:55:14 UTC, Ray
  `a60285f1d86c36d4`).
* **Not verified:** IP address and device. The audit rows store neither. They
  are on the session rows. To check them, run this read-only query on the
  production database (it returns the sessions for that account on that day):

  ```sql
  SELECT s.id, s.created_at, s.revoked_at, s.ip, s.user_agent
  FROM tc_sessions s
  WHERE s.user_id = 'usr_acae5bd3ac186b58d3097b3d'
    AND s.created_at >= '2026-11-25T17:00:00Z' AND s.created_at < '2026-11-26T00:00:00Z'
  ORDER BY s.created_at;
  ```

  If any IP or browser there is not yours, change the password and the
  mailbox's password, and revoke sessions. Nothing else in the audit log is
  unusual. The last suspicious-looking event is `refresh_token_reuse_detected`
  on 2026-11-16, unrelated to this day. There are no open security incidents.

## 6. What was changed (branch `investigate-and-resolve-recurring-production-outages`, uncommitted)

| Priority | Fix | Files |
| --- | --- | --- |
| Critical (owner) | Move the Worker account to Workers Paid. No code can fit SSR in 10 ms. | none |
| Critical | The Google Calendar per-minute pass returns at once when Google Calendar is not configured (no business can be connected), so the cron stops failing every minute and stops wasting CPU. The missing tables stay visible in System Health and `schema-targeted.js --check`. | `src/product/scheduling/runtime.ts` |
| High | A website incident resolves only after **5 consecutive successful checks on every address** (`website.recoverySuccesses`), checked in the incident engine so the 15-minute tick cannot bypass it. No checks at all is not recovery. | `incidents.ts`, `rules.ts`, `thresholds.ts` |
| High | Page and API failures share **one** incident (`website:unavailable`), titled by what failed; older per-address incidents still resolve. | `rules.ts` |
| High | A manual "Mark resolved" sends the resolution email; resolution emails say who resolved. | `incidents.ts`, `alerts.ts` |
| High | Generated IDs (UUIDs, cf-ray) are no longer mistaken for phone numbers; the safety fallback keeps every safe line, labels resolutions RESOLVED, and says something was withheld. | `types.ts`, `alerts.ts` |
| Medium | The website check records the Cloudflare error code (`cf_1102`), the request ID (cf-ray), and timeout vs connection failure; the incident summary names each failing address, since when, how many in a row, the status, the cause and the request ID. | `collectors.ts`, `types.ts`, `rules.ts`, `watch.ts` |
| Medium | The "Database or monitoring was unavailable" summary says, when the database answers, that the monitor run itself was stopped. | `watch.ts` |
| Low | Monitoring doc updated. | `docs/KAN-28-MONITORING.md` |

Opening thresholds are unchanged (3 failed checks in a row, 1 per minute);
nothing was silenced, no timeout was extended, and no check was removed.

## 7. Tests

* `npm run test:unit`: **3,716 tests, 3,705 pass, 0 fail, 11 skipped**
  (env-gated PostgreSQL suites). Baseline monitoring suites before the change:
  229/229. After: 243/243 plus 2 new calendar tests.
* `npx tsc --noEmit`: clean. ESLint on changed files: clean.
  `npm run check:secrets`: OK.
* **Recovery replay** (`monitoring-watch.test.ts`, "replays the real
  2026-11-25 18:45–19:39 UTC probe outcomes"): the real per-minute outcomes
  from Cloudflare run through the monitor. Old rules (production record):
  7 emails, "resolved" at 19:11:58 and 19:20:03 with checks still failing.
  New rules: one incident, 3 emails in the window (opened, resolved after 5
  clean minutes 18:54–18:59, reopened at 19:08), **no resolution while checks
  keep failing through 19:39**, resolution after 5 clean checks.
* Regression tests for: correlation, sustained recovery, no evidence = no
  recovery, manual resolution email (exactly one), the real `inc_9fc51ebf` ID
  keeping its full alert, the fallback labelling, Error 1102 + cf-ray parsing,
  and the calendar pass with and without credentials.
* **Not run:** a load test against production (it would cause the CPU kills
  under investigation); Playwright System Health spec (UI unchanged); the
  PostgreSQL store suites (no SQL changed); a deployed run of these changes.

## 8. Owner actions, in order

1. **Workers Paid plan** for the Cloudflare account (dashboard → Workers &
   Pages → Plans). Afterwards, stopped fetches at 10 ms should drop to zero.
   Re-run the per-minute analytics to confirm.
2. Review and deploy this branch (`npm run deploy`; the release guard checks
   Worker secrets first).
3. Back up the database, run `node scripts/schema-targeted.js --check`, then
   `--reapply 012_scheduling --yes` (and 040/041, see the 2026-11-25 notes),
   so the Google Calendar tables exist before Google Calendar is configured.
4. Optionally, run the session query in §5 to confirm the IP and device of the
   12:54 ET reset.

## 9. Remaining risks

* Until the plan changes, **real visitors can still get Error 1102** (5
  requests from YYZ were stopped on 2026-11-25; the owner's `/fr/admin` at
  17:55:14 UTC was one). The monitoring changes make this visible and stop the
  email churn. They do not prevent it.
* The per-minute cron is still CPU-heavy (6 job routes through Next.js each
  minute). On a paid plan that costs CPU-ms, not availability.
* Cause of the three 2026-11-26 monitor gaps is unknown without Worker logs.
* An incident's title is set when it opens; if the API starts failing after
  the page, the summary (not the title) says both are affected.
* Provider health checks failing on 2026-11-26 (Twilio, Stripe) and the
  "Calls are missing a final status" incident (2026-11-25 23:36 UTC) were not
  part of this investigation.
