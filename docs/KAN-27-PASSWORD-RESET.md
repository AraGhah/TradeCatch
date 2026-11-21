# KAN-27 — secure password reset tokens and 30-minute link expiry

**Status: built and verified locally. Not committed, not deployed, not marked complete.**
The ticket says not to mark KAN-27 complete until every acceptance criterion passes and not to deploy without approval. Everything the local harness can run passes (see "Verification record"); the items it cannot run are listed under "Not verified", and they keep this from being called complete.

Related: `docs/KAN-12_AUTHENTICATION.md` (the auth system this reuses), `docs/RATE_LIMITS.md` (the KAN-11 limiter this reuses).

## What was reused, and what was not built

No second auth system. Reset links still use `tc_password_tokens` (migration 037), `issuePasswordToken` / `completePassword` in `src/product/saas/auth/password-auth.ts`, scrypt via `password.ts`, the KAN-12 JWT + rotating refresh-token sessions (`tc_sessions` revocation kills both), `sendAuthEmail` (Resend), the KAN-11 token-bucket limiter, PostgreSQL and the in-memory twin store. No dependency was added.

Already correct before this ticket and left alone: 256-bit CSPRNG secret (`randomToken(32)`, 43 base64url characters), SHA-256 hash stored, never the secret; 30-minute reset TTL; single-use semantics at the row level; scrypt hashing; password policy; "your password was changed" email; same answer for known and unknown email at the request endpoint.

## Audit findings, and what was done about each

| # | Finding | Fix |
|---|---|---|
| 1 | **A newer link did not cancel older ones.** KAN-12 documented "a newer request invalidates older links" but nothing enforced it: asking three times left three live links. | `replacePasswordToken` cancels earlier unused links of the same kind and inserts the new one in one step. In PostgreSQL it first takes `FOR NO KEY UPDATE` on the user row, so two requests at the same moment cannot each cancel "the old one" and both leave a live link. |
| 2 | **Finishing a reset was several separate writes** (spend link, store hash, cancel links, revoke sessions). A failure part way could burn the link without changing the password, or change the password and leave sessions alive. | `completePasswordReset` does all of it in one transaction. The conditional `UPDATE … WHERE consumed_at IS NULL AND expires_at > now RETURNING *` is the whole race decision, so of N simultaneous submissions exactly one gets a row back. Any failure rolls everything back, the link stays unspent and the person can retry. |
| 3 | **The secret was in the query string** (`/set-password?token=…`). A query string reaches Cloudflare request logs, Workers Logs/traces (100% sampling in `wrangler.jsonc`), proxies, and `Referer` headers. | The emailed link is `/set-password#token=…`. A fragment is never sent to any server. The page reads it in the browser, checks it with a POST body, and rewrites a legacy `?token=` link into a fragment with `history.replaceState`. |
| 4 | **The link's address came from the request.** A forged `Host` / `X-Forwarded-Host` would have put the attacker's site in the victim's emailed link (token theft). | `trustedSiteOrigin()` (`src/product/saas/auth/site-origin.ts`): a valid https `NEXT_PUBLIC_SITE_URL` wins; http only for loopback outside production or in the e2e harness; production never falls back to the request (falls back to `https://tradecatch.ca`). Also applied to the admin business-creation, ops provisioning and magic-link routes, which build links the same way. |
| 5 | **Any failure creating the link silently emailed a sign-in link instead** (a bypass of the reset step, and a false success). | The fallback is now only for the "migration 037 not applied yet" case (`42P01`). Any other failure sends nothing, is audited (`password_reset_failed`) and logged without secrets. |
| 6 | **Errors could carry a secret into logs** (a provider that echoes the message body, a driver error naming a value). | `safeErrorText()` masks anything token-shaped (32+ URL-safe characters) and truncates. All reset-path logging goes through it. |
| 7 | **The per-address limit was not the KAN-11 limiter, was not atomic, and failed silently.** It reused the sign-in lockout counter (`loginAllowed` then `noteLogin`): check, then record, so simultaneous requests could all pass the check; and a refused request returned `ok` with no email and no signal, so the ticket's "excessive requests → rate limiting" was not observable. | Replaced by the KAN-11 token bucket: `auth.forgot-password-account` (5, refills 1 per 12 minutes), one atomic spend per request, keyed by a hash of the address and spent for every address typed so a refusal says nothing about whether an account exists. A refusal is now a real `429` with `Retry-After` (the audit entry `password_reset_rate_limited` is kept). New `auth.set-password-check` (30 per 15 minutes per IP) limits guessing through the page-open check. |
| 8 | **The request endpoint answered `ok` when it failed.** | It now answers 503 `unavailable`; the form says to try again. The body names nothing about the address or the failure. |
| 9 | **Google Analytics reports the full page address**, which would include the secret on a page opened from the link. | `isSecretLinkPath()`: the set-password pages (EN `/set-password`, FR `/definir-mot-de-passe`) are never measured, whatever the cookie choice. With the fragment change this is defence in depth. |
| 10 | **The page showed the form for a dead link, and the failure came only after typing a password.** Copy did not match the required message. | `SetPasswordFlow` checks the link on open (`POST /api/auth/set-password/check`, spends nothing), then shows the form or "This password reset link has expired or has already been used." with a **Request a New Link** button to `/forgot-password`. A check that could not run is reported as a problem with Try again, never as "expired". Changing only the fragment of the open page (pasting a newer link) re-checks the new link. |
| 11 | **The set-password page was cacheable and sent a normal `Referer` policy.** | Per-path headers (`next.config.ts`, after the catch-all so they win): `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store, max-age=0`, `X-Robots-Tag: noindex, nofollow, noarchive`, for both language paths. The page itself carries no third-party script and never reads the secret on the server. |

## How expiry and single use work

- A reset link is created with `expires_at = created_at + 30 minutes` (`PASSWORD_RESET_TTL_MS`). Nothing ever updates `expires_at`: looking at a link, a weak-password attempt or a failed submit does not move the deadline.
- Validity is decided in the database, in the same statement that spends the link: `consumed_at IS NULL AND expires_at > $now`. At exactly 30:00.000 the link is dead; at 29:59.999 it works (unit-tested at that boundary).
- A used, replaced, expired, unknown or malformed link all get the identical answer (400 `invalid_link`; the check endpoint answers `{ "valid": false }`), so the response does not tell a guesser how close they were.
- Asking for a new link after expiry issues a fresh 30-minute link; it never revives the old one.
- Activation invitations (kind `activation`, 7 days) share the machinery and the single-use, hash-only and atomic rules, but keep their own TTL. A reset request does not cancel an unused invitation, and vice versa.

## Database changes

**None.** `tc_password_tokens` already has `token_hash`, `kind`, `expires_at`, `consumed_at`, `created_at`, and the unique hash index; the new store methods only use them. No migration, no backfill, so deploy order cannot lock anyone out, and the pre-037 fallback keeps working. Rolling back the code needs no database step.

## Rate limiting (KAN-11 policy table, `src/lib/rate-limit-policy.ts`, documented in `docs/RATE_LIMITS.md`)

| Policy | Budget | Keyed by | Protects |
|---|---|---|---|
| `auth.forgot-password` (existing) | 5, refill 1 per 3 min | IP | Reset emails sent to other people |
| `auth.forgot-password-account` (new) | 5, refill 1 per 12 min | hash of the address | One address being flooded from many IPs; spent for unknown addresses too |
| `auth.set-password` (existing) | 20, refill 1 per 45 s | IP | Guessing links by submitting |
| `auth.set-password-check` (new) | 30, refill 1 per 30 s | IP | Guessing links through the page-open check |

A refused request answers 429 with `Retry-After` and no information about the account. These are named route policies, so they are always enforced: `RATE_LIMIT_MODE` (`monitor` / `off`) applies only to the central `/api` backstop in `src/proxy.ts`, not to them.

## Files

New: `src/product/saas/auth/site-origin.ts`, `src/product/saas/auth/password-link-headers.ts`, `src/lib/client/password-link.ts`, `src/components/app/SetPasswordFlow.tsx`, `src/app/api/auth/set-password/check/route.ts`.
Changed: `password-auth.ts`, `store.ts`, `memory-store.ts`, `postgres-store.ts`, `route-helpers.ts`, `forgot-password/route.ts`, `magic-link/route.ts`, `admin/businesses/route.ts`, `missed-call/ops/provision-organization/route.ts`, `set-password/page.tsx`, `SetPasswordForm.tsx`, `ForgotPasswordForm.tsx`, `analytics.ts`, `next.config.ts`, `rate-limit-policy.ts`, `docs/RATE_LIMITS.md`, `docs/KAN-12_AUTHENTICATION.md` (corrected: it claimed supersession that was not enforced, and described the query-string link), `messages/en.json` + `fr.json` (`setPassword` namespace).
Tests: see below.

## Verification record

Run in `.worktrees/kan-27-password-reset`, base `ee470320`.

| Check | Result |
|---|---|
| `tests/unit/password-reset-tokens.test.ts` (RESET-01…12, 14 against the real route handlers, a fake mail provider, a recorded console and a mocked clock; plus the shared store contract against the in-memory store) | 38/38 |
| `tests/unit/password-link-hardening.test.ts` (trusted origin, fragment reader parity with the server's token-shape rule, analytics exemption, headers wiring, no third-party script / server-side secret read) | 13/13 |
| `tests/unit/password-reset-postgres.test.ts` (same contract and rollback/race/no-raw-secret tests against **real PostgreSQL 16** in a throwaway loopback-only Docker container) | 9/9 |
| `password-auth`, `account-recovery`, rate-limit policy/docs-drift tests | green |
| `npm run test:unit` (whole suite) | 3213 pass, 1 fail, 3 skipped. The failure is `call-activity` "shows the stored UTC time in the business's own zone", the known tz-database failure on this Node, identical on the untouched base. The 3 skips include the PostgreSQL file, which is env-gated and was run separately above. |
| `npx tsc --noEmit`, `npm run lint` (`--max-warnings=0`), `npm run check:i18n` (3092 keys) | clean |
| Mutation spot-checks (each applied one change, ran the covering test file, restored the file and checked its hash) | 12 changes that alter behaviour, all caught: no supersede; request-origin trusted (3 variants); no log redaction; no per-user lock (real PG); no `consumed_at IS NULL` guard (real PG); `>=` expiry boundary (real PG); no transaction `BEGIN` (real PG); no session revocation (real PG); no cancel-other-links (real PG); analytics exemption removed. One mutation (`ROLLBACK`→`COMMIT` on error) survived and was shown to be equivalent: PostgreSQL turns `COMMIT` on an aborted transaction into a rollback. |
| Playwright on the real built server (webpack production build, `TRADECATCH_E2E` harness), 2 workers, system Chrome: `password-reset` (14, new), `password-login`, `auth-session`, `cors` (the three existing specs that touch this flow, updated to the fragment link and the new copy) | 54/54. The first run had 3 failures in the new spec: two were wrong test expectations, one exposed a real gap (pasting a newer link into the already-open tab changes only the fragment, so the page never re-read it); fixed with a `hashchange` re-check and an abort guard against late answers, with its own spec. Not run: the rest of the e2e suite (unrelated specs; the known `CAL-04` baseline failure is not in these four files). |

Acceptance criteria map:

| ID | Where it is proved |
|---|---|
| RESET-01 secure email | unit (link shape, HTTPS, configured origin, fragment, hash-only, 30 min) |
| RESET-02 valid link changes password | unit + e2e |
| RESET-03 expired rejected | unit (29:59.999 valid, 30:00.000 dead; deadline never extended) |
| RESET-04 reuse rejected | unit + e2e |
| RESET-05 invalid token, password unchanged | unit + e2e |
| RESET-06 second link invalidates first | unit (incl. simultaneous requests, rate-limited request) + real PG + e2e |
| RESET-07 unknown email generic | unit (status/body/headers identical; nothing created) |
| RESET-08 rate limiting | unit + e2e (per IP, per account, unknown address identical, refill) |
| RESET-09 two simultaneous submissions | unit + real PG (concurrent) + e2e (5 parallel HTTP) |
| RESET-10 sessions invalidated | unit (access cookie, refresh token) + e2e (second device) |
| RESET-11 new link after expiry | unit |
| RESET-12 no token in logs/responses | unit (searches every log line and response of a full flow, including a provider that echoes the link and a store error naming the secret) + e2e (no secret in any request URL or console) |
| RESET-13 phone flow | e2e at 390×844 touch (Chrome): request, open link, reload, choose password, signed in; no horizontal overflow, controls inside the viewport; legacy `?token=` link; expired link → Request a New Link; axe |
| RESET-14 DB/email failure safe | unit (DB failure keeps link unspent and reports 503; provider failure sends nothing false; no sign-in link substituted) |

## Not verified (why this is not "complete")

- **Real email delivery.** Resend was never called; a fake provider stood in. Link rendering in real mail clients (some rewrite or prefetch links) is untested.
- **The deployed Cloudflare Worker.** The OpenNext/Worker entry, the per-path headers on the Worker and Cloudflare's own request logs were not exercised; the Next production server was.
- **PostgreSQL via the app's pooled production connection** (pooler/transaction-mode specifics). The SQL ran on real PG 16 directly, not through Supabase's pooler.
- **Firefox, Safari/WebKit and a real phone.** The phone run is Chrome with a 390×844 touch viewport. The browser bundle for Firefox/WebKit is not installed here.
- **A screen reader.** Only automated axe checks ran.
- **Residual: already-sent legacy links.** A link emailed before this change has the secret in the query string, so the request for it reaches Cloudflare's logs. Those links expire in 30 minutes (reset) or 7 days (invitations). New links are fragment-only.
- **Fragment loss.** A mail client or a link-shortener that strips fragments produces a link the page shows as expired; the person uses Request a New Link. The ticket asks for exactly this message, so it is not distinguished from expiry.

## Decisions for the owner

1. **Email failures are deliberately silent to the requester.** The request endpoint answers the same generic message even when the email provider rejects the message, because a visible failure would reveal which addresses have accounts. The failure is logged and audited (`password_reset_email_failed`) for operators. The 503 is reserved for the request itself failing. If you want a visible failure, the trade-off is account enumeration.
2. **Reset TTL is 30 minutes for resets, 7 days for invitations.** The ticket covers resets only. Say if invitations should also move.
3. **Rollout:** apply nothing to the database; deploy the code. The two new policies enforce from the first request (there is no monitor switch for named policies), so the numbers are the thing to review: 5 reset emails per address per hour is generous for a person and a hard stop for a flood; the link check is 30 per 15 minutes per IP, and opening a link costs one check, so a shared office is not at risk, but a customer pressing Try again repeatedly can reach it. Confirm `NEXT_PUBLIC_SITE_URL` is the https production origin on the Worker; if it is unset, production falls back to `https://tradecatch.ca` (correct for production, wrong for staging).
4. Nothing was committed or pushed, and nothing was deployed.
