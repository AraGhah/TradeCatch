# TradeCatch

Marketing site — Next.js 16 (App Router), next-intl (en/fr), Tailwind v4.

## Local development

```bash
npm install
npm run dev
```

Open <http://localhost:3000> (or whatever port is printed — it auto-picks the next free one).

## Before every deploy

```bash
npx tsc --noEmit -p tsconfig.json   # type-check
npm run lint                        # eslint
npm run build                       # production build
```

All three must pass with zero errors. `npm run build` alone is not sufficient proof the
site works — it only checks that the code compiles. CSP and hydration bugs only show up
when you actually load the built output in a real browser, which is why the step below
matters:

```bash
rm -rf .next && npm run build
npx next start -p 3000
# then open http://localhost:3000 in a real browser and check the console for errors
```

## Environment variables

Copy `.env.example` to `.env.local` and fill in real values. Nothing in `.env.example`
is a secret — it's committed on purpose as the template. `.env.local` itself is
gitignored and must never be committed.

| Variable | Required for | Behavior if unset |
| - | - | - |
| `NEXT_PUBLIC_SITE_URL` | canonical URLs, sitemap, robots.txt | falls back to `https://tradecatch.ca` |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Google Analytics 4 | analytics script just doesn't load |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_NOTIFY_EMAIL` | audit-request confirmation + internal notification | `/api/book-audit` still accepts submissions and logs them server-side, just skips sending email (see `src/lib/email.ts`) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | bot verification on the audit form | server-side verification is skipped with a warning log (see `src/lib/turnstile.ts`) |

## Deployment

This is a standard Next.js app — deploy it the same way regardless of host:

1. Push the branch to `origin` (`git push origin Ara` or whatever branch you're deploying).
2. On the hosting platform (Vercel or similar), set the environment variables above for
   the production environment.
3. Trigger a build from the deployed branch. The platform runs `npm run build` and
   serves the output — no custom build command needed.
4. After the deploy finishes, load the live URL in a real browser (not just curl) and
   check DevTools console for errors, especially any CSP violations — that class of bug
   passes `npm run build` silently and only shows up at runtime.

## Rollback

If something ships broken:

- **Platform with instant rollback (e.g. Vercel):** use the dashboard's "promote a
  previous deployment" / rollback action — this is the fastest path and needs no git
  operations.
- **Manual rollback:** `git revert <bad-commit>` and push, or redeploy from the last
  known-good commit SHA if the platform supports deploying an arbitrary ref. Avoid
  `git reset --hard` on a shared branch — it rewrites history other people may have
  already pulled.
- Rate limiting, idempotency keys, and duplicate-submission guards in
  `src/app/api/book-audit/route.ts` are in-memory (`Map`), scoped to a single server
  process. A rollback or redeploy resets them — expected, not a bug — but if you ever
  run multiple instances behind a load balancer, that in-memory state stops being
  reliable across instances and would need moving to a shared store (Redis, etc.).

## Testing

```bash
npm run test:e2e
```

Playwright specs live in `tests/`. They currently cover the book-audit API and security
headers. There's no unit-test suite — coverage is build/lint/type-check plus these e2e
specs plus manual browser verification.
