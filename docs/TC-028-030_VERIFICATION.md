# Notification settings and recipient language

Date: October 23, 2026.
Branch: `tradecatch-notification-settings-and-delivery`.

## Existing completed items

- TC-027 already has primary/backup employee selectors with names, roles, verified
  personal phones, ID persistence, and server-side membership validation. Existing
  unit and browser checks were rerun rather than replacing the implementation.
- TC-030 already downloads a ZIP containing CSV business records, account profile,
  manifest, and exclusions. Existing source/CSV/ZIP tests and the browser download
  and cross-account access checks passed.

## TC-028

The existing quiet-hours checkbox is exposed as an accessible switch. The browser,
API and service validate `HH:mm` times. Equal enabled boundaries are rejected;
disabling quiet hours permits equal boundaries. Both ordinary and overnight quiet
periods retain their minutes. Scheduling uses the business IANA timezone, resolves
the exact next minute, and handles daylight-saving changes. Invalid stored zones
use the existing Toronto fallback.

Retries recheck quiet hours before contacting a provider without spending a delivery
attempt on deferral. Existing urgent after-hours overrides remain in effect.
Member and viewer preferences remain assigned-only at the API boundary.

## TC-029

Template inputs are persisted with each notification. Email subject/title/body,
SMS body, and in-app reads render using the recipient's saved preference, falling
back to their profile locale when first creating preferences. This also covers
delivery retries, backup escalation and consolidated notifications. Authored free
text and already recipient-specific daily summaries retain their original text.

Current membership, email destination and personal-phone ownership are checked
before delivery. Gmail external alerts remain generic while authorized in-app
reads retain their details. Private template inputs are removed from user-facing
notification responses. Consolidated template input lists are bounded.

## Database rollout

Apply the additive `026_notification_localized_content` migration through the
existing `npm run db:schema` process before deploying the new application.
`localized-content.sql` adds `content_json` to the existing protected notification
table and backfills from matching organization-scoped outbox events. Existing
notifications without retained source inputs can only render generic translated
templates. PostgreSQL test fixtures now apply the same migration.

No production database migration or application deployment was performed here.

## Verification

- Final full unit suite: 805 passed, 0 failed, 2 skipped.
- Browser checks: 7 passed, including English/French quiet-hour persistence,
  invalid-time rejection, cross-account denial, employee selection and ZIP download.
- TypeScript, full repository lint and configured format checks, changed-file
  formatting, translation parity, secret scan, production build, OpenNext
  Cloudflare build, Worker bundle dry-run and QA suite passed.
- Production dependency audit: zero reported vulnerabilities.
- Native PostgreSQL integration is conditional on the isolated test database.
  No local PostgreSQL service is available; Docker Desktop's engine could not
  start. The new persistence test and updated migration fixtures remain available
  for the existing CI PostgreSQL service.

## Booking delivery alerts: unresolved configuration

The currently active production Worker version is
`50e54e0c-991c-42e5-bbfe-ecf4f1095b4e` (100% traffic when checked).
Its deployed binding metadata contains `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
`ADMIN_ALERT_EMAIL`, and `BOOK_AUDIT_RETRY_SECRET`, but no `LEADS_WEBHOOK_URL`.
The CRM sender returns unsuccessful when that URL is missing; the queue correctly
keeps the CRM job pending. Email credential presence alone does not prove sender
verification or provider acceptance. Public health returned 200, which is only
liveness and does not verify delivery readiness.

The supplied lead references were:

- `tc024_verify_8224c62c-dcee-4822-bec5-eff2e827d058`
- `bal_tc002_verify_0b62cbaa04d6`

The existing durable worker already retries unsuccessful channels independently
and preserves delivered channels. After configuring the intended CRM endpoint and
verifying the email provider, an authorized operator can POST each lead separately
to `/api/book-audit/notifications/tick` with a bearer booking-retry credential,
`X-Ops-Actor`, and a JSON body containing `leadId` and `limit: 3`. The worker honors
the existing due time/backoff. Do not mark these jobs delivered merely to silence
the alert or bulk-resend successful channels.

The credential values are not readable through Cloudflare's secret-list API and
were not available in this session. No authenticated queue inspection or retry
was performed, and delivery recovery is not claimed.
