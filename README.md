# TradeCatch

Marketing site — Next.js 16 (App Router), next-intl (en/fr), Tailwind v4.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in values as needed for local email/Turnstile
npm run dev
```

Open <http://localhost:3000> (or whatever port is printed — it auto-picks the next free one).

## Before every deploy

```bash
npm run check:i18n             # en/fr message key parity
npm run check:legal            # no draft/TODO notices on public legal pages
npm run check:media            # tracked demo-media budget and asset policy
npm run format:check
npm run cf-typecheck           # generated Cloudflare runtime types are current
npx tsc --noEmit -p tsconfig.json
npm run lint
npm run test:unit
npm run build
npm run build:cloudflare      # generate the real OpenNext Worker artifact
npm run check:cloudflare-bundle # bundle worker.ts without deploying
npm run test:e2e               # needs Playwright browsers installed once
```

CI (`.github/workflows/ci.yml`) runs the same checks on push/PR to `main` and `Ara`.

`npm run build` alone is not sufficient — CSP and hydration bugs only show up when you
load the built output in a real browser:

```bash
rm -rf .next && npm run build
npx next start -p 3000
# then open http://localhost:3000 and check the console
```

## Environment variables

Copy `.env.example` to `.env.local` and fill in real values. Nothing in `.env.example`
is a secret — it's committed on purpose as the template. `.env.local` itself is
gitignored and must never be committed.

| Variable                                                     | Dev if unset                                        | Production (`NODE_ENV=production`)                                                                                                                         |
| ------------------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`                                       | falls back to `https://tradecatch.ca`               | same                                                                                                                                                       |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID`                              | analytics doesn't load                              | same — enable for conversion events                                                                                                                        |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_NOTIFY_EMAIL` | submissions accepted; emails skipped with a warning | strongly recommended — submissions remain accepted, but no confirmation or internal notification email is sent                                             |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`     | verification skipped with a warning                 | strongly recommended before public traffic; missing keys do not reject the request. Never commit real keys; rotate them if exposed                         |
| `AUTH_SECRET`                                                | required for `/app` session cookies                 | **required** for SaaS portal — falls back to `MISSED_CALL_OPS_SECRET` if unset                                                                             |
| `SAAS_DEV_LOGIN`                                             | unset                                               | set `1` locally to return a clickable magic-link token when Resend is unavailable                                                                          |
| `LEADS_WEBHOOK_URL` (+ optional `LEADS_WEBHOOK_SECRET`)      | CRM forward skipped                                 | recommended — Zapier/Make/n8n/HubSpot webhook                                                                                                              |
| `NEXT_PUBLIC_CALENDAR_URL`                                   | no calendar CTA after submit                        | recommended — Cal.com / Calendly link                                                                                                                      |
| `ERROR_WEBHOOK_URL`                                          | client/server errors only logged                    | recommended — Slack/Discord/Better Stack/Sentry webhook                                                                                                    |
| `CF_TRUSTED`                                                 | Cloudflare IP header ignored                        | **required on Cloudflare** — set `1` only when the origin is reachable exclusively through Cloudflare                                                      |
| `TWILIO_*` / `MISSED_CALL_*`                                 | Module A dry-run SMS + in-memory sandbox            | see `src/product/missed-call/README.md` — set `DATABASE_URL`, `MISSED_CALL_DURABLE_STORE=1`, and `MISSED_CALL_OPS_SECRET` (or `CRON_SECRET`) in production |

## Module A — Missed-call recovery

Core product path (call → SMS → collect → tech accept → notify). Domain code: `src/product/missed-call/`. Docs and Twilio setup: that folder’s README. Local dry-run without Twilio: `POST /api/missed-call/sandbox`.

### Production go-live checklist

**Site**

- [ ] All Resend + Turnstile vars set in the host's production environment
- [ ] Set `MISSED_CALL_OPS_SECRET` (or `CRON_SECRET`) for Module A leads / escalations APIs
- [ ] Submit a real book-audit form on the live URL and confirm both the visitor confirmation and the internal notify email arrive
- [ ] Point `LEADS_WEBHOOK_URL` at your CRM/automation and confirm a test lead lands
- [ ] Set `NEXT_PUBLIC_CALENDAR_URL` and confirm the post-submit booking CTA appears
- [ ] Set `NEXT_PUBLIC_GA_MEASUREMENT_ID` and mark `generate_lead` as a GA4 conversion
- [ ] Point an uptime monitor at `https://tradecatch.ca/api/health`; require
      `x-tradecatch-live: 1` (the public production response is liveness-only
      and does not query the database)
- [ ] Set `ERROR_WEBHOOK_URL` (or a Sentry/Better Stack ingest URL)
- [ ] Set `CF_TRUSTED=1` on Cloudflare so real visitors do not share one rate-limit bucket
- [ ] Confirm pricing on `/pricing` matches the current offer
- [ ] Confirm favicon / brand mark looks correct (not a Next.js default)
- [ ] `npm run check:legal` passes (no TODO / draft notices on public legal pages)

**Module A (missed-call) — required before real customer traffic**

- [ ] Durable store enabled (`DATABASE_URL` + `MISSED_CALL_DURABLE_STORE=1`), all migrations through `005_crm_webhook_dlq` applied, and the ops-authenticated `/api/health` response has `moduleA.ready=true`, `checks.clientRouting=true`, `checks.diagnosticsComplete=true`, `checks.schemaOk=true`, `checks.escalationsFresh=true`, and a sane queue
- [ ] Full client config from env/JSON (`MISSED_CALL_CLIENT_CONFIG_JSON` or complete `MISSED_CALL_*` vars) — demo fixtures rejected in production
- [ ] Every escalation contact validated (primary, all backups, owner, human-review) — no reserved/555 demo numbers
- [ ] Twilio credentials live; `MISSED_CALL_SMS_MODE` is **not** dry-run in production
- [ ] Twilio Advanced Opt-Out enabled in Console on the number / Messaging Service; STOP/ARRET writes durable local suppression (`provider_status=local_only` until a real provider sync API exists) and blocks new workflows
- [ ] Cloudflare deployed all three `wrangler.jsonc` cron triggers; verify escalation, quote/Growth jobs, and retention ticks in Worker logs
- [ ] Opt-out, duplicate CallSid, overnight schedule, and inactive-tech cases verified in staging
- [ ] Québec legal review of privacy / contracts before claiming compliance (engineering checklist ≠ legal advice)
- [ ] (Recommended multi-instance) `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` set so book-audit rate-limit and idempotency are shared across serverless instances

### SaaS portal (founder-gated pilot — Voie A sales motion)

- Primary acquisition remains **Book a free audit** (founder-led).
- Magic-link login: `/login` (FR `/connexion`) for contractors already in a pilot.
- Workspace: `/app` after the founder links `missedCallClientId` (`POST /api/missed-call/ops/link-organization`).
- Entitlements: `src/product/saas/entitlements.ts` — enforced on `/api/app/*`.
- Apply schemas: `npm run db:schema` · readiness: `npm run check:module-a`
- Set `AUTH_SECRET` (and optionally `SAAS_DEV_LOGIN=1` for local sign-in without email)

## Monitoring & backups

- **Liveness:** monitor unauthenticated `GET /api/health`; in production, require
  `status=live` and `x-tradecatch-live: 1`. This only proves that the Worker can
  serve the route and intentionally skips database probes.
- **Readiness:** call `GET /api/health` with the ops bearer token and require HTTP 200 plus `moduleA.ready=true`; this authenticated view validates client routing, database/schema access, queue state, and cron freshness.
  A supplied invalid bearer returns HTTP 401; it is never downgraded to the
  public liveness response.
- **Errors:** page error boundaries POST to `/api/client-error`, which forwards to `ERROR_WEBHOOK_URL`.
- **Leads/workflows:** when the durable flag is enabled, PostgreSQL is the system of record and must be backed up; email and the optional CRM webhook remain delivery channels. The in-memory fallback is for local development only.
- **Site:** rely on git history + your host's deployment rollback. Keep `.env` values in the host secret store (never in git).

## Deployment

The production target is OpenNext on Cloudflare Workers. `worker.ts` delegates web
requests to OpenNext and runs the internal pilot jobs from the cron triggers declared
in `wrangler.jsonc`.

1. Set all production variables and secrets in Cloudflare; at minimum the scheduler
   needs `MISSED_CALL_OPS_SECRET` (or `CRON_SECRET`), and request-aware rate limiting
   needs `CF_TRUSTED=1`. `wrangler.jsonc` uses `keep_vars: true` so a deploy does not
   erase dashboard-managed plaintext values during the founder-led pilot.
2. Apply the database schema with `npm run db:schema`, then run
   `npm run check:module-a` in an environment containing the production values.
3. Run `npm run cf-typegen` whenever Worker bindings change and commit the generated
   `worker-configuration.d.ts`.
4. Run the complete pre-deploy checks above, then `npm run deploy`.
5. Confirm `/api/health`, all three cron triggers, Twilio webhooks, and the real
   missed-call flow in staging before routing client traffic.

The demo-day sequence and fallback plan are in
[`docs/FIRST_DEMO_RUNBOOK.md`](docs/FIRST_DEMO_RUNBOOK.md).

## Known production limits

- Rate limiting and short-window idempotency keys use in-memory state by default
  (`src/lib/rate-limit.ts`, `src/lib/store.ts`). Behind multiple instances /
  serverless functions the effective limit is roughly `limit × instance count`.
  Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to share counters
  and idempotency claims across instances (see `src/lib/upstash.ts`).
- CSP still allows `script-src 'unsafe-inline'` for static rendering. Revisit a
  nonce-based CSP if more third-party scripts are added.
- Automated checks cannot prove WCAG 2.1 AA by themselves. Keep keyboard, screen
  reader, zoom/reflow, contrast, and reduced-motion checks in the manual demo gate.

## Rollback

- **Cloudflare:** roll back to a previously known-good Worker version in the
  dashboard, then verify health and cron logs.
- **Manual:** `git revert <bad-commit>` and push, or redeploy a known-good SHA.
  Avoid `git reset --hard` on a shared branch.

## Testing

```bash
npm run check:i18n
npm run test:unit
npm run test:e2e
```

- **Unit:** Zod book-audit schema + rate-limit (`tests/unit/`).
- **E2E:** book-audit API and full wizard, security headers, automated WCAG A/AA
  scans, route matrix, cookie persistence, locale switching, demo assets/modal,
  and founder-gated pilot sign-in (`tests/`).
