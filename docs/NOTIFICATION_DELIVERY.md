# Notification delivery (TC-011, TC-012, TC-013, TC-014, TC-015)

Business notifications use PostgreSQL outbox events and delivery rows. Production refuses an in-memory notification store. Apply `npm run db:schema` before deploying this change (migration `023_notification_delivery_reliability`).

## SMS failure recovery

The signed Twilio status callback passes `MessageStatus` and `ErrorCode` to the notification service. Duplicate and out-of-order callbacks cannot regress a delivered message or restart a completed retry. Only the current attempt's provider SID can change the delivery. Storage failures return HTTP 500.

There are at most three provider attempts in total. Transient callback failures (30001, 30003, 30008, or a failure with no code) retry after one minute and then five minutes. Opt-outs, blocked/filtered numbers, invalid destinations and other permanent errors do not retry. Transport failures also use the same attempt budget. The attempt is persisted before contacting Twilio, so an interrupted worker cannot reset the budget. Network acknowledgement is not a guarantee of handset delivery.

A terminal SMS failure creates a system alert. For high/critical notifications, when escalation and its email channel are enabled, it queues an email to the configured backup member. Without a configured backup it selects another owner/admin, then the original owner/admin's email as an alternative channel. No arbitrary phone number or external recipient is accepted. Removed members or changed email addresses cancel delayed email. A missing or removed configured backup leaves the system alert for an administrator; it does not leak the alert to an unrelated contact.

Recovery email and system-alert keys are stable. Interrupted or concurrent callback recovery does not reset a sent fallback email. The scheduler retries unfinished recovery bookkeeping.

## Durable overflow queue

Fan-out saves every recipient's delivery, including those beyond capacity: nothing is counted or dropped when messages are generated. The limit is applied only when a delivery is claimed for sending, which is the single path to every external email and SMS (`claimDeliveries`, then `attempt`).

- **Limit:** forty external email/SMS dispatch reservations per organization in a rolling ten-minute window (`DELIVERY_RATE_LIMIT`, `DELIVERY_WINDOW_MS`). In-app delivery does not use external capacity. Organizations do not share capacity.
- **Critical reserve:** critical alerts (urgent requests, receptionist outages) may use ten more reservations (`CRITICAL_DELIVERY_RESERVE`), so an organization is bounded at fifty per window in total. High and normal messages are held to the base forty even when the reserve is free, so a burst of ordinary messages can never delay a critical alert. Within one claim, critical alerts reserve first and ordinary messages only get what is left under the base limit.
- **Atomic and shared:** each delivery is counted as it is reserved, one `tc_notification_dispatches` row per claimed delivery, inside a transaction that holds an advisory lock. Concurrent request, cron and manual workers therefore share one count, and the memory store (tests and local development only) applies the same rules.
- **Retries:** retries and expired worker leases reserve capacity again, conservatively preventing bursts after a worker interruption.
- **Queueing:** critical alerts rank before high and normal alerts, then oldest first. Excess rows stay pending and drain as reservations leave the window; a full window is not a delivery failure, and a critical alert beyond the fifty is held, not discarded, until capacity returns.

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

## Receptionist outage alerts

When the Receptionist cannot continue a live call, the caller is sent to the backup line or voicemail (the fail-safe plan) and the business's owners and admins are told.

- **Detection:** the receptionist engine reports every fail-safe it takes through `onFailure` (`ReceptionistFailure`: business, operation, error code). `handleReceptionistFailure` (`src/product/receptionist/outage.ts`) resolves the business from the profile's `clientAccountId`, records a high-severity reliability failure for the platform, and queues one `receptionist_offline` event through the outbox. Both steps are independent, so a monitoring failure cannot hide the owner alert or the reverse. Work runs after the response (`runAfterResponse`) so the caller's TwiML is never delayed or lost.
- **Not outages:** calls the receptionist deliberately declines (unknown number, handling mode, routing reject) and a language-model failure that falls back to the rule brain are not reported.
- **Platform-wide boot failure:** if the receptionist runtime cannot start at all, no business can be identified. This records a critical reliability failure (incident and `ADMIN_ALERT_EMAIL`) instead of owner alerts.
- **Who and how:** owners and admins only, whatever their scope. The dedicated "Receptionist outages" row in notification preferences defaults to in-app, email and SMS on. Owners can switch email or SMS off per person. The event is critical, so quiet hours do not hold it. Preferences saved before this row existed pick up the default when read.
- **Once per window:** the outbox key is `receptionist-offline:<business>:<30-minute bucket>`, so a burst of failed calls raises one alert and a failure that continues is repeated every 30 minutes.

## Validation

`tests/unit/receptionist-outage.test.ts` covers the outage path: delivery to owners and admins by every channel (memory and PostgreSQL), opt-out and opt-in, night delivery, de-duplication per window, the failure handler's isolation of its two steps, the engine's reporting rules, and a full webhook run in which the session store fails mid-call, the caller still receives backup-line TwiML and the owner receives one critical alert.

`tests/unit/notification-rate-limit.test.ts` covers the limiter on the memory and PostgreSQL stores: fan-out to many recipients, overlapping workers, claims racing at the same instant, the critical reserve and its ceiling, organization isolation, and a mixed-traffic run that checks every window against the limits and that nothing is lost.

`tests/unit/notification-recovery.test.ts` exercises transient/permanent callback failures, bounded retries, duplicates, out-of-order events, concurrent workers, crash recovery, backup membership changes, durable overflow, priority and retired preferences. Set `NOTIFICATION_TEST_DATABASE_URL` to isolated loopback PostgreSQL (`notifications_staging` or CI's `tc003_staging`) to require the real database variants. CI supplies this database for every quality run. Fake providers are used; these tests do not send SMS or email. `tests/unit/daily-summary.test.ts` covers the daily summary job (memory and PostgreSQL). The Gmail browser scenario saves the daily summary setting through the preferences form.

Provider references: [Twilio status callback ordering](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status), [queue overflow](https://www.twilio.com/docs/api/errors/30001), [unreachable handset](https://www.twilio.com/docs/api/errors/30003), [unknown carrier failure](https://www.twilio.com/docs/api/errors/30008).
