# TC-002 — Saved leads and notification retries

Date: October 20, 2026. Branch: `tc-002-notification-retries`.
No commits or pushes were made.

## Behavior

The lead and its three notification jobs commit in one PostgreSQL statement.
An outbox failure rolls back the lead save; the form cannot confirm an unsaved
request. The response explicitly separates `leadSaved` from
`notificationsDelivered` and reports notifications as `pending` or `delivered`.
The browser requires `ok: true` and `leadSaved: true` before confirming storage;
English and French confirmation copy allows for delayed email.

Administrator email, customer confirmation, and CRM forwarding retry independently.
Successful channels are not deliberately resent. PostgreSQL leases prevent
concurrent workers from claiming the same job, expire after two minutes, and use
tokens to fence old workers. Retry delays are one minute, five minutes, fifteen
minutes, then hourly, with no final discard of an undelivered job.

After three unsuccessful attempts, one durable administrator alert is queued for
the lead. It uses `ERROR_WEBHOOK_URL` and remains queued until the monitoring
endpoint acknowledges it. If all delivery recovers first, the alert is resolved.
Mail requires a provider send ID before being marked sent. Delivery flags record
provider acceptance, not proof that a recipient has read an email. Stable
idempotency keys are sent to Resend and the CRM endpoint; CRM deduplication also
depends on the receiving service honoring that key.

## Operations

- Migration: `src/lib/book-audit-notifications.sql`, registered as
  `020_book_audit_notifications` in the existing schema installer. The queue has
  row-level security enabled and no public access policy.
- Known historical failures are queued. Historical customer email is not assumed
  delivered, and customer confirmations are not resent in bulk when the old
  administrator-email flag is already true.
- The existing Cloudflare minute schedule invokes
  `/api/book-audit/notifications/tick` before the other scheduled routes.
- `BOOK_AUDIT_RETRY_SECRET` authorizes only that endpoint; existing operations or
  cron credentials can also authorize it. A manual call requires `X-Ops-Actor`.
  The scheduler supplies its existing cron actor marker. The dedicated secret
  does not authorize other operations endpoints or enable unrelated jobs.
- Authorized operators can submit `{ "leadId": "...", "limit": 12 }` to retry
  one lead. Scheduled calls process due work in bounded batches.

## Verification

- Full unit suite: 614 passed, 0 failed, 1 unrelated integration test skipped.
- Isolated native PostgreSQL staging: 21 checks passed, including 12 real database
  cases covering atomic rollback, channel failures and recovery, customer-only
  retries, provider acknowledgments, concurrent workers, expired/stale leases,
  recipient preservation, historical migration, public-role restrictions, and
  rejected/acknowledged administrator webhooks. The worker also accepts empty
  scheduled POST streams while rejecting malformed or oversized nonempty input.
- Three pending jobs survived a full PostgreSQL shutdown and restart.
- All 157 browser tests passed, including the new saved-lead response checks.
- Changed-file lint and formatting, TypeScript, i18n, legal/media checks, the
  production build, OpenNext build, and Worker bundle dry-run passed.
- The pre-existing repository-wide lint failures, 117 formatting failures, and
  stale generated Cloudflare declarations remain outside this change.

## Production

TC-002 is deployed and verified on production.

- Worker: `tradecatch`, origin: `https://tradecatch.ca`.
- Final version: `aceb8b11-6eeb-4dee-bcea-d1fc98075834`, serving 100% of traffic.
- The additive migration was applied. Both runtime durable-store flags are
  explicitly enabled, and the dedicated booking retry credential is installed.
- Normal health returned 200; an unauthenticated retry request returned 401.
- One clearly labeled synthetic lead and its three jobs were persisted. The
  authenticated worker returned 200, recording three unsuccessful delivery
  attempts and retaining all three jobs for retry.
- Without a manual invocation, the production minute scheduler advanced all
  three channels from attempt 2 to attempt 3. It also created and processed one
  administrator alert, which the configured monitoring endpoint acknowledged.
- The original email/CRM jobs remained pending after the administrator alert;
  alerting did not discard them or falsely mark them delivered.
- Only the synthetic fixture's due times were advanced to exercise retries
  promptly. Its lead and linked jobs were removed after verification. Production
  had zero leads before this test and returned to zero afterward.

Live checks caught and resolved stale disabled runtime flags and OpenNext's
representation of a bodyless scheduled POST as an empty stream. Empty-body
handling is covered by a database regression test; nonempty malformed and
oversized input is still rejected.

The pre-existing public Turnstile configuration issue from TC-001 is separate.
Successful public form submission on the live site was not claimed. The form
contract was verified in browsers, the complete save/delivery path with isolated
PostgreSQL, and the deployed queue/scheduler/administrator alert with synthetic
production data.
