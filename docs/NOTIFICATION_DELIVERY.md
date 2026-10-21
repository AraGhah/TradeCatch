# Notification delivery (TC-011, TC-012, TC-013)

Business notifications use PostgreSQL outbox events and delivery rows. Production refuses an in-memory notification store. Apply `npm run db:schema` before deploying this change (migration `023_notification_delivery_reliability`).

## SMS failure recovery

The signed Twilio status callback passes `MessageStatus` and `ErrorCode` to the notification service. Duplicate and out-of-order callbacks cannot regress a delivered message or restart a completed retry. Only the current attempt's provider SID can change the delivery. Storage failures return HTTP 500.

There are at most three provider attempts in total. Transient callback failures (30001, 30003, 30008, or a failure with no code) retry after one minute and then five minutes. Opt-outs, blocked/filtered numbers, invalid destinations and other permanent errors do not retry. Transport failures also use the same attempt budget. The attempt is persisted before contacting Twilio, so an interrupted worker cannot reset the budget. Network acknowledgement is not a guarantee of handset delivery.

A terminal SMS failure creates a system alert. For high/critical notifications, when escalation and its email channel are enabled, it queues an email to the configured backup member. Without a configured backup it selects another owner/admin, then the original owner/admin's email as an alternative channel. No arbitrary phone number or external recipient is accepted. Removed members or changed email addresses cancel delayed email. A missing or removed configured backup leaves the system alert for an administrator; it does not leak the alert to an unrelated contact.

Recovery email and system-alert keys are stable. Interrupted or concurrent callback recovery does not reset a sent fallback email. The scheduler retries unfinished recovery bookkeeping.

## Durable overflow queue

Fan-out saves all selected deliveries, including those beyond capacity. Capacity is forty external email/SMS dispatch reservations per organization in a rolling ten-minute window. In-app delivery does not use external capacity. Retries and expired worker leases reserve capacity too, conservatively preventing bursts after a worker interruption. A transaction and advisory lock serialize quota reservations across concurrent request/cron workers. Critical alerts rank before high and normal alerts, then oldest first. Excess rows stay pending and drain as capacity expires; a full window is not a delivery failure.

Each scheduled notification run handles at most ten events and ten deliveries, leaving remaining rows for subsequent runs. Worker database connections are reused only within an invocation and closed before that invocation ends, avoiding a separate TCP/TLS connection for every SQL statement without sharing sockets across requests.

The existing every-minute Cloudflare schedule calls `/api/notifications/tick`, independently of dashboard activity. Provision `NOTIFICATION_RETRY_SECRET` as a Worker secret, using the staged versions-secret workflow. The Worker and endpoint use this dedicated bearer credential. Existing ops credentials remain a fallback when the dedicated credential is absent. Never commit or log its value.

All escalation deliveries also enter the same claimed queue. Quiet-hour and mailbox-owner privacy rules remain in effect.

## Daily summary

Daily summaries are opt-in per member (the "Daily summary" checkbox in notification preferences). `POST /api/notifications/daily-summary/tick` runs from the existing every-15-minutes Cloudflare schedule and calls `generateDailySummaries`. It uses the same bearer credential as the notification tick (`NOTIFICATION_RETRY_SECRET`, with the existing ops credentials as the fallback).

- **When:** a business becomes due at 18:00 in its own time zone (`DAILY_SUMMARY_HOUR` in `daily-summary.ts`). Each run covers the local calendar day so far; day boundaries use the zone's own offset, so daylight-saving days are 23 or 25 hours long. An unusable stored zone falls back to America/Toronto.
- **What:** counts of what reached that member since local midnight (new leads, urgent requests, appointments, customer messages, failed transfers, outages and so on), from the member's own notification feed. A member scoped to "assigned" items therefore only sees counts for their own items. Earlier summaries are never counted. External messages carry counts only, never customer names or request details.
- **Language:** the member's notification language (English or French).
- **Delivery:** the summary is a normal `daily_summary` notification for that one member. Where it goes is set by the "Where to send the daily summary" row in preferences (in-app and email by default, SMS off). Quiet hours apply.
- **Exactly once:** the outbox key is `daily-summary:<member>:<local date>`, so overlapping, repeated or concurrent runs create one summary per member per local day. A day with no activity creates none. A missed run is not back-filled the next day.
- **Existing preferences:** stored preferences saved before this setting existed are filled in from the defaults when read, so the new row appears without a migration. The earlier migration that cleared stored `dailySummary: true` values has already run, so members who had opted in under the old, non-functional setting need to opt in again.

## Validation

`tests/unit/notification-recovery.test.ts` exercises transient/permanent callback failures, bounded retries, duplicates, out-of-order events, concurrent workers, crash recovery, backup membership changes, durable overflow, priority and retired preferences. Set `NOTIFICATION_TEST_DATABASE_URL` to isolated loopback PostgreSQL (`notifications_staging` or CI's `tc003_staging`) to require the real database variants. CI supplies this database for every quality run. Fake providers are used; these tests do not send SMS or email. `tests/unit/daily-summary.test.ts` covers the daily summary job (memory and PostgreSQL). The Gmail browser scenario saves the daily summary setting through the preferences form.

Provider references: [Twilio status callback ordering](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status), [queue overflow](https://www.twilio.com/docs/api/errors/30001), [unreachable handset](https://www.twilio.com/docs/api/errors/30003), [unknown carrier failure](https://www.twilio.com/docs/api/errors/30008).
