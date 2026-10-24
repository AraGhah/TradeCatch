# Monitoring database authentication recovery

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

Run `node scripts/check-worker-database.js` (or add `--staging`) for the same
read-only metadata check. Keep actual credentials in Cloudflare secrets. Do not
depend on a developer `.env.local` fallback, commit a database URL in Wrangler
variables, or disable durable storage to silence authentication errors.

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
