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
npx tsc --noEmit -p tsconfig.json
npm run lint
npm run test:unit
npm run build
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

| Variable | Dev if unset | Production (`NODE_ENV=production`) |
| - | - | - |
| `NEXT_PUBLIC_SITE_URL` | falls back to `https://tradecatch.ca` | same |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | analytics doesn't load | same — enable for conversion events |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_NOTIFY_EMAIL` | submissions accepted; emails skipped with a warning | **required** — `/api/book-audit` returns 503 if missing |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | verification skipped with a warning | **required** — `/api/book-audit` returns 503 if missing |
| `LEADS_WEBHOOK_URL` (+ optional `LEADS_WEBHOOK_SECRET`) | CRM forward skipped | recommended — Zapier/Make/n8n/HubSpot webhook |
| `NEXT_PUBLIC_CALENDAR_URL` | no calendar CTA after submit | recommended — Cal.com / Calendly link |
| `ERROR_WEBHOOK_URL` | client/server errors only logged | recommended — Slack/Discord/Better Stack/Sentry webhook |
| `TWILIO_*` / `MISSED_CALL_*` | Module A dry-run SMS + in-memory sandbox | see `src/product/missed-call/README.md` — set `DATABASE_URL`, `MISSED_CALL_DURABLE_STORE=1`, and `MISSED_CALL_OPS_SECRET` (or `CRON_SECRET`) in production |

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
- [ ] Point an uptime monitor at `https://tradecatch.ca/api/health`
- [ ] Set `ERROR_WEBHOOK_URL` (or a Sentry/Better Stack ingest URL)
- [ ] Confirm pricing on `/pricing` matches the current offer
- [ ] Confirm favicon / brand mark looks correct (not a Next.js default)
- [ ] `npm run check:legal` passes (no TODO / draft notices on public legal pages)

**Module A (missed-call) — required before real customer traffic**
- [ ] Durable store enabled (`DATABASE_URL` + `MISSED_CALL_DURABLE_STORE=1`), schema applied, and `/api/health` database check green
- [ ] Full client config from env/JSON (`MISSED_CALL_CLIENT_CONFIG_JSON` or complete `MISSED_CALL_*` vars) — demo fixtures rejected in production
- [ ] Every escalation contact validated (primary, all backups, owner, human-review) — no reserved/555 demo numbers
- [ ] Twilio credentials live; `MISSED_CALL_SMS_MODE` is **not** dry-run in production
- [ ] Twilio Advanced Opt-Out enabled; STOP/ARRET writes durable suppression and blocks new workflows
- [ ] Escalation timers / cron hitting `POST /api/missed-call/escalations/tick` with ops auth
- [ ] Opt-out, duplicate CallSid, overnight schedule, and inactive-tech cases verified in staging
- [ ] Québec legal review of privacy / contracts before claiming compliance (engineering checklist ≠ legal advice)

## Monitoring & backups

- **Uptime:** monitor `GET /api/health` (returns 200 when production-critical config is present).
- **Errors:** page error boundaries POST to `/api/client-error`, which forwards to `ERROR_WEBHOOK_URL`.
- **Leads/workflows:** when the durable flag is enabled, PostgreSQL is the system of record and must be backed up; email and the optional CRM webhook remain delivery channels. The in-memory fallback is for local development only.
- **Site:** rely on git history + your host's deployment rollback. Keep `.env` values in the host secret store (never in git).

## Deployment

1. Push the branch to `origin`.
2. On the host (Vercel or similar), set the environment variables above for **production**.
3. Trigger a build from the deployed branch (`npm run build`).
4. After deploy, load the live URL in a real browser and check DevTools for CSP / console errors.

## Known production limits

- Rate limiting, idempotency keys, and duplicate-submission guards use an in-memory
  `TimedStore` (`src/lib/store.ts`). Behind multiple instances / serverless functions
  the effective rate limit is roughly `limit × instance count`. Swap
  `createMemoryStore` for Upstash Redis / Vercel KV when that matters — call sites
  already go through the shared abstraction.
- CSP still allows `script-src 'unsafe-inline'` for static rendering. Revisit a
  nonce-based CSP if more third-party scripts are added.
- Automated a11y (axe / Lighthouse CI) is not wired yet; the Accessibility Statement
  commits to WCAG 2.1 AA — keep verifying manually until CI coverage lands.

## Rollback

- **Platform with instant rollback (e.g. Vercel):** promote a previous deployment.
- **Manual:** `git revert <bad-commit>` and push, or redeploy a known-good SHA.
  Avoid `git reset --hard` on a shared branch.

## Testing

```bash
npm run check:i18n
npm run test:unit
npm run test:e2e
```

- **Unit:** Zod book-audit schema + rate-limit (`tests/unit/`).
- **E2E:** book-audit API + security headers (`tests/`). Wizard UI, locale switch,
  cookie consent, and marketing pages are still manual / CI build coverage.
