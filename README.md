# TradeCatch

Bilingual English/French software for contractor businesses: missed-call SMS recovery, voice reception, lead and quote management, scheduling, CRM automation, notifications, and billing. Includes the public website, customer workspace, and admin tools.

**Stack:** Next.js 16, React 19, TypeScript, next-intl, Tailwind CSS 4, PostgreSQL, and OpenNext on Cloudflare Workers. Integrations include Twilio, Resend, Stripe, and optional Google and AI services.

## What does it do?

TradeCatch helps contractors capture customer requests while their team is busy, organize the work, and follow up. For example, a missed call can start an SMS conversation that collects the customer's needs and alerts a technician. The business can then track the lead, follow up on a quote, and manage the appointment from its workspace.

## Features

| Feature                     | What it does                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missed-call SMS recovery    | Texts eligible missed callers, collects their request in English or French, and respects opt-outs.                                                                                    |
| Voice receptionist          | Greets callers, asks about their needs, captures contact details, and uses configured transfer or voicemail fallbacks. Supports a rule-based conversation or an optional AI provider. |
| Technician routing          | Sends requests to configured technicians and escalates unanswered alerts. Entitled advanced routing can ring multiple contacts.                                                       |
| Lead management             | Collects website and phone inquiries and organizes them in a business workspace with an activity history and human takeover inbox.                                                    |
| Quote follow-up             | Tracks quotes and schedules follow-ups that stop when the customer replies or the quote is closed.                                                                                    |
| Appointments                | Manages availability, reservations, and reminders. Optional phone booking confirms a reservation only when the scheduling service successfully books it.                              |
| CRM and pipeline            | Tracks opportunities through sales stages and supports configured CRM webhooks with delivery retries.                                                                                 |
| Customer follow-up          | Supports review requests, email automation, customer reactivation, and contract-renewal workflows.                                                                                    |
| Revenue analytics           | Reports recorded revenue and attribution so businesses can assess their pipeline and outcomes.                                                                                        |
| Notifications and Gmail     | Sends configured email/SMS alerts and summaries, and provides a connected, read-only Gmail inbox.                                                                                     |
| Billing and access          | Supports Stripe checkout, subscription synchronization, usage tracking, and plan-based feature access.                                                                                |
| Public site and admin tools | Provides bilingual marketing, audit booking, Help content, demos, and administration of businesses and operational health.                                                            |

Features depend on the business's plan, configuration, and connected providers. Renewal and reactivation jobs require scheduler wiring, and live calendar integration has pilot limits; see the deployment notes and linked guides below.

## Quick start

Use Node.js 22 (the CI version) and npm.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

On macOS/Linux, use `cp .env.example .env.local`. Open **http://localhost:3001**. Stop an existing development server before starting another.

Configure only the integrations you need in `.env.local`. Keep secrets out of Git and `NEXT_PUBLIC_*` variables. See [.env.example](.env.example) for available settings; example phone numbers are for development only.

## Configuration

| Area            | Main settings                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------- |
| Database        | `DATABASE_URL`, `MISSED_CALL_DURABLE_STORE=1`, `SAAS_DURABLE_STORE=1`                             |
| Authentication  | `AUTH_SECRET`, `TRADECATCH_ADMIN_EMAILS`                                                          |
| Email           | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_NOTIFY_EMAIL`                                      |
| Form protection | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`                                          |
| Twilio          | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `MISSED_CALL_PUBLIC_WEBHOOK_BASE`                      |
| Receptionist    | Activated tenant profile or `RECEPTIONIST_CONFIG_JSON`; optional AI provider credentials          |
| Billing         | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`; separate `STRIPE_TEST_*` settings |
| Scheduled jobs  | `MISSED_CALL_OPS_SECRET` or `CRON_SECRET`; route-specific secrets where configured                |

Apply database migrations before enabling durable features:

```bash
npm run db:schema
npm run check:module-a
```

Features also require the correct tenant role, plan, linked client, and provider configuration. A Git merge does not apply migrations or activate a receptionist profile. Production must not enable development login, sandbox, demo-routing, signature-bypass, or dry-run SMS flags.

## Project structure

| Path                          | Contents                                                                |
| ----------------------------- | ----------------------------------------------------------------------- |
| `src/app/`                    | Localized pages and API handlers                                        |
| `src/components/`             | Public, workspace, and admin UI                                         |
| `src/product/`                | Domain services, stores, and SQL schemas                                |
| `src/lib/`                    | Shared authentication, configuration, database, and scheduler utilities |
| `src/i18n/`, `src/messages/`  | English/French routing and translations                                 |
| `scripts/`                    | Migrations, release checks, backups, and maintenance                    |
| `tests/`                      | Unit, integration, QA, and browser tests                                |
| `docs/`                       | Detailed setup, operations, and verification guides                     |
| `worker.ts`, `wrangler.jsonc` | Cloudflare entry point and deployment configuration                     |

## Twilio webhooks

Use HTTP **POST** with your public HTTPS origin and the appropriate path:

| Flow                                 | Incoming call                | Status callback               |
| ------------------------------------ | ---------------------------- | ----------------------------- |
| Voice receptionist                   | `/api/webhooks/twilio/voice` | `/api/webhooks/twilio/status` |
| SMS recovery / technician forwarding | `/api/twilio/voice/inbound`  | `/api/twilio/voice/status`    |

Incoming SMS: `/api/twilio/sms/inbound`. SMS delivery status: `/api/twilio/sms/status`.

Keep signature verification enabled. The voice receptionist needs a matching activated profile; HTTP 200 alone does not prove an AI session started. Without AI credentials, the rule brain can still collect requests. See [Twilio setup and troubleshooting](docs/TWILIO_RECEPTIONIST_SETUP.md).

## Testing

```bash
npm run format:check
npx tsc --noEmit
npm run lint
npm run check:secrets
npm run check:i18n
npm run test:unit
npm run test:qa
npx playwright install chromium
npm run test:e2e
```

Playwright builds its own production server on port **3100**. Some integration tests need isolated PostgreSQL test databases; never point them at production. The [CI workflow](.github/workflows/ci.yml) also checks security, accessibility-related behavior, agent evaluations, and Cloudflare packaging.

## Deployment and operations

```bash
npm run build:cloudflare
npm run check:cloudflare-bundle
npm run check:release
npm run deploy
```

Deploy from a clean checkout matching remote `main`, after CI succeeds for that exact revision. `check:cloudflare-bundle` is a dry run. Use `npm run deploy:staging` for the isolated staging Worker. Do not bypass release checks.

- **Health:** public `/api/health` checks liveness; ops-authenticated requests provide detailed readiness.
- **Jobs:** the Worker runs minute, 15-minute, and daily schedules defined in `src/lib/cloudflare-scheduler.ts`.
- **Scheduling gap:** renewal and reactivation tick endpoints exist but are not yet included in that cron map.
- **Backups:** use `npm run db:backup` and verify recovery with `npm run db:restore-drill`; follow the backup guide first.
- **Recovery:** Worker rollback does not undo database migrations or external provider actions.

## Documentation

| Topic              | Guide                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| SMS recovery       | [Module A](src/product/missed-call/README.md)                                                                                      |
| Voice receptionist | [Module guide](src/product/receptionist/README.md), [profile configuration](docs/AI_RECEPTIONIST_CONFIG.md)                        |
| Phone routing      | [Call management](docs/PHONE_CALL_MANAGEMENT.md)                                                                                   |
| Billing            | [Stripe setup](docs/STRIPE_BILLING.md)                                                                                             |
| CRM                | [Native sales CRM](docs/NATIVE_SALES_CRM.md)                                                                                       |
| Calendar           | [Availability and scheduling](docs/CALENDAR_AVAILABILITY.md)                                                                       |
| Email and inbox    | [Notifications](docs/NOTIFICATION_DELIVERY.md), [Gmail](docs/GMAIL_SETUP.md)                                                       |
| Staging and demos  | [Staging](docs/STAGING_ENVIRONMENT.md), [demo businesses](docs/DEMO_BUSINESSES.md)                                                 |
| Operations         | [Backups](docs/BACKUP_AND_RECOVERY.md), [provider health](docs/PROVIDER_HEALTH.md), [maintenance](docs/MISSED_CALL_MAINTENANCE.md) |
| Security and data  | [Installation approval](docs/INSTALLATION_APPROVAL.md), [account export](docs/ACCOUNT_EXPORT.md)                                   |
| Verification       | [Browser checks](docs/BROWSER_VERIFICATION.md), [live delivery](docs/LIVE_DELIVERY_VERIFICATION.md)                                |

All other runbooks and historical verification records are in [docs/](docs/). Current implementations and tests take precedence over older reports.

Read [AGENTS.md](AGENTS.md) before contributing. Consult the installed Next.js guides in `node_modules/next/dist/docs/` when changing framework behavior.
