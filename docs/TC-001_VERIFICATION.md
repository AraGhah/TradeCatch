# TC-001 — Require durable booking lead storage

Date: October 20, 2026. Development branch: `codex/tc-001-durable-booking-leads`.
Changes are uncommitted and have not been pushed.

## Behavior

- A valid booking submission returns HTTP 503 if PostgreSQL storage is disabled,
  its connection URL is absent, or its insert fails or returns no saved record.
- Email and CRM delivery run only after PostgreSQL confirms persistence.
- PostgreSQL's unique idempotency key handles duplicates. Memory and Redis claims
  can no longer acknowledge a request before its database save succeeds.
- Failed saves remain retryable with the same key. Email/CRM outages do not lose
  a lead that has already been saved.
- The honeypot continues to discard bot submissions without creating leads.

## Verification

- Full unit suite: 604 passed, 0 failed, 1 unrelated integration test skipped.
- Focused TC-001 tests: all 9 passed.
- Browser suite: 153 passed in the final full run; its remaining form-error test
  passed after correcting its selectors and checking that review answers remain
  visible. All 154 browser checks have passed across that run and its rerun.
- Isolated local staging: a disposable native PostgreSQL 18 cluster with
  synthetic contacts and a restricted test database role. No staging cloud
  Worker existed; production credentials were not used for these tests.
- Actual staging SQL verified successful persistence and consent, survival across
  a database restart, one row from five concurrent requests, rejected INSERTs
  with no notifications, successful retry after access recovery, and rejection
  when storage was disabled. Email and CRM outages were simulated.
- TypeScript, lint/format checks for changed files, i18n parity, legal/media
  checks, production build, OpenNext build, and Worker packaging dry-run passed.

## Existing repository check failures

Repository-wide lint reports React rule failures in unchanged files;
repository-wide formatting reports 117 unchanged files; `cf-typecheck` reports
that the generated Worker declarations are stale. These were recorded without
reformatting unrelated code or changing generated types for this issue.

## Production

TC-001 is deployed and its storage-failure behavior is verified on production.

- Worker: `tradecatch`; origin: `https://tradecatch.ca`.
- Fixed production version: `3049d2a9-95b1-4c6d-8bb7-a85f34d8c4e9`.
- Both `/api/health` and `/book-audit` returned HTTP 200 after deployment.
- A temporary version with both durable-store flags disabled was added at **0%
  traffic**, while the normal fixed version remained at **100%**. The synthetic
  requests explicitly selected that version through Cloudflare's documented
  [version override header](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/).
- The storage-disabled POST returned HTTP 503 and the save-error message. A
  second POST using the same idempotency key also returned HTTP 503, with no
  `ok` or duplicate-success response. This test version could not save a lead.
- The temporary version was removed from the active deployment immediately
  afterward. The fixed normal version was restored to **100%** traffic.

The normal live synthetic submission was rejected by Turnstile before reaching
persistence (HTTP 400). The public booking page currently has no Turnstile
widget, although the Worker has a Turnstile secret. This separate configuration
issue remains outside TC-001; successful end-to-end live booking was not claimed.
The successful-save and database-restart evidence above comes from isolated
staging, while the storage-disabled rejection was exercised on production.

The adapter carries server settings from the build as well as runtime bindings;
absence of a database binding in the Cloudflare dashboard alone does not prove
that production has no database configuration.
