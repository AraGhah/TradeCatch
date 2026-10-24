# TC-038 — live notification acceptance record

Status: **blocked / not accepted**. Checked 2026-10-23 (America/Toronto).
No real test email, SMS, or Google event was sent or created in this session.
Mocked provider tests and the UI's simulated test action are not delivery proof.

## Authorized scope

The owner approved one controlled email in staging and one in production to the
recipient supplied privately in this chat. Keep that address out of source and
public reports. No SMS number was supplied: leave SMS untested, with no invented
number. No dedicated Google test calendar or OAuth session was supplied.
Use a dedicated operator-owned test business, never an unrelated customer tenant.

## Read-only findings

| Environment | Evidence                                                                                                                                              | Missing evidence / access                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production  | `tradecatch.ca/api/health` answered HTTP 200. Wrangler listed the `tradecatch` Worker's email-provider and retry secret names.                        | No local Resend API key, authenticated test-business session, or usable operations/retry credential. Secret-name presence does not prove validity or delivery.  |
| Staging     | The configured `tradecatch-staging` Worker was not found by `wrangler secret list --env staging`; `staging.tradecatch.ca/api/health` was unreachable. | Confirm the intended account, Worker and URL, then establish an isolated staging business and provider configuration. Do not substitute production for staging. |

The ignored local environment contains a database URL, but this alone neither
identifies an authorized test tenant nor permits arbitrary production writes.
No production database rows, notification statuses, queues, or provider settings
were changed. No secret values were printed or added to source.

A subsequent read-only public browser run also encountered Cloudflare Error
1102, "Worker exceeded resource limits", at 2026-10-24 01:05:12 UTC (Ray ID
`a4f51267bbbf4294`). This is an additional operational prerequisite: investigate
the matching deployment/runtime logs and establish stable availability before
live notification acceptance. A single earlier healthy response does not prove
continued production health. No limits, cache settings or deployment were changed.

`POST /api/businesses/[id]/notifications/test` deliberately enqueues
`simulated: true, live: false`. Do not weaken that safety contract or cite its
result as live delivery. `/api/notifications/tick` processes the shared due queue;
do not invoke it as an isolated test or replay all historical pending jobs.

## Completion procedure (each environment separately)

1. Confirm the exact deployment, server-side database/provider configuration,
   and authorized operator identity. Use secret storage, never chat or browser
   client code. Arrange access to provider logs without exposing customer data.
2. Select or provision a dedicated fictional test business under an approved
   operator account. Record its organization ID privately and verify its members,
   recipients, email entitlement, timezone, quiet hours and notification language.
   Disable SMS and escalation to other recipients for this test. Obtain approval
   for any new test-account/database writes and their cleanup plan first.
3. Record a unique test correlation/idempotency key and baseline database state.
   Trigger exactly one normal live business event directed only to the approved
   test email. A magic-link login email is not a substitute for the notification
   outbox path. Do not create a general unauthenticated live-send endpoint.
4. Inspect only that organization's matching event/outbox/attempt rows. Capture
   queue time, recipient, locale, attempts, provider acceptance and final status.
   Redact personal data in reports. A boolean send result is not receipt proof.
5. Match the recipient, UTC timestamp, subject and provider message ID in Resend
   logs. Confirm delivered/bounced/failed status. Ask the owner to confirm actual
   inbox or spam-folder receipt and language. Record acceptance and receipt
   separately; never mark successful delivery manually to satisfy this test.
6. Verify duplicate triggering with the same key does not send a second message.
   Exercise controlled failure/retry only in isolated staging with a scoped worker
   or existing safe operator workflow, not by breaking production credentials or
   draining a shared queue. Check existing retry timing and monitoring remain.
7. When an approved phone exists, repeat with Twilio and match its message SID,
   status and handset receipt. When an approved Google pilot/test calendar exists,
   verify calendar create/reschedule/cancel and match event IDs and actual calendar
   state. These are currently **not run**, not passed or implied by email tests.
8. Preserve the audit evidence. Restore only documented test-business settings;
   retain legitimate lead and delivery history. Any destructive cleanup needs an
   explicit, reviewed migration/rollback plan. No schema migration is required
   merely to execute this acceptance checklist.

## Acceptance ledger

| Check                                     | Staging                      | Production                   |
| ----------------------------------------- | ---------------------------- | ---------------------------- |
| Controlled live email submitted           | Not run                      | Not run                      |
| Database event and provider ID correlated | Not run                      | Not run                      |
| Provider delivery confirmed               | Not run                      | Not run                      |
| Recipient receipt confirmed               | Not run                      | Not run                      |
| Live SMS / Google calendar                | Not run; no test destination | Not run; no test destination |

Close TC-038 only after evidence is recorded for the approved channels and any
remaining channel limitations are explicitly accepted by the owner.
