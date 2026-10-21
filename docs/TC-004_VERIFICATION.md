# Problem 4 — Gmail reply alerts and synchronization

Commit message: `Problem 4 — Add configurable Gmail reply alerts and sync status`

## Changes

Important, unread customer emails now use the mailbox owner's reply notification
preferences. Email and SMS are explicit opt-ins, independently of in-app alerts.
The settings page links directly to these controls. SMS uses the configured
business number; email uses the owner's account email. External alerts omit the
sender, subject, and email body. In-app details remain available only to the
mailbox owner, including owners whose workspace role normally limits notices to
assigned items.

The PostgreSQL message insert and alert-outbox insert are one atomic statement.
Failed queuing rolls back the import, so advancing the Gmail history cursor cannot
silently discard an alert. Initial historical mail, automated messages, outgoing
mail, and already-read messages do not trigger alerts. Repeated imports and
outbox processing do not reset completed deliveries.

Deliveries use atomic claims, honor quiet hours, recheck preferences/membership
before retries, and retain provider failures for retry/failure reporting. Email
success requires an actual Resend message ID; a returned API error is never
treated as success. Email retries have a stable provider idempotency key.

Gmail push watches register and renew automatically when OAuth, a Pub/Sub topic,
and the webhook secret are configured. The UI calls push active only when a
connected mailbox has an unexpired registered watch. Transient failures and
throttled pushes return HTTP 503 for Pub/Sub retry, while stale duplicates are
acknowledged without repeating the import.

The Cloudflare one-minute schedule now checks for Gmail accounts last attempted
at least five minutes ago, and drains only Gmail reply alerts/retries. A dedicated
`GMAIL_SYNC_SECRET` authorizes this job without enabling unrelated cron jobs.
Both settings and the dashboard show the last successful sync, in Toronto time,
and update that time after empty successful syncs too.

## Configuration

Existing reply preferences are retained; this release does not turn on external
messages without the mailbox owner's opt-in. Email needs working Resend credentials
and `RESEND_FROM_EMAIL`. SMS needs Twilio credentials, `TWILIO_FROM_NUMBER`, and the
organization's business phone number. Demo organizations always simulate delivery.

For Google push, configure `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET`,
the redirect URI, `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUSH_AUDIENCE`, and `GMAIL_PUSH_SERVICE_ACCOUNT`. Create the Pub/Sub
topic in the OAuth client's project, give
`gmail-api-push@system.gserviceaccount.com` publisher access, and create an HTTPS
authenticated OIDC push subscription targeting `/api/webhooks/gmail` (no query; see GMAIL_SETUP.md).
Keep secret values in secure server settings. Connecting/syncing a mailbox then
registers its watch automatically; background polling remains available when a
watch cannot be registered or has expired.

Google reference: [Gmail push configuration and watch renewal](https://developers.google.com/workspace/gmail/api/guides/push).

## Validation

- 11 isolated PostgreSQL/alert tests passed, including atomic rollback, concurrent
  processing, idempotency, privacy, opt-ins, quiet hours, retries, removed members,
  and preventing the Gmail scheduler from processing unrelated notifications.
- Three additional provider/push/auth tests passed: Resend rejection handling,
  dedicated Bearer authentication, push retry, watch activation/fallback, and
  failure-safe freshness reporting.
- Full unit suite: 631 passed, one existing integration check skipped.
- Browser suite: all 158 passed, including configurable reply channels,
  synchronization timestamps, push ingestion, and accessibility checks.
- i18n parity: 1,924 keys. Legal, media, and secret checks passed.

Existing global lint/format and generated Cloudflare-type issues remain outside
this change. The Gmail release was isolated because concurrent receptionist-booking
drafts appeared in the original workspace and temporarily failed type checking.
Those drafts are excluded from this release and left untouched.

## Production

The production rollout was verified with a labelled demo mailbox and synthetic alerts.
Google OAuth/Pub/Sub configuration was unavailable in the configured environment;
real Gmail push activation cannot be claimed until that account setup is provided.
No real customer email or SMS is sent by the production smoke fixtures.

Production version: `b4c103a4-30f8-40b6-831f-dfa1d94af6a8` at 100%.

Live verification passed for the status API, settings text, owner-only recipients,
configurable reply preferences, dedicated scheduler authentication, and email/SMS
simulation for a labelled demo organization. The real automatic Cloudflare cron
processed a second queued reply alert with no dashboard open. No actual external
email or SMS was sent by this smoke test.

The checks also identified missing legacy Gmail columns in Supabase. The existing
idempotent Gmail schema was applied transactionally with migration marker
`022_gmail_sync_columns`. RLS remained enabled and server access was verified. The
schema runner now records this upgrade for future deployments.

All test mailbox, notification, delivery, preferences, organization, owner, and
session rows were removed. Existing organization plans/statuses were unchanged.
The temporary scheduler-secret file was deleted; its deployed secret binding remains.

The isolated release passes TypeScript, the production/OpenNext builds, and the
Cloudflare bundle dry run. Existing global checks still report 10 unrelated lint
errors/13 warnings, unformatted files, and stale generated Cloudflare declarations.
Google push activation and real provider delivery still require configured Google
and delivery-provider accounts; this release reports that state honestly.
