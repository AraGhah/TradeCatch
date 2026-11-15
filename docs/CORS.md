# Cross-origin requests (CORS)

Which web pages may call the TradeCatch API from another origin, what a
preflight gets back, and how to change the list.

## How the site calls the API today

TradeCatch's own pages call `/api/...` with a relative URL, so the browser sends
the request to the origin that served the page. That is same-origin: no CORS
headers are involved, and none are added. The policy below only matters when an
approved TradeCatch frontend on a different origin (for example `www.tradecatch.ca`
calling `tradecatch.ca`, a staging frontend, or a local dev server) calls the API
with its session cookie.

CORS decides **which pages may read a response**. It is not access control.
Authentication (the `tc_session` and `tc_admin` cookies, bearer secrets), role
checks, the CSRF guard ([src/lib/csrf.ts](../src/lib/csrf.ts)) and the rate
limits all still run for every request, whatever the Origin header says.

## Where the policy lives

One module, [src/lib/cors.ts](../src/lib/cors.ts), used in two places:

| Layer        | File                         | What it does                                                                                                                                                                                                                                                                           |
| ------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next proxy   | [src/proxy.ts](../src/proxy.ts) | Answers preflights first, before the staging Basic gate and any route auth. Adds the headers to every other `/api` answer the proxy produces (CSRF 403, 413, rate-limit 429, and the pass-through to the route).                                                                       |
| Worker entry | [worker.ts](../worker.ts)    | Adds the headers to answers that never reach the proxy: the installation gate's refusals and the fetch guard's 503, so an approved frontend can read the error instead of seeing a network failure. It also fixes `NODE_ENV` to production so a missing value can never select the development list. |

Headers are **set**, never appended, so the two layers cannot produce a
duplicate `Access-Control-Allow-Origin` (browsers reject a duplicate). `Vary: Origin`
is merged, not repeated.

## Allowed origins

Exact string match against a per-environment list. No wildcard, no suffix or
substring match, no reflecting an Origin that is not on the list.
`https://tradecatch.ca/` (trailing slash), `HTTPS://TRADECATCH.CA`,
`https://tradecatch.ca.evil.example` and `null` all fail.

| Environment                                                   | Built in                                                                                       | Never                       |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------- |
| Production (real production runtime)                          | `https://tradecatch.ca`, `https://www.tradecatch.ca`                                           | localhost, staging hosts    |
| Staging (`TRADECATCH_ENV=staging`)                            | its own `NEXT_PUBLIC_SITE_URL` origin, when https                                              | the live origins, localhost |
| Development (`next dev`, tests, the local Playwright harness) | `http://localhost:3000`, `:3001`, `:3100` and the same ports on `127.0.0.1`                    | the live origins            |

### Adding an origin: `CORS_ALLOWED_ORIGINS`

Comma-separated exact origins, added to the list for that deployment only.

- `https://` origins are accepted in every environment.
- `http://` is accepted only for `localhost` / `127.0.0.1`, and only in development.
- Anything else (a wildcard, a path, a trailing slash, credentials in the URL,
  another scheme) is **dropped**, and one `tradecatch.cors.invalid_origins_ignored`
  warning is logged. A mistake narrows the list; it never widens it.

Set it as a Worker var or secret for the environment that needs it (see
[STAGING_ENVIRONMENT.md](STAGING_ENVIRONMENT.md) for staging). Leave it empty in
production unless a real second frontend exists.

## Which routes

Only the groups the frontend actually calls are offered:

`/api/auth/*`, `/api/app/*`, `/api/businesses/*`, `/api/billing/*`, `/api/admin/*`,
`/api/help/*`, `/api/referrals/*`, `/api/book-audit`, `/api/website-requests`,
`/api/receptionist/demo`, `/api/client-error`.

Machine-to-machine routes never get CORS headers, for any origin, and their
preflights are refused: webhooks, Twilio, the voice agent, `/api/ops/*`, cron
ticks (`.../tick`), `/api/website-leads` (API-key lead capture), installations,
Gmail push, health. They are called by servers, not browsers.

## What a response carries

**Preflight** (`OPTIONS` with `Access-Control-Request-Method`):

- Approved origin on an offered route: `204` with
  `Access-Control-Allow-Origin: <that exact origin>`,
  `Access-Control-Allow-Credentials: true`,
  `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`,
  `Access-Control-Allow-Headers: Content-Type, Authorization, Accept, Accept-Language, X-Requested-With`,
  `Access-Control-Max-Age: 600`, and
  `Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers`.
- Anything else: `403` with **no** `Access-Control-*` headers.
- A preflight carries no cookies, so it is answered before the staging Basic gate
  and route auth. It never reads a session and never reaches the rate limiter.

**Actual request**, from an approved origin: `Access-Control-Allow-Origin`
(exact origin), `Access-Control-Allow-Credentials: true`,
`Access-Control-Expose-Headers: Retry-After, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset`
and `Vary: Origin`. From any other cross-origin caller the route still runs its own
authentication, but the response has no `Access-Control-*` headers, so the page
cannot read it. Same-origin requests and requests with no Origin header (servers,
curl, webhooks) are left exactly as they were.

`Access-Control-Allow-Credentials` is only ever sent together with one exact
origin, never with `*`.

## Cookies and CSRF

The session cookies are unchanged: `HttpOnly`, `Secure` in production,
`SameSite=Lax` (`tc_session`) and `Strict` (`tc_admin`). They are only sent on
**same-site** requests, which covers `www.tradecatch.ca` to `tradecatch.ca`.

The CSRF guard refuses a cookie-carrying write whose `Sec-Fetch-Site` or `Origin`
says it came from elsewhere. The single exception: when the Origin is exactly the
origin the CORS policy approved for that request, it is treated as a first-party
frontend. A sibling subdomain that is not on the list, or any other site, is still
blocked before the route runs.

## Changing the policy

1. Edit `PRODUCTION_ORIGINS`, `DEVELOPMENT_ORIGINS`, `CORS_API_PREFIXES`, or the
   method and header lists in [src/lib/cors.ts](../src/lib/cors.ts). Nothing else
   hard-codes an origin.
2. Run `npm run test:unit` ([tests/unit/cors.test.ts](../tests/unit/cors.test.ts)
   and `csrf.test.ts`) and the browser spec [tests/cors.spec.ts](../tests/cors.spec.ts).
3. Do not add `Access-Control-*` headers anywhere else (not in `next.config.ts`,
   not in a route). A second source of those headers is how duplicates start.
