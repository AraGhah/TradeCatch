# TC-022 — scanner-safe magic links

The existing fix already separates link preview from authentication:

- `GET /api/auth/callback` renders a no-store confirmation form and never reads
  or consumes the token store. `HEAD` also has no authentication side effects.
- The user must submit a deliberate form POST. A host-only HttpOnly SameSite
  confirmation cookie, matching nonce, explicit confirm value and request-site
  checks protect it. Token consumption and session creation happen only then.
- Expired links remain expired; a replay cannot create another session.

`tests/unit/login-confirmation.test.ts` covers repeated scanner GET/HEAD requests,
cross-site and missing confirmation rejection, expiry, French flow, one-time
consumption and racing POSTs. No callback implementation change was necessary
for TC-022. Production verification uses a labelled demo organization and a
directly created test token, checks it remains unused after previews, confirms
once in a browser with JavaScript disabled, and removes the account and sessions.

The flow prevents consumption by passive GET/HEAD scanners. A tool deliberately
submitting the confirmation form is outside that passive-preview guarantee.
