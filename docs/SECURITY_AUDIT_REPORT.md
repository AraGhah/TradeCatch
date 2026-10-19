# TradeCatch security audit and hardening report

Date: 2026-10-19. Branch `Ara`, working tree (nothing committed, nothing deployed).

How to read this: each area has a status.

- **PASS**: checked, nothing to fix, with the evidence named.
- **FIXED**: a weakness was found and corrected in code or tooling, and a test or run proves it.
- **FAILED**: checked and still not acceptable. None at the end of this pass.
- **NOT VERIFIED**: cannot be confirmed from this repository or this machine. Each one says who can confirm it.

There is no overall score. A number would hide the items that need a person to act.

Production was never touched. No migration was run, no credential changed, no
backup or restore was pointed at the live database. Database work ran in
throwaway PostgreSQL 17 containers.

## What matters most

1. **Critical, fixed: administrator MFA could be bypassed.** Anyone holding an
   administrator session without a second factor could enroll or replace MFA, or
   switch it off, and so reach platform-administrator power. MFA is now mandatory
   and cannot be re-enrolled or disabled by a session holder.
2. **Critical if exposed, fixed as a tool, not applied: Supabase Data API.** On a
   Supabase project the `anon` and `authenticated` roles can read and write every
   table that has no row-level security. A guarded script closes this. Whether the
   live project is exposed is **NOT VERIFIED**; the script has not been run there.
3. **High, fixed: rate limits were per server instance.** They now share one
   counter through Postgres (or Upstash), with exact-limit behavior proven under
   concurrency on real Postgres.
4. **Medium, fixed:** viewers and members could do things only owners and admins
   should (create API keys, change phone, fallback, scheduling and notification
   settings, write CRM data); server-side requests to user-supplied URLs could
   reach internal addresses; internal error text reached API clients; public
   endpoints read unbounded request bodies.

## Needs your decision before production

| Change | Effect on people | Why it waits for approval |
| --- | --- | --- |
| Mandatory administrator MFA | Every platform administrator must enroll a TOTP app on first sign-in after deploy. Locked-out admins are reset by an operator with `npm run db:reset-admin-mfa`. | Changes authentication |
| `npm run db:lockdown -- --apply` | None for the app (it uses the owner role). Blocks `anon` and `authenticated` from every table. | Changes production data access; run the report mode first |
| New table `tc_rate_limits` (applied by `npm run db:schema`) | None | Schema change |
| Members lose API-key creation and settings writes; viewers lose lead and CRM writes | Some existing users lose actions they could take | Changes permissions. Members can still edit email automation, which is a product choice to confirm. |
| Set `CF_TRUSTED=1` once the origin is reachable only through Cloudflare | Per-visitor rate limits start to work | Wrong if the origin is publicly reachable |

## Findings by area

Numbers follow the sections of the audit brief. Sections 2, 7, 11, 12, 13 and 21 needed no code change (they passed as found), so they have no commit of their own; every other section is one commit in `git log`.

### 1. Database backup and restoration

- **Status: FIXED** (tooling, runbook, executed drill). Supabase's own backups: **NOT VERIFIED**.
- **Issue (High):** no tested path from a failure back to a working database.
- **Changes:** `scripts/db-backup.js`, `scripts/db-restore-drill.js`, `scripts/lib/pg-cli.js`, `docs/BACKUP_AND_RECOVERY.md`, npm scripts `db:backup` and `db:restore-drill`, ignore rules for dumps.
- **Evidence:** restore into an empty scratch database matched the source on 107 tables and 20,036 rows by schema and content hash; the drill refuses the live database, the source, a non-empty target and a target not named as disposable; it rejects an altered dump, fails cleanly on a truncated one and reports source drift. Details in `docs/BACKUP_AND_RECOVERY.md`. Tests: `tests/unit/restore-drill-guards.test.ts`.
- **Remaining:** whether Supabase daily backups and point-in-time recovery are on; where dumps are stored (encrypted, off the host) and how often; production size and restore time.
- **Next:** check the Supabase dashboard; schedule `db:backup` from a trusted host; run the drill monthly.

### 2. No secrets in the frontend

- **Status: PASS.**
- **Evidence:** the production build's `.next/static` and `.next/server` (5,199 files, 46 MB) were searched for the literal value of every non-public secret in `.env.local` (error webhook, ElevenLabs, Stripe, database URL and its password, auth secret). None appears. Only `NEXT_PUBLIC_*` values are meant to ship.
- **Remaining:** none found. Re-run after dependency or build changes.

### 3. Errors, stack traces and request IDs

- **Status: FIXED.** **Issue (Medium):** several admin and business routes returned raw error messages.
- **Changes:** `src/lib/api-error.ts` (request ID `req_<uuid>`, only allow-listed domain errors reach the client, details go to the server log), applied to the admin incident, recovery, pilot and demo-business routes, session revocation, monitoring tick and the receptionist route and page.
- **Tests:** `tests/unit/api-error.test.ts`; end-to-end probe in `tests/security-headers.spec.ts` (forged, oversized and unknown requests return no file paths, stack frames or connection details).
- **Remaining:** routes not listed above were reviewed but not rewritten; they already returned fixed text.

### 4. Secrets in Git, history and CI

- **Status: PASS** for history and tracking; **FIXED** for CI; GitHub-side settings **NOT VERIFIED**.
- **Evidence:** `.env*` (except `.env.example`) is ignored and no env, key or certificate file is tracked. All 92 commits were scanned for 18 credential shapes (Stripe, AWS, Google, GitHub, Slack, private keys, database URLs with passwords, JWTs, hard-coded secrets): no real match; the one hit is the deliberately fake e2e value. This is pattern-based, not an entropy scan.
- **Changes:** `scripts/check-secrets.js` plus `npm run check:secrets` and a CI step; CI `permissions: contents: read`; `persist-credentials: false` on checkouts; `.github/dependabot.yml`; `.env.example` documents `AUTH_SECRET` length and the webhook secrets. Tests: `tests/unit/check-secrets.test.ts`.
- **Remaining:** GitHub secret scanning and push protection, branch protection and required reviews are repository settings. Actions are pinned by tag, not commit hash. `.env.local` holds real production values inside a OneDrive-synced folder, so it is copied to cloud storage; consider moving it out of the synced path and rotating the values if that is a concern.

### 5. Webhooks: signatures, replay, idempotency

- **Twilio: PASS.** Signature checking fails closed in production, and the bypass flag is reported by `/api/health` as a production-safety failure.
- **Stripe: FIXED (Low).** During secret rotation Stripe sends several `v1` signatures; the verifier kept only the last, so valid events could be refused. It now accepts the event if any matches (constant-time, at most five). The 300-second window and per-event-ID dedupe were already correct. The route only records receipt; it has no billing logic.
- **Gmail push: FIXED (Low).** The envelope and the decoded notification are now validated strictly and anything else is acknowledged and dropped; the token compare is constant-time. Pub/Sub has no payload signature, so the shared token in the URL remains the control.
- **Google Calendar: FIXED (Low).** Token compare is constant-time, the channel ID must look like an organization ID, and notifications are rate limited per organization and address. No code in this repository creates Calendar watch channels, so the route may be dormant; end-to-end delivery is **NOT VERIFIED**.
- **Changes:** `src/lib/safe-compare.ts`, `src/product/security/stripe-webhook.ts`, `src/product/gmail/push.ts`, the three webhook routes. Tests: `tests/unit/webhook-hardening.test.ts` (16 tests), plus end-to-end probes in `tests/security-headers.spec.ts`.
- **Remaining:** behavior against real Google Pub/Sub is **NOT VERIFIED**. Replay protection for Twilio beyond its signature was not assessed in this pass. The URL token can appear in logs; Pub/Sub OIDC verification would be stronger and is a recommended next step, not done.

### 6. Token and session storage

- **Status: FIXED** (one Low item), rest **PASS**.
- **Evidence:** the session cookie is `HttpOnly`, `Secure` in production, `SameSite=Lax`, HMAC-signed and also checked against `tc_sessions`; the administrator JWT cookie is `Strict` with a two-hour life; magic-link tokens are stored hashed and consumed atomically once; MFA seeds and OAuth tokens are sealed with AES-256-GCM.
- **Issue (Low):** the base64url decoder accepted non-canonical spellings of a signature, so one valid token had several valid spellings (this also made a test flaky). Both verifiers now require the canonical form. Files: `session-token.ts`, `admin-jwt.ts`; tests in `saas-foundation.test.ts` and `admin-jwt.test.ts`.
- **Remaining:** a magic link is consumed by a plain GET, so an email scanner that prefetches links can use it up (annoying, not a bypass). Sealing keys derive from `AUTH_SECRET` with a single SHA-256; changing the secret forces reconnecting mailboxes and calendars, and changing the format was left out of scope.

### 7 and 17. Authentication and mandatory administrator MFA

- **Status: FIXED (Critical).**
- **Issue:** see "What matters most".
- **Changes:** MFA state machine with enrollment guard, attempt throttle and one-time-code replay claim (`security/service.ts`, `totp.ts`); platform-admin power requires MFA verified for the current session (`tenant.ts`, `isPlatformAdminIdentity`); `AdminMfaGate`; `scripts/reset-admin-mfa.js` for operator recovery (audited, never prints secrets); `saas/auth/secret.ts` for one definition of the signing secret.
- **Tests:** `tests/unit/security.test.ts` (six MFA tests: no access without MFA, no re-enroll once enabled, throttle, no code reuse, fresh code at later sign-in, time-step reporting).
- **Remaining:** recovery is operator-only by design. The login page does not display `?error=` codes, so some failures are silent (usability).

### 8. Tenant isolation and browser-supplied IDs

- **Status: PASS**, with the role fixes in area 14.
- **Evidence:** every business route resolves the caller's membership on the server and compares it with the path ID; a second account in another workspace cannot see the first one's mailbox or dashboard data (`tests/gmail.spec.ts`, two real accounts).
- **Changes:** Calendar OAuth `state` is now bound to the user who started it and the callback re-checks role (`scheduling/google.ts`, `calendar/connect`, `calendar/oauth/callback`). Tests: `tests/unit/calendar-oauth-state.test.ts` and an end-to-end test with two accounts in `tests/gmail.spec.ts`.
- **Remaining:** isolation is enforced in application code, not by the database (see area 9).

### 9. Row-level security and the Supabase Data API

- **Status: FIXED as a tool; exposure NOT VERIFIED; not applied.**
- **Issue:** the application connects as the table owner, which bypasses row-level security, so isolation is application-side by design. The Data API roles are not exempt: without RLS they can read and write every table. Reproduced in a Supabase-like container as `anon`, blocked after the script.
- **Changes:** `scripts/sql/lockdown-data-api.sql`, `scripts/lockdown-data-api.js` (report mode, `--apply` in one transaction with a post-check that the application role still works), `tests/unit/data-api-lockdown.test.ts`.
- **Remaining:** per-tenant RLS policies were deliberately not added: they would not apply to the owner role the app uses and would give a false sense of protection. The stronger design is a separate, non-owner runtime role; it is a larger change and is listed below.
- **Next:** run `npm run db:lockdown` (report) against production, then `--apply` after approval. In the Supabase dashboard, disable the Data API if it is not used.

### 10. Input validation and request size

- **Status: FIXED (Medium).** Public endpoints (website leads, client errors, audit booking, receptionist demo, magic link, Stripe and Gmail webhooks, Twilio forms) now read bodies through a streaming reader that stops at a limit even without a `Content-Length`. Existing zod validation was left in place. Files: `src/lib/request-body.ts` and the routes. Tests: `tests/unit/request-body.test.ts`.
- **Remaining:** the Twilio form cap trusts the declared length only.

### 11 and 12. File storage and uploads

- **Status: PASS (not applicable).** The route inventory found no upload endpoint and no file storage. Gmail attachments are streamed from Gmail on request as `Content-Disposition: attachment` with `X-Content-Type-Options: nosniff`, so a browser downloads them and does not render them.

### 13. SQL injection

- **Status: PASS.** 405 query call sites scanned: no string concatenation into SQL. Thirteen template literals interpolate only code-defined fragments (column maps, a constant SQL helper, a fixed table list) and all values are bound parameters.

### 14. Rate limiting across instances

- **Status: FIXED (High).** Counters go to Upstash when configured, otherwise to Postgres (`tc_rate_limits`, one atomic upsert), otherwise to memory; a failing tier falls to the next and never to "no limit". Added limits to the receptionist test, call test, notification test, automation test (live sends 5 per hour), API-key creation, sign-in callback and Calendar notifications.
- **Evidence:** on real Postgres exactly `limit` of many simultaneous requests pass, two independent pools share one budget, windows reset and old rows are swept (`tests/unit/shared-rate-limit-postgres.test.ts`); no-database behavior in `shared-rate-limit.test.ts` and `auth-callback-rate-limit.test.ts`.
- **Remaining:** client address trust depends on `CF_TRUSTED=1`; without it every visitor shares the `unknown` bucket. `/api/health` now reports this (area 17). Not verified on the live Cloudflare deployment.

### 15. Least privilege and roles

- **Status: FIXED (Medium).** A new `manage_settings` permission is owner and admin only. It now guards phone, fallback, scheduling, SMS automation, notification and business settings, automation templates and API keys. Owners, admins and members can write leads; viewers cannot. Files: `permissions.ts`, `access.ts`, the three shared `access.ts` helpers (scheduling, SMS automation, notifications, which cover every route behind them) and 15 routes directly.
- **Tests:** `tests/unit/role-gates.test.ts` includes an inventory that fails when any new mutating route lacks a role decision.
- **Remaining:** the database role the app uses is the owner. A separate migration role and a non-owner runtime role would limit damage from a SQL flaw; not done.

### 16. CORS

- **Status: PASS.** No route sets `Access-Control-*` headers, so browsers deny cross-origin reads. A second layer refuses cross-site writes that carry a session cookie before the route runs (`src/lib/csrf.ts`, `src/middleware.ts`; added in this pass, **FIXED** as defense in depth). Tests: `tests/unit/csrf.test.ts`, and the end-to-end checks in `tests/security-headers.spec.ts`.

### 18. Dependencies and configuration warnings

- **Status: FIXED** (patch updates applied) and **PASS** for known production advisories.
- **Evidence:** `npm audit --omit=dev` reports 0 vulnerabilities. The full audit reports 5 high findings, all in the ESLint toolchain (`braces` through `eslint-config-next`), already tracked with an expiry in `docs/dev-audit-exceptions.json`; the suggested forced fix would downgrade the config to an old major and was not applied.
- **Updated:** `next` 16.4.0 to 16.4.2, `@opennextjs/cloudflare` 1.20.11 to 1.20.12, `wrangler` 4.150.0 to 4.151.2, `@playwright/test` and `playwright` 1.64.0 to 1.64.1 (all inside the ranges already allowed). After the update: typecheck, all unit tests, the production build, all 154 end-to-end tests and the Cloudflare Worker dry-run were re-run and pass.
- **Not updated:** `resend` (minor release, no advisory) and `@axe-core/playwright` (pinned exactly). Dependabot now opens weekly update pull requests (`.github/dependabot.yml`).
- **Note for Windows developers:** `npm update` does not re-run the repository's `postinstall` patches, and without them the Cloudflare build fails with a symlink error. Run `npm install` (or `node scripts/patch-opennext-windows.js`) after changing dependencies.
- **Changes:** `/api/health` (detailed, authorized view) lists advisory `securityWarnings`: missing, borrowed or short `AUTH_SECRET`, untrusted client address, no shared rate-limit store. They never change readiness. Files: `src/lib/security-warnings.ts`; tests: `tests/unit/security-warnings.test.ts`.

### 19. TradeCatch-specific checks

- **Gmail: PASS** after the fixes above. Read-only scope, sealed tokens, sync throttled, same-origin checks, per-user mailbox isolation.
- **Receptionist: PASS.** Owner and admin are enforced in the service layer for every settings writer (tested directly); the public demo has no side effects.
- **Admin area: FIXED.** MFA, audited mutations, safe errors, `Strict` cookie.
- **Supabase: NOT VERIFIED.** Project settings, Data API exposure, roles and grants, backups and network restrictions can only be confirmed in the dashboard or on the live database.
- **SSRF (Medium): FIXED.** The CRM webhook and review links accepted any URL, so the server could be pointed at internal addresses. Now only public `https` hostnames on the standard port, no credentials, no redirects, with a DNS check where the runtime has one. Files: `src/lib/safe-url.ts`, `src/lib/product-crm.ts`. Tests: `tests/unit/safe-url.test.ts` (52).

## 20. Security testing and verification

Run on 2026-10-19 on the working tree, with `DATABASE_URL`, the durable-store flags and the third-party keys blanked so nothing reached a real service.

| Check | Result |
| --- | --- |
| `tsc --noEmit` | clean |
| Unit tests | 596 run, 595 pass, 1 skipped (the Postgres-only tests when no database URL is set) |
| Postgres-only tests, against a throwaway PostgreSQL 17 with the schema applied | 36 of 36 pass (shared rate limit, Gmail store) |
| `npm run test:qa` | pass |
| End-to-end (Playwright, production build) | 154 of 154 pass, including new checks for cross-origin access, cross-site writes, forged and oversized webhook requests, and the Calendar OAuth state with two accounts |
| `npm run build` | pass, before and after the dependency update |
| Cloudflare build and Worker bundle dry-run | pass, before and after the dependency update |
| Secrets in the built output | none (area 2) |
| `check:secrets`, `check:i18n`, `check:legal`, `check:media`, `check:dev-audit`, `check:brace-expansion` | pass |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Lint | no new findings. The repository already had 10 errors (for example `Date.now()` in the admin layout); none are in code added here. |
| `format:check` | 91 files already failed before this work and were left alone. Files my edits touched were formatted only where they passed before. |

Checks run on the way, not repeatable from the repository alone: the Data API
exposure reproduction and its fix (Supabase-like container), the restore drill and
its negative cases (area 1), and the 92-commit history scan (area 4; the scan
script is not kept in the repository).

The read-only `npm run db:lockdown` report was **not** run against the production database: the tool refused a production read from this session. Run it yourself (`DATABASE_URL=… npm run db:lockdown`) and read the result before approving `--apply`.

Not covered by any test here: the live Cloudflare deployment, real Google
(Pub/Sub, Calendar, OAuth consent), real Twilio and Stripe delivery, and the live
Supabase project.

## Remaining risks, in order

1. Supabase backups, Data API exposure and project settings unconfirmed.
2. App connects as the database owner; isolation is application-side only.
3. Gmail push relies on a URL token; Calendar notification flow unverified.
4. Magic links are consumed by GET and can be used up by link scanners.
5. Seal keys come from one secret by a single hash; rotation means reconnecting.
6. `.env.local` with production values sits in a cloud-synced folder.

## Next actions

1. Approve or adjust the table in "Needs your decision".
2. Run `npm run db:lockdown` in report mode against production and read it.
3. Confirm Supabase backups and PITR; schedule `db:backup`; run the drill monthly.
4. Set `CF_TRUSTED=1` when the origin is Cloudflare-only; set a dedicated `AUTH_SECRET` of 32+ characters.
5. Turn on GitHub secret scanning, push protection and branch protection.
6. Plan a non-owner runtime database role.
