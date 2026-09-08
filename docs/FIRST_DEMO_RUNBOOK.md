# First demo runbook

Use this as the go/no-go checklist for the first founder-led TradeCatch demo. The
demo should prove the controlled pilot path without presenting illustrative screens
or provider integrations as production features.

## What the demo may claim

- Missed-call text-back, bilingual intake, urgency/service-area flagging,
  technician alerts, escalation, and customer notification are controlled-pilot
  capabilities once Twilio and durable storage are configured.
- Website lead capture and scheduled quote follow-up are Starter pilot modules for
  a linked organization. Quote follow-up stops on reply, opt-out, won/lost, or
  human takeover.
- In-app booking/reminders, pipeline, revenue attribution, reviews, and activity
  timeline are Growth pilot modules for an entitled linked organization.
- Every sample metric and marketing dashboard is illustrative and is not a promise
  of results.
- TradeCatch is founder-installed and pilot-gated. Native Google/Outlook calendar
  sync, native two-way CRM sync, billing, and self-serve SaaS onboarding are not in
  this demo.

The canonical status source is [`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md).

## Repository preflight

Run from a clean install using the same commit that will be deployed:

```powershell
npm.cmd ci
npm.cmd run check:i18n
npm.cmd run check:legal
npm.cmd run check:media
npm.cmd run check:dev-audit
npm.cmd run check:brace-expansion
npm.cmd run format:check
npm.cmd run cf-typecheck
npx.cmd tsc --noEmit -p tsconfig.json
npm.cmd run lint
npm.cmd run test:unit
npm.cmd audit --omit=dev --audit-level=high
npm.cmd run build
npm.cmd run build:cloudflare
npm.cmd run check:cloudflare-bundle
npm.cmd run test:e2e
```

One PostgreSQL integration test is skipped unless `TEST_DATABASE_URL` is supplied.
Run it against a disposable database before real client traffic.

## Provider and data preflight

These require the founder's accounts or decisions and cannot be completed from the
repository alone:

- Add the real Cloudflare Worker variables/secrets, including `CF_TRUSTED=1` only
  after confirming the public origin is reachable exclusively through Cloudflare.
  Never copy `.env.local` into git.
- Provision PostgreSQL, apply `npm run db:schema`, confirm backups, and run
  `npm run check:module-a` with the deployment values available.
- Configure the real Twilio number and all three webhook families: voice status,
  inbound SMS, and SMS status. Enable Advanced Opt-Out.
- Replace every demo/555 contact with verified contractor, technician, backup,
  owner, and human-review numbers.
- Create the founder-gated pilot organization, link its missed-call client, assign
  the intended Starter/Growth plan, and complete onboarding settings.
- Configure Resend, Turnstile, error monitoring, analytics, calendar CTA, and any
  outbound CRM webhook that will be shown.
- Complete Quebec legal review of public policies and client contracts, and resolve
  the TradeCatch name/domain clearance question before relying on the brand.

## Cloudflare verification

The repository declares three schedules:

| Schedule (UTC)   | Internal work                                              |
| ---------------- | ---------------------------------------------------------- |
| Every minute     | Missed-call escalation and outbound-queue tick             |
| Every 15 minutes | Quote follow-up, booking reminders, reviews, CRM retry/DLQ |
| Daily at 06:15   | Retention soft-delete tick                                 |

After deployment, confirm the triggers exist in Cloudflare and inspect Worker logs
for `tradecatch.cron.completed`. A failed route is reported as
`tradecatch.cron.failed`; later routes on the same schedule are still attempted.
The unauthenticated production `/api/health` response is liveness-only, uses the
`tradecatch-live`/`x-tradecatch-live: 1` markers, and does not query PostgreSQL.
An invalid supplied bearer returns 401 instead of falling back to liveness. With
ops bearer authentication, verify the readiness view
reports `moduleA.ready=true`, `checks.clientRouting=true`,
`checks.diagnosticsComplete=true`, `checks.schemaOk=true`,
`checks.escalationsFresh=true`, and no excessive queued, retrying, or
stale-sending messages. The schema check requires every migration through
`005_crm_webhook_dlq`. For the audit-form portion of the demo, also verify
`checks.resend=true` and `checks.turnstile=true`; these optional integrations do
not make the service's liveness probe fail by themselves.

## Rehearsal sequence

1. Open the live English and French home pages. Reject non-essential cookies once,
   switch locales, and confirm the choice and locale persist.
2. Submit one book-audit request and confirm the visitor email, internal email,
   optional CRM/webhook delivery, and calendar CTA.
3. Play the locale-matched demo video with captions, open its transcript, and state
   the pilot/illustrative qualification before showing the workspace.
4. Sign in through a real emailed magic link and verify the correct organization and
   plan. Never enable `SAAS_DEV_LOGIN` in the public production deployment.
5. Call the staged Twilio number from a fresh non-team mobile number, let the call
   become a genuine missed call, and confirm the immediate bilingual SMS.
6. Complete the intake, including a service-area or urgency example. Confirm the
   technician job card contains no diagnosis or invented arrival time.
7. Reply `ACCEPTER` from the currently alerted technician. Confirm the caller gets
   the acceptance notification and the linked workspace shows only that
   organization's data.
8. If demonstrating Starter/Growth modules, use the pre-seeded entitled pilot org
   and explicitly identify sample amounts as illustrative.

Use a fresh caller number or clear only the staged test record through an approved
ops process between rehearsals. Do not delete or reset production data for a demo.

## Fallbacks and go/no-go

- Keep the local English and French MP4 files under `public/demo-video/` available
  if Twilio or another provider is degraded.
- Keep screenshots free of customer PII and do not improvise real names, reviews,
  revenue, or response-time claims.
- Do not run the live-call portion if health is degraded, storage is in-memory,
  Twilio is dry-run, any contact is a demo number, the pilot org is unlinked, or the
  escalation schedule has not been observed.
- A provider failure may fall back to the recorded walkthrough. A data-isolation,
  consent, authentication, or wrong-recipient failure is a hard no-go.
