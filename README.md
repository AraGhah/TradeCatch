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
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | analytics doesn't load | same |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_NOTIFY_EMAIL` | submissions accepted; emails skipped with a warning | **required** — `/api/book-audit` returns 503 if missing |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | verification skipped with a warning | **required** — `/api/book-audit` returns 503 if missing |

### Production go-live checklist

- [ ] All Resend + Turnstile vars set in the host's production environment
- [ ] Submit a real book-audit form on the live URL and confirm both the visitor confirmation and the internal notify email arrive
- [ ] Confirm pricing on `/pricing` matches the current offer (Starter $2,500+$750/mo, Growth $4,000+$1,000–$1,500/mo, Premium custom)
- [ ] Confirm favicon / brand mark looks correct (not a Next.js default)

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
