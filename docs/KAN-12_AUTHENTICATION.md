# KAN-12 — authentication, tokens, password reset and account recovery

## How sign-in works now

| Credential | Cookie | Lifetime | Notes |
| --- | --- | --- | --- |
| Access token | `tc_session` (`HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`) | 15 minutes | HS256 JWT. Claims: `iss=tradecatch`, `aud=tradecatch-app`, `sub`, `sid`, `oid`, `plan`, `iat`, `exp`, `jti`. |
| Refresh token | `tc_refresh` (same flags, `Path=/api/auth`) | up to 14 days from sign-in | Opaque 32-byte random value. Only its SHA-256 is stored (`tc_refresh_tokens`). Rotated on every use. |
| Administrator token | `tc_admin` | unchanged | Separate key purpose (`admin-jwt`), so an access token can never be replayed as an administrator token or the reverse. |

- Tokens are never placed in a URL, response body or `localStorage`/`sessionStorage`.
- The JWT verifier accepts only the exact header `{"alg":"HS256","typ":"JWT"}`, canonical base64url, a 4096-character token at most, and checks signature, issuer, audience, expiry (60 s clock skew), `iat` and a maximum lifetime.
- The session row (`tc_sessions`) is still checked on every request, so logout, password change and administrator revocation take effect immediately, not when the 15-minute token expires.
- **Rotation and theft detection.** Each refresh returns a new refresh token. Presenting an already-used token again is allowed for 30 seconds (two tabs renewing at once); after that it revokes the whole session and writes `refresh_token_reuse_detected` to the audit log.
- **Renewal.** The proxy renews a missing or expired access token on page loads of `/app`, `/admin` and `/billing` (and the `/fr/...` equivalents) through `GET /api/auth/refresh?next=…`, which only ever redirects to a same-site signed-in path. In the browser, `SessionKeeper` renews about a minute before expiry, on focus/visibility/online, and retries a call once after a 401. If renewal is refused the person is sent to sign in.
- **Landing.** Platform administrators land on `/admin` (where MFA is asked for first); customers land on `/app` (or billing for billing-only accounts).
- **Logout** revokes the session (from either cookie), audits it and clears all three cookies, including after the access token has expired.

## Password reset

1. "Forgot your password?" on the sign-in page → `POST /api/auth/forgot-password`.
2. The answer is identical for known and unknown emails. In production the lookup and email happen after the response is sent, so response time does not reveal an account either.
3. The emailed link is single use and expires in 30 minutes. Only the hash is stored. A newer request or a successful reset invalidates older links.
4. Setting the password enforces the password policy, signs out every session and refresh token for the user, and sends a "your password was changed" confirmation email. First-time activation sends no warning.
5. Limits: per email address (5 per window) and per IP (`auth.forgot-password` in `src/lib/rate-limit-policy.ts`).

## Lost email: support-based recovery

For people who can no longer open the email on their account. Public registration stays disabled; recovery never creates an account.

1. **Request** (`/account-recovery`, French `/fr/recuperation-de-compte`): rate limited (`auth.account-recovery`), honeypot field, always the same confirmation, nothing changes by itself. A duplicate open request for the same account is not stored twice.
2. **Verify** (admin area → Account recovery): requires a signed-in administrator session with MFA and the admin token. The shared ops secret is rejected here on purpose, because it identifies nobody. The administrator checks the requester against *our* records (business phone on file, billing details, ID on a video call, contract details), picks the method, writes at least 20 characters of evidence and confirms they personally verified the person.
3. **Complete**: only after verification. It changes the email only. It revokes every session, invalidates outstanding password links, deletes the old password, emails a single-use 30-minute password link to the **new** address and a notice to the **old** one. Administrator accounts and the acting administrator's own account cannot be recovered this way. If the link email fails, the administrator is told (`linkSent: false`) and the customer can use "Forgot your password" with the new address.
4. Business data, appointments, settings and subscriptions are untouched; the user id and organization are unchanged.
5. **Audit**: `account_recovery_requested`, `…_identity_verified`, `…_email_changed`, `…_link_sent`/`…_link_failed`, `…_rejected`, with the administrator as actor and masked email addresses. The raw verification notes live with the request record, not in the audit trail.

## Authorization

- Customer APIs resolve the tenant from the signed session; a customer cannot read another business (covered by `business-route-authz-coverage.test.ts` and the browser spec).
- Every `/api/admin/*` route goes through `authorizeAdminRequest`; recovery routes additionally refuse the ops-secret path.
- `/admin` redirects non-administrators to `/app`.

## Database

New migration `039_auth_sessions` (`src/product/saas/auth-sessions.sql`): `tc_refresh_tokens`, `tc_account_recovery_requests`. Apply with `npm run db:schema` **before** or together with the deploy. If it is missing, sign-in still works (single long-lived access token, error logged), recovery is unavailable and password reset falls back to the single-use sign-in link. Nothing here was run against production.

## Rollout notes

- Existing 14-day `tc_session` cookies keep working until they expire; they are treated as access tokens with a legacy lifetime and are replaced on next sign-in.
- No new environment variables. `AUTH_SECRET` signs both the access and administrator tokens under separate key purposes.
- Rate-limit rows were added to `docs/RATE_LIMITS.md`: `auth.refresh`, `auth.account-recovery`, `admin.account-recovery`.

## Tests

- `tests/unit/auth-session-tokens.test.ts` — JWT claims, tampering, issuer/audience, `alg: none`, admin/access token swap, refresh hashing, rotation, grace window, theft detection, revoked and expired sessions, refresh and logout routes, open-redirect cases, password reset killing sessions.
- `tests/unit/account-recovery.test.ts` — reset email delivery, expiry and reuse, enumeration safety, limits; recovery request, authorization matrix (401/403/ops secret/no MFA/no admin token), verification, completion, audit, protected accounts, races.
- `tests/unit/return-path.test.ts`, `tests/unit/csrf.test.ts` — renewal paths, landing paths and cookie flags.
- `tests/auth-session.spec.ts` (Playwright, desktop and phone) — cookies, renewal, logout with stolen cookies, customer/admin separation, tenant isolation, the whole lost-email flow through the UI, accessibility of the new pages.

## Verification record (2026-11-14, local, nothing deployed)

| Check | Result |
| --- | --- |
| `npm run test:unit` | 2157 tests, 2154 pass, 0 fail, 3 skipped (the skips predate this work) |
| `npx tsc --noEmit`, `npm run lint`, `npm run check:i18n`, `npm run format:check` | clean (2878 i18n keys in parity) |
| Playwright: `auth-session`, `password-login`, `installation-approvals`, `native-sales-crm` | 29 of 29 pass, desktop and phone viewport |
| Playwright: the other seven specs that failed in the full run, rerun with two workers | 40 of 40 pass |
| Mutation spot-checks (reuse detection, signature check, ops-secret guard, session revocation, password deletion, reset-token invalidation) | each removal is caught by a test |

The full Playwright suite run in parallel is not reliable on the unmodified base commit either:
25 tests fail there and 21 on this branch (19 in common), all from the shared per-address
`api.write` backstop in `src/lib/rate-limit-central.ts` when many specs send unidentified requests at once. The auth
spec avoids this by giving every test its own `x-forwarded-for`, like the other specs do.

### Not verified

- The Postgres implementations of the new store methods and migration 039 were cross-checked against
  the schema by reading, and typechecked, but **not executed against a live Postgres** (no local
  database was available; the e2e harness uses the in-memory store). Rehearse `npm run db:schema` and one
  sign-in/refresh/recovery pass on a scratch or staging database before production.
- Email delivery was exercised against a mocked Resend endpoint, not a real mailbox.
- Production, staging and real providers were not touched.
