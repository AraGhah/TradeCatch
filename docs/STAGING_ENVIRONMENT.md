# TradeCatch staging / demo environment

Isolated stack for feature testing with fictional businesses, simulated calls,
and dry-run SMS. It must never share a database, Twilio number, or ops secret
with production.

## Architecture

| Layer | Production | Staging |
| --- | --- | --- |
| Cloudflare Worker | `tradecatch` | `tradecatch-staging` (`wrangler.jsonc` → `env.staging`) |
| Site URL | `https://tradecatch.ca` | dedicated staging hostname (e.g. `https://staging.tradecatch.ca`) |
| Postgres | production `DATABASE_URL` | **separate** staging database |
| Twilio | live customer numbers | none (dry-run) **or** a dedicated sandbox number |
| SMS | live | `MISSED_CALL_SMS_MODE=dry-run` (default on staging) |
| Sandbox APIs | disabled | enabled (`/api/missed-call/sandbox`, `/api/receptionist/sandbox`) |
| UI | no banner | sticky **Demo Mode** banner |
| Indexing | allowed | `robots.txt` disallows all |

## One-time setup (founder)

These steps require Cloudflare / Postgres / DNS access. They are **not** run
from this agent and must not use production credentials.

1. **Create a staging Postgres database** (Neon, Supabase, or equivalent).
2. Apply schema against the staging URL only:
   ```bash
   TRADECATCH_ENV=staging DATABASE_URL='postgres://…staging…' npm run db:schema
   TRADECATCH_ENV=staging DATABASE_URL='postgres://…staging…' MISSED_CALL_DURABLE_STORE=1 npm run db:seed:staging
   ```
3. **Create the staging Worker secrets** (never commit values):
   ```bash
   wrangler secret put DATABASE_URL --env staging
   wrangler secret put MISSED_CALL_OPS_SECRET --env staging
   wrangler secret put AUTH_SECRET --env staging
   wrangler secret put STAGING_BASIC_AUTH_USER --env staging
   wrangler secret put STAGING_BASIC_AUTH_PASSWORD --env staging
   # Stripe test-mode only on staging (never sk_live_ here):
   wrangler secret put STRIPE_SECRET_KEY --env staging
   wrangler secret put STRIPE_WEBHOOK_SECRET --env staging
   # Also set STRIPE_PRICE_*_MONTHLY/ANNUAL + NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
   # Optional: staging-only Resend / Turnstile test keys
   ```
4. **Set plaintext staging vars** in the Cloudflare dashboard for
   `tradecatch-staging` (or rely on `wrangler.jsonc` `env.staging.vars`):
   - `NEXT_PUBLIC_SITE_URL=https://staging.….`
   - `MISSED_CALL_PUBLIC_WEBHOOK_BASE` (same origin)
   - Leave production `TWILIO_*` unset, or use a **staging-only** Twilio account
5. **Restrict access**
   - Preferred: Cloudflare Access policy on the staging hostname (email allowlist).
   - Fallback: `STAGING_BASIC_AUTH_USER` + `STAGING_BASIC_AUTH_PASSWORD` (in-app Basic gate).
6. **Deploy**
   ```bash
   npm run deploy:staging
   ```
7. **Custom domain** — attach the staging hostname to Worker `tradecatch-staging`
   in the Cloudflare dashboard (do not point production DNS at staging).

## Runtime flags (staging profile)

| Variable | Staging value | Why |
| --- | --- | --- |
| `TRADECATCH_ENV` | `staging` | Isolates safety checks from live production |
| `NEXT_PUBLIC_TRADECATCH_ENV` | `staging` | Client-visible environment |
| `NEXT_PUBLIC_DEMO_MODE` | `1` | Forces Demo Mode banner + noindex |
| `MISSED_CALL_SANDBOX` | `1` | Enables simulated call/SMS APIs |
| `MISSED_CALL_ALLOW_DEMO` | `1` | Allows demo client fixtures |
| `MISSED_CALL_SMS_MODE` | `dry-run` | No real customer SMS |
| `MISSED_CALL_DURABLE_STORE` | `1` | Staging uses its own Postgres |
| `DATABASE_URL` | staging only | Hard isolation from production data |
| `MISSED_CALL_OPS_SECRET` | staging-only | Ops / sandbox / reset auth |
| `STAGING_BASIC_AUTH_*` | set | Restricts dashboard access |

**Never** set the staging profile flags on the live `tradecatch` Worker.

## Simulated missed-call workflow

With staging deployed and ops secret configured:

```bash
# 1. Simulate a missed call (no Twilio, no real customer)
curl -sS -X POST "$STAGING_URL/api/missed-call/sandbox" \
  -H "Authorization: Bearer $STAGING_OPS_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"call","callerE164":"+15145550111","answered":false,"abandoned":true}'

# 2. Simulate the fictional customer SMS reply
curl -sS -X POST "$STAGING_URL/api/missed-call/sandbox" \
  -H "Authorization: Bearer $STAGING_OPS_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"sms","fromE164":"+15145550111","body":"Fuite sous l évier, Laval H7A"}'
```

Outbound SMS is logged as dry-run (`SM_dry_*`). Production Postgres and
production Twilio are not touched.

## Reset demo data

Authorized operators can wipe staging tables and re-seed the demo client:

```bash
curl -sS -X POST "$STAGING_URL/api/ops/demo/reset" \
  -H "Authorization: Bearer $STAGING_OPS_SECRET" \
  -H "X-Ops-Actor: ara@tradecatch.ca" \
  -H "Content-Type: application/json" \
  -d '{"confirm":"RESET_DEMO_DATA"}'
```

This endpoint returns **404** on real production (`TRADECATCH_ENV=production`).

## Verification checklist

- [ ] Staging hostname requires Cloudflare Access or HTTP Basic
- [ ] `GET /api/health` (ops auth) reports `"environment":"staging"` and `"demoMode":true`
- [ ] Staging `DATABASE_URL` is a different database than production
- [ ] `MISSED_CALL_SMS_MODE=dry-run` (or staging-only Twilio — never production numbers)
- [ ] Sticky **Demo Mode** banner visible on marketing and `/app`
- [ ] Sandbox call creates a lead only in the staging database
- [ ] `POST /api/ops/demo/reset` restores the demo client without affecting production

## Local simulation (without deploying)

```bash
cp .env.example .env.local
# Set TRADECATCH_ENV=staging, NEXT_PUBLIC_DEMO_MODE=1, MISSED_CALL_SANDBOX=1,
# MISSED_CALL_SMS_MODE=dry-run, and a disposable DATABASE_URL if testing durable store.
npm run dev
```

Open the site — the Demo Mode banner should appear. Drive flows via the sandbox
APIs with the local ops secret.
