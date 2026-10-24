# Backup and recovery

Everything TradeCatch keeps lives in one PostgreSQL database (Supabase, reached
through `DATABASE_URL`). The application stores no uploaded files: Gmail
attachments are fetched from Gmail when someone opens them, and call audio stays
with Twilio. So a database backup is a complete backup of the product's own data.

Two things the database cannot restore on its own:

- **`AUTH_SECRET`.** Administrator MFA seeds, Gmail tokens and Calendar tokens are
  sealed with it. A restore with a different value works, but every connected
  mailbox and calendar must be reconnected and every administrator must enroll
  MFA again (`npm run db:reset-admin-mfa`). Keep `AUTH_SECRET` in a secrets
  manager, separate from the backups.
- **Environment variables and Cloudflare configuration.** They are not in the
  database. `.env.example` lists them.

## Layers

| Layer | What it gives you | Who owns it | Verified here |
| --- | --- | --- | --- |
| Supabase managed backups (daily, optional point-in-time recovery) | Fast whole-project recovery | Supabase plan and dashboard | **No.** Check in the dashboard (Database, Backups) that daily backups are on and decide whether the plan needs point-in-time recovery. |
| `npm run db:backup` | A portable, checksummed logical dump you hold yourself | You | Yes, see the drill below |
| `npm run db:restore-drill` | Proof a dump restores into an empty scratch database and matches its source | You | Yes |

A backup that has never been restored is not a backup. Run the drill after taking
a backup, at least monthly, and after any change to the schema.

## Take a backup

Retention policy confirmed October 24, 2026: keep portable backups indefinitely.
There is no automatic expiry or pruning. Keep the dump, checksum, and snapshot
manifest together. This local policy does not change Supabase-managed retention
or establish off-host protection; those require a configured storage destination
and the project's backup settings.

New backups export a repeatable-read PostgreSQL snapshot. Both `pg_dump` and the
verification fingerprint use that snapshot. The `.dump.manifest.json` binds its
schema/content fingerprints to the dump's SHA-256. Restore drills prefer this
manifest, so normal writes after a backup do not create false comparison failures.
Older dumps without a manifest retain the live-source comparison, which can
legitimately differ as production changes. Tables above 200,000 rows are checked
by count only. The fingerprint is integrity evidence, not a digital signature.

```bash
BACKUP_DATABASE_URL='postgresql://…' npm run db:backup -- --out backups
```

- Use the direct connection or the pooler in **session** mode (port 5432).
  Transaction-mode pooling (port 6543) cannot run `pg_dump`.
- The URL is read only from `BACKUP_DATABASE_URL`, never from `DATABASE_URL`, so
  a backup is always a deliberate act.
- It needs `pg_dump` on `PATH`, or Docker (it then runs a throwaway `postgres:17`
  container; override with `PG_DOCKER_IMAGE`, which must be at least as new as the
  server).
- The password travels in environment variables, never on a command line, and is
  never printed.
- Output is `tradecatch-<UTC timestamp>.dump` plus a `.sha256` file, written with
  owner-only permissions. The dump is the `public` schema in PostgreSQL custom
  format, without owners or grants.

The dump contains customer data and sealed credentials. Encrypt it before it
leaves the machine (for example `age` or `gpg`), store it off the host, and never
commit it (`/backups/`, `*.dump` are in `.gitignore`).

Schedule it from a trusted host or scheduler that holds `BACKUP_DATABASE_URL` as a
secret. Pick the frequency from how much recent data you can afford to redo; that
is a business decision, not something this repository can set.

## Prove it restores (the drill)

Create an **empty** database that is not production: a local container, or a
separate throwaway Supabase project.

```bash
docker run -d --name tc-drill -e POSTGRES_PASSWORD=drill -p 55432:5432 postgres:17
docker exec tc-drill psql -U postgres -c 'create database tc_restore_drill'

RESTORE_TEST_DATABASE_URL='postgres://postgres:drill@localhost:55432/tc_restore_drill' \
BACKUP_DATABASE_URL='postgresql://…source…' \
  npm run db:restore-drill -- --dump backups/tradecatch-<stamp>.dump
```

The drill checks, in order, and stops at the first failure:

1. The dump matches its recorded checksum.
2. The target is not the live database (`DATABASE_URL`) or the source, its name
   contains `restore`, `drill`, `scratch`, `test`, `tmp` or `sandbox`, and it has
   no tables. Otherwise it refuses and exits with status 2 without connecting
   further. `--allow-any-database-name` relaxes only the name rule.
3. The restore runs in a single transaction, so a failure leaves the target empty.
4. The tables `/api/health` requires exist and migrations are recorded.
5. When the source is given: the schema (columns, indexes, constraints, row-level
   security flags) and every table's row count and content hash equal the source.
   Tables over 200,000 rows are compared by count only.

Drop the scratch database afterwards.

## Recover for real

Never restore over the live database. Restore into a new database, check it, then
switch the application over.

1. Create a new Supabase project (or branch) and note its session-mode URL.
2. Restore with the drill's method rather than a bare `pg_restore`: the dump
   carries `CREATE SCHEMA public`, which fails on every new database, and the
   drill removes exactly that entry and nothing else. Run the drill against the
   new database with `--allow-any-database-name` only if its name cannot be
   changed, and read the output.
3. Apply the Data API lockdown, because grants are not in the dump:
   `npm run db:lockdown` to review, then with `-- --apply`.
4. Apply any migrations newer than the backup: `npm run db:schema`.
5. Set the new `DATABASE_URL` secret, with the **same** `AUTH_SECRET`, and deploy.
6. Check `GET /api/health` with the operations bearer token. In `checks`,
   `database`, `schemaOk` and `productionSafety.ok` must be true, and
   `securityWarnings` should be empty.
7. If the backup may have been exposed, rotate `AUTH_SECRET` (everyone signs in
   again), the database password, and the OAuth and webhook secrets.

## Drill record

Run on 2026-10-19 against a throwaway PostgreSQL 17 container, never against
production. The source was a copy of the application schema with test data.

| Check | Result |
| --- | --- |
| Backup | 318,285 bytes, checksum recorded |
| Restore | 107 tables, completed in 3.4 s |
| Compare with source | 107 tables, 20,036 rows, schema and content hashes identical |
| Read through the application's own store | organization and user rows returned |
| Target already has tables | refused, exit 2 |
| Target is the source, or equals `DATABASE_URL` | refused, exit 2 |
| Target database named `production` | refused, exit 2 |
| Dump altered after it was written | refused (checksum), exit 1 |
| Truncated dump | restore failed, target left with 0 tables |
| Source changed after the backup | reported: row count 20008 vs 20007, exit 1 |

Not measured: the size and restore time of the real production database, and the
state of Supabase's own backups. Both need to be checked by someone with access.
