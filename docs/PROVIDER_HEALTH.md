# TC-021 — provider and scheduled-job health

The admin monitoring dashboard separates status from verification state:

| State | Evidence |
| --- | --- |
| Unconfigured | Required credentials or connection settings are absent |
| Configured | Settings exist; no successful connection established |
| Connected | An authenticated provider read succeeded; business operation unverified |
| Operational | An actual operation succeeded (database query, calendar availability read, or recent real notification acceptance with a fresh processor result) |
| Delivery verified | A recent real SMS delivery is independently confirmed against the currently authenticated Twilio account |

Credentials, test-mode Stripe, mock calls and simulated notifications never prove
production operations or delivery. Twilio account and AI model-list reads prove
connectivity only. Stripe account readiness does not prove a successful charge.
Calendar reads sample one connected calendar and explicitly do not verify other
workspaces or write permission. Notification provider acceptance is not proof
that an email reached an inbox or an SMS reached a handset.

Provider checks use bounded network requests and generic errors. They neither
send test messages, charge cards nor start calls. Admin-only APIs expose the
results; the public health endpoint remains a separate liveness/readiness probe.

## Scheduled jobs

Cloudflare records every route's actual HTTP success/failure, including thrown
invocation errors. A heartbeat from the monitoring endpoint cannot mark another
job successful. Results persist in `tc_health_checks` using one stable row per
job. Required freshness is five minutes for minute jobs, forty minutes for
15-minute jobs, and 27 hours for daily retention. Missing results are unverified,
not healthy. The monitoring job itself is recorded only after it completes.

Provision `MONITORING_SECRET` securely for the Worker. It authorizes only
`/api/monitoring/tick`; existing job credentials retain their scopes. Configure
`ADMIN_ALERT_EMAIL` (or the existing `RESEND_NOTIFY_EMAIL`) and a working Resend
sender. Monitoring opens persistent incidents for failed/degraded checks and
retries failed administrator alerts after five minutes on later monitoring runs.
Once accepted by the email provider, an incident alert is not resent; that
acceptance does not claim inbox delivery. Read-only dashboard requests send no
alerts. Legacy simulation incidents are not retried as real health alerts.

The monitoring job runs every 15 minutes. Alert on missing monitoring results
from an independent external uptime system as well: a completely stopped
scheduler or unavailable database cannot deliver its own alert. Access to that
external monitor is an operational requirement, not evidence supplied by an API
key. Current unconfigured jobs stay degraded until actually configured and run.

## Validation

`provider-health.test.ts` verifies that credentials/connection reads cannot turn
green, rejects provider errors, checks per-job freshness and persistent alert
retry/deduplication. `cloudflare-scheduler.test.ts` checks recording of success,
HTTP failure and thrown failures while later jobs continue. CI additionally
checks the bundled Worker and the full browser suite.
