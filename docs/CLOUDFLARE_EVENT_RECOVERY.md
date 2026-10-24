# Cloudflare event recovery

## Scheduler authentication

The owner's October 23, 2026 Cloudflare capture contains repeated cron failures,
database authentication errors, failed monitoring writes and one socket rejection.
Repeated events are not independent customer-data failures.

The earlier database-secret repair remains effective: live monitoring reports
database health and the booking-notification processor succeeds. A new live log
sample instead confirmed two minute-schedule failures. The production Worker had
neither `MISSED_CALL_OPS_SECRET` nor `CRON_SECRET`, and neither existed in its
bundled fallback configuration. Notification-specific secrets do not authorize
generic scheduled routes.

A fresh random scheduler credential was supplied through protected stdin as an
encrypted production `MISSED_CALL_OPS_SECRET`. No existing credential was
overwritten, no value was printed or saved in development files, and neither
Twilio nor installation enforcement was enabled. The authenticated health check
accepts it and confirms database/schema connectivity. Other readiness checks may
still fail and must not be described as healthy automatically.

The supported release preflight now requires both an encrypted runtime database
secret and a shared scheduler credential. Dedicated notification/Gmail/monitoring
credentials remain preferred for their own routes; the shared credential covers
generic routes and fallback authentication. Routes still fail closed when a
credential is missing. Regression tests exercise every scheduled route.

Per-route failures now log the internal route, execution stage, HTTP status and
sanitized error code. Monitoring-persistence failures separately identify their
route. Arbitrary provider/error bodies and authorization headers are not copied
into these diagnostic events. Failed work still fails the scheduled invocation;
one failure does not stop later jobs or falsely record successful delivery.

Rollback is a normal reviewed code deployment. Preserve the database and scheduler
secrets; deleting either recreates the underlying outage. Do not clear queues,
mark deliveries sent, disable durable storage, approve domains, or reset provider
credentials to make the event graph green. Follow up with actual scheduled-result
evidence after the configuration repair.
