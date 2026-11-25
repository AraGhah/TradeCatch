# Monitoring database authentication recovery

## Database outage — 2026-11-24 (cause not yet confirmed)

**What the alerts show.** Fourteen identical `[TradeCatch CRITICAL] Database is
unavailable` emails, from 2026-11-24 08:32 UTC (03:32 Eastern, `dbdown-1995010`)
to 2026-11-25 02:13 UTC (21:14 Eastern, `dbdown-1995080`). Each came from the
storage-down path of `/api/monitoring/watch`: the monitor could not read its own
heartbeat, so no incident row could exist (hence no First seen / Occurrences /
incident link). No resolution email followed.

**Checked on 2026-11-25 (read-only):**

- The production Worker `tradecatch` has `DATABASE_URL` as an encrypted secret
  (`npm run check:worker-database`).
- The last deployment is 2026-11-22 19:34 UTC (version `6bfe3c2b`, git
  `7b5ac1ac`). There was no deployment and no secret change after it, so no
  release caused the outage, and PR #80 (merged 2026-11-24 20:08 UTC) has never
  been deployed.
- With the secret bound, OpenNext's bundled `.env` fallback is not used for
  `DATABASE_URL` (`process.env[key] ??= bundled` only fills a missing binding).
  The fallback described below explains the 2026-10-24 `28P01`, **not** this
  outage. The cause is most likely on the database side: a credential changed
  in Supabase, the project paused or restarting, the pooler failing, or a
  connection limit. That is unconfirmed.
- Not checked: the database's state today, the Worker logs for 2026-11-24 (the
  Wrangler token has no Workers Observability scope and live tail could not
  connect), and the Supabase project logs (not in the connected organization).

**To confirm the cause:**

1. Cloudflare dashboard → Workers → `tradecatch` → Observability → Logs,
   2026-11-24 08:00 to 2026-11-25 03:00 UTC. Filter on
   `tradecatch.monitoring.stage_failed` with `"stage":"storage"`: its `code` is
   the SQLSTATE or network code (`28P01` = password refused, `ETIMEDOUT` =
   unreachable, `53300` = no connections, `XX000` = pooler error). Also look at
   `tradecatch.cron.route_failed` and `tradecatch.postgres.idle_error`.
2. Supabase dashboard → the TradeCatch project: status (paused?), disk usage,
   and Logs → Postgres and Pooler for the same window. If the database password
   was reset, update the Worker secret as in "For a future `28P01`" below.
3. Admin → System Health. When the database is back, the first monitor run
   records the outage with its real start and sends `[TradeCatch RESOLVED]
   Resolved: Database or monitoring was unavailable`. Its text now names the
   `dbdown-…` range it closes. If that email never comes, the database (or the
   monitor) is still down.

**Fixed in code after this outage:**

- The per-minute and 15-minute schedules ran the monitor *after* six to eight
  database-bound jobs. While the database was down, the emails went out 39 to
  59 seconds after the cron fired, and only 14 of the outage's ~71 fifteen-minute
  windows got one. Monitoring routes now start alongside the other jobs
  (`MONITOR_ROUTES` in `src/lib/cloudflare-scheduler.ts`); those jobs stay
  sequential.
- The emergency email said only "did not answer". It now carries a **Failure
  code** (SQLSTATE, network code, `CONNECT_TIMEOUT`, `QUERY_TIMEOUT` or
  `NOT_CONFIGURED`), a **Likely cause** and the read/write result of the
  monitor's own check. The driver message is never included; it can quote the
  connection string. The 15-minute health probe shows the same code on System
  Health.
- A missing `DATABASE_URL` with durable storage enabled used to switch the
  monitor to an in-memory store and look healthy. It is now reported as a
  database outage (`NOT_CONFIGURED`). This matters once the bundled fallback is
  stripped: a deleted Worker secret has no silent backup any more.

**Before the next deploy (PR #80 strip):** production was built on this machine
with `.env.local` bundled as fallbacks. On 2026-11-25 the following credentials
had a local value but **no Worker binding at all**, so anything production does
with them today runs on the bundled copy, and the strip would remove it:
`BLAND_API_KEY`, `BLAND_CLIENT_SECRET`, `CALCOM_API_KEY`, `ELEVENLABS_API_KEY`,
`GOOGLE_GMAIL_CLIENT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
`MONITORING_SECRET` and `GOOGLE_CALENDAR_WEBHOOK_TOKEN` are bound, but as
plain-text variables. `npm run deploy` now refuses to release until each
stripped credential is an encrypted Worker secret, or is listed in
`RELEASE_ALLOW_UNBOUND_SECRETS` (comma-separated) to confirm that the Worker
does not use it. For a plain-text variable, change its type to Secret in the
dashboard (Settings → Variables and Secrets).

## Confirmed cause and production repair — 2026-10-24 UTC

The active production Worker `tradecatch` had no runtime `DATABASE_URL` binding.
OpenNext's installed adapter compiles `.env*` fallback values into its server
bundle. The deployed fallback targeted the same Supabase database as the local
configuration, but used a different credential. A read-only connection test of
that fallback failed with PostgreSQL `28P01` (invalid password). The local
credential passed `SELECT 1` against the same target.

The verified connection string was supplied through stdin to Wrangler as an
encrypted production `DATABASE_URL` secret. No password was printed, committed,
placed in command arguments, or added to client code. No database password was
reset. Other bindings, application code, routes, and existing previews were not
modified. Cloudflare's secret update created/deployed version
`540619b2-a029-4930-8de2-5d63c50ec067`.

An authenticated `POST /api/monitoring/tick` then returned HTTP 200:
`{"ok":true,"overall":"degraded","checked":9}`. This proves the reported
authentication/write failure recovered, **not** that all services are healthy.
The tick performs normal monitoring writes and may send existing incident alerts;
it does not submit customer leads or reset retry queues.

## Preventing recurrence

The supported release script checks the target Worker's secret metadata before
building and again before uploading/deploying. Missing, plaintext, duplicate, or
unverifiable `DATABASE_URL` secrets block release. Production and staging are
checked independently. The check cannot read a secret value and therefore does
not claim its password is valid; verify connectivity after secret rotation.

After the OpenNext build, `scripts/strip-bundled-env-secrets.js` removes
`DATABASE_URL` and other credential keys from `.open-next/cloudflare/next-env.mjs`
before upload. OpenNext otherwise embeds `.env*` values and applies them with
`process.env[key] ??= bundled` when a Worker binding is missing — that was the
path from a stale local password to production `28P01`. `npm run build:cloudflare`
and `npm run deploy` both run this strip. A remaining database URL with a
password in that module still blocks release, and so does a stripped credential
that is not an encrypted secret on the target Worker (see 2026-11-24 above).

Run `npm run check:worker-database` (or `node scripts/check-worker-database.js`,
optionally with `--staging`) for the same read-only metadata check. Keep actual
credentials in Cloudflare secrets. Do not depend on a developer `.env.local`
fallback, commit a database URL in Wrangler variables, or disable durable storage
to silence authentication errors.

For a future `28P01`:

1. Confirm the exact Worker/environment and active version. Inspect binding names
   and types only; do not paste credentials into chat or incident reports.
2. Validate the intended replacement against the same database with a read-only
   query. Do not guess passwords, switch projects, or use a tenant's database.
3. Set `DATABASE_URL` as an encrypted secret using protected stdin/interactive
   input. A normal `wrangler secret put` deploys a new version immediately;
   use staged version secrets if a separate deployment review is needed.
4. Check an authenticated monitoring tick and the next scheduled run. Investigate
   remaining degraded probes separately; never label them healthy automatically.

Rollback: no schema/data rollback is necessary. Restore a known-good encrypted
database secret if a later rotation fails. Do not roll back to the known-invalid
bundled password. Retain monitoring events and customer records.

## Installation approval rollout remains blocked, enforcement OFF

The same read-only account inventory confirmed:

- `tradecatch.ca` is the enabled custom production domain of `tradecatch`.
- The account subdomain is `ara-ghahramanyan07`; the Worker's `workers.dev` URL
  and version previews are enabled.
- `tradecatch-staging` is absent from the account's Worker list and its settings
  endpoint returns 404. A repository declaration is not an active staging install.
- Existing versions/previews still require an owner-reviewed exact-origin
  inventory. Their existence or the wildcard alone does not establish approval.
- The connected database migration ledger does not contain
  `028_installation_approval`. No migration or grants were applied in this repair.

No local PostgreSQL backup client was available and Docker's daemon was stopped.
Do not bypass the backup/review step or run the full schema runner casually: the
database also lacks other migrations already present in this checkout.

Complete the [installation rollout checklist](INSTALLATION_APPROVAL.md), obtain
a restorable backup, review pending migrations, and reconcile exact authorized
origins before migration/activation. `INSTALLATION_ENFORCEMENT` remains unset/off;
no domains are automatically approved or blocked by this feature.

References: [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/),
[Worker settings API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/get/).
