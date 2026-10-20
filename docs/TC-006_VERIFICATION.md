# Problem 6 — Login-link confirmation

Development branch: `tc-006-login-confirmation`.

Opening an emailed login link now renders an English or French confirmation form. GET and HEAD never read or consume a login token or create a session. The form submits a bounded POST body after the user presses the confirmation button. A host-only, HttpOnly, Secure production cookie and matching form nonce protect confirmation before a session exists. The token remains subject to its original expiry and atomic one-use database check. Successful confirmation redirects with HTTP 303.

The confirmation document has no JavaScript, analytics, or external resources. Its response disables caching, indexing, referrer disclosure, and framing. The same header policy is applied in the Route Handler and the final matching Next.js header rule, so OpenNext cannot replace it with the global site defaults. Existing emailed links keep working with this added step; there is no database migration.

## Validation

- Isolated local PostgreSQL staging database (`tc006_staging`), synthetic demo accounts: 10 tests passed across memory and PostgreSQL. Verified repeated scanner previews, no session before confirmation, correct user/session afterward, cross-site/missing/mismatched confirmation rejection, expiry, French redirects, replay, and simultaneous confirmation.
- Full unit suite: 636 passed, 1 existing integration test skipped.
- TypeScript, changed-file ESLint, localization parity, and secret scan passed.
- Focused Playwright login journey passed against the production Next.js build. Repeated preview/reload remained unauthenticated; pressing the button reached the authenticated workspace.
- The full 158-test browser run was stopped after unrelated public-page navigation timeouts and stalled teardown. It is not reported as passed.
- There is no provisioned remote staging Worker/database. The PostgreSQL staging run above is isolated locally and does not use customer accounts or provider credentials.

## Release verification

Verified on https://tradecatch.ca on 2026-10-20. Active Worker version: `b9a18a06-161d-433a-89d7-53e558c1a7b5` at 100% traffic. Previous stable Worker version: `b4c103a4-30f8-40b6-831f-dfa1d94af6a8`.

- Final Cloudflare build, bundle validation, and focused browser login/header checks passed.
- Repeated production GET/HEAD previews left the stored token unconsumed and created no session. Actual response headers disable referrers, caching, indexing, scripts, and external resources.
- A separate browser with JavaScript disabled confirmed the form and authenticated as the correct synthetic user. Exactly one session was stored.
- A cross-site confirmation was rejected without consuming the token. Reusing the consumed link created no second session. The French form rejected an expired link at the French login page.
- Production health returned HTTP 200. Desktop (1100px) and mobile (375px) screenshots were visually reviewed.
- All labelled TC006 demo accounts, sessions, and magic links were removed. No email or SMS was sent.
- Existing secret bindings were preserved and both durable database flags remain enabled. No database migration was needed.
