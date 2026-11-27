# KAN-25 — profile icon and sign-in navigation

## What it does

A profile icon sits in the site header at every width (last item on desktop; between the demo button and the menu button on a phone). It is one real link whose destination depends on who is asking:

| Visitor | Icon says | Goes to |
| --- | --- | --- |
| Signed out, expired or revoked session | "Login" / "Connexion" | `/login` · `/fr/connexion` |
| Customer | "My dashboard" / "Mon tableau de bord" | `/app` · `/fr/app` |
| Platform administrator | "Admin dashboard" / "Tableau de bord admin" | `/admin` · `/fr/admin` (which still asks for the second factor) |
| Suspended business that may still pay | "Billing" / "Facturation" | `/billing` · `/fr/facturation` |
| Not known yet (first moments of a page view) | "Account" / "Compte" | nothing happens until it is known |

No new pages were added: every destination is an existing route.

The phone menu's old fixed "Login" row is now the same account entry (so a signed-in person is never offered "Login"); the icon and that row share one check.

On a phone the icon costs 52 px of a header with little to spare, so the small "Book demo" button gives way in steps and never becomes a two-line pill: 420 px and up is the original header plus the icon; 385–419 px keeps the button on one line with slightly tighter spacing and 12 px text; below 385 px the button leaves the bar (the menu still has the full-width one).

## How it decides

The browser cannot read the sign-in cookies (they are `HttpOnly`) and must not choose a role, so it asks the server and only ever navigates to the address the server names.

1. **`GET /api/auth/session?locale=en|fr`** (new, `src/app/api/auth/session/route.ts`) answers `{ state: "anonymous", destination }` or `{ state: "signed_in", role: "customer" | "admin" | "billing", destination }`, or `503 { state: "unavailable" }`. Nothing else: no token, name, email, business or id. `Cache-Control: no-store, private`.
2. The answer comes from `resolveAccountState` (`src/product/saas/auth/account-destination.ts`), which uses the real sign-in rules: the signed access token **and** the session row (`requireTenantContext`, `requireBillingContext`), or, when the 15-minute access token has lapsed, a refresh token that is still good (`peekRefreshToken` in `refresh-token.ts`). The administrator role is the server's own list (`TRADECATCH_ADMIN_EMAILS` / `platform_role`), never something the browser sends.
3. **It never rotates a refresh token.** Rotation belongs to `POST /api/auth/refresh`; two tabs rotating at once look like theft and revoke the session. `peekRefreshToken` is read-only and shares the validity rules of `refreshSession` (they use the same two helpers), including the 30-second grace for a token a parallel tab just rotated.
4. Sign-in cookies that came with the request but no longer work (session revoked or ended, tampered, garbage) are cleared in the same answer. When the store cannot be reached the answer is `503` and **nothing is cleared**: an outage never signs anyone out. With no signing secret configured, nothing is cleared either.
5. The browser half is `src/lib/client/account-session.ts` (no React, unit-tested with a fake `fetch`), wrapped by `useAccountNav` and `AccountLink`/`MobileNav`:
   - **Loading:** the check starts when the header mounts. Activating the icon while it is open waits for the answer (it shares the same request); `aria-busy` is set; nothing navigates, and nothing goes to the sign-in page, until the session is known.
   - **Verified at the click:** the answer is asked for again at the moment of the click, so a session that ended meanwhile (signed out in another tab, expired, revoked) goes to sign in rather than to a dashboard that would bounce the person.
   - **Rapid clicks:** one request and one navigation, however many clicks. After a navigation starts, further clicks do nothing (until the page returns from the back/forward cache).
   - **Failure:** offline, 5xx or 429 → the last place it knew, otherwise the sign-in page. That is only a link: the sign-in page and every dashboard verify the session themselves.
   - **Destination allow-list:** the browser only follows `/login`, `/fr/connexion`, `/app`, `/fr/app`, `/admin`, `/fr/admin`, `/billing`, `/fr/facturation`, so even a tampered answer cannot make the icon an open redirect.
   - Modified clicks (new tab, ctrl/cmd, shift, middle button) are left to the browser; the `href` is a real, best-known address. Before hydration it is `/login`, which the sign-in page now resolves (below).

## Sign-in page and redirects

- **A signed-in person who opens `/login`** (or `/fr/connexion`) is sent on: to their dashboard, or to a safe `?next=` workspace page they were heading to. Judged on the access token (the refresh cookie is path-scoped to `/api/auth` and is not sent to pages), by the same `resolveAccountState`, so the login page and the dashboards can never send a person back and forth. Skipped when a message is waiting (`?error=…`, `?notice=…`) so a rejected link is still explained. If the check itself fails the form is shown.
- **After signing in** (password, emailed link, set-password): customers land on `/app`, administrators on `/admin`, billing-only on `/billing` — unchanged `homePathFor`, now covered by tests. `next` is honoured only for our own `/app/...` pages (unchanged `safeReturnPath`).
- **Decision kept as it was:** `/admin/...` pages are *not* a post-login destination (`tests/unit/auth-session-tokens.test.ts` asserts this); a signed-out administrator who opens `/admin/payments` signs in and lands on `/admin`, where the second factor is asked for.
- `/login` now carries `robots: noindex` like the other private pages, because every public page links to it.

## Authorization (unchanged, re-verified)

- `/admin` layout: not signed in → sign-in; signed in but not an administrator → `/app`. Every `/api/admin/*` route answers 403 to a customer and 401/403 to a visitor (`guardAdmin`). Nothing in the icon grants anything: it is a link, and the page and the API check again.
- Customers are never shown a link to the admin dashboard (the server only names `/admin` for administrators).

## Files

New: `src/app/api/auth/session/route.ts`, `src/product/saas/auth/account-destination.ts`, `src/lib/client/account-session.ts`, `src/components/AccountLink.tsx`, `src/components/useAccountNav.ts`, `tests/profile-navigation.spec.ts`, `tests/unit/account-session.test.ts`, `tests/unit/account-session-route.test.ts`.
Changed: `src/components/Header.tsx`, `src/components/MobileNav.tsx`, `src/product/saas/auth/refresh-token.ts` (two shared checks extracted; `peekRefreshToken` added; `refreshSession` behaves as before), `src/app/[locale]/login/page.tsx`, `src/messages/{en,fr}.json` (`nav.account*`).
No database change, no new environment variable, no new rate-limit policy (the central `api.read` default covers the route).

## Tests

| Id | Scenario | Where |
| --- | --- | --- |
| NAV-01 | Logged-out user clicks icon → sign-in (EN/FR) | `profile-navigation.spec.ts` |
| NAV-02 | Customer → customer dashboard (EN/FR) | `profile-navigation.spec.ts` |
| NAV-03 | Admin → admin dashboard | `profile-navigation.spec.ts` |
| NAV-04 | Session ended on the server with the cookies still held (cleared, sign-in); cookies expired (sign-in); access token expired but refresh good (stays signed in, customer and admin) | `profile-navigation.spec.ts`, `account-session-route.test.ts` |
| NAV-05 | Loading: no redirect until verified (signed in and signed out); check failure falls back to sign-in, which forwards a signed-in customer | `profile-navigation.spec.ts`, `account-session.test.ts` |
| NAV-06 | Customer opens admin routes → denied on pages and API; visitor → sign-in / 401·403 | `profile-navigation.spec.ts` (and `admin-dashboard.spec.ts` ADM-02) |
| NAV-07 | Login succeeds → role-based redirect (password and emailed link, customer and admin, EN/FR); safe `next` only | `profile-navigation.spec.ts` |
| NAV-08 | Refresh keeps the session (customer and admin) | `profile-navigation.spec.ts` |
| NAV-09 | Sign out, then icon → sign-in | `profile-navigation.spec.ts` |
| NAV-10 | One icon, inside the screen and clear of its neighbours at 16 widths from 320 to 1440 px (around every header change point); the small demo button is one line wherever it shows and absent below 385 px; works for visitor, customer, admin; mobile menu entry matches | `profile-navigation.spec.ts` |
| NAV-11 | Keyboard reach, visible focus ring, accessible name, Enter; axe scan of the header (desktop and phone) | `profile-navigation.spec.ts` |
| NAV-12 | Rapid clicks: one check, one trip, no errors, no loop | `profile-navigation.spec.ts`, `account-session.test.ts` |
| NAV-13/14 | Sign-in page forwards a signed-in person once; no redirect loops between sign-in, `/app`, `/admin` | `profile-navigation.spec.ts` |
| NAV-15 | No token, email or id in the page, storage, links or the session answer | `profile-navigation.spec.ts`, `account-session-route.test.ts` |

## Verification record

Run on 2026-11-19 against the e2e harness (production build with webpack, port 3100, in-memory store, `SAAS_DEV_LOGIN=1`, system Chrome through `TRADECATCH_E2E_CHROME_PATH`). Production, the production database and `.env.local` were not used. Nothing was deployed, committed or pushed, and nothing was changed in Jira.

**Passed, on the final source**

- `npx tsc --noEmit` clean. `eslint --max-warnings=0` on all 12 changed and new `.ts`/`.tsx` files clean. `npm run check:i18n`: 3092 keys, en/fr in step.
- `npm run test:unit`: 3188 passed, 1 failed, 3 skipped. The failure is `tests/unit/call-activity.test.ts:676` (this Node's tzdata renders 6:05 for 7:05), in code this change does not touch. (Run before the last header class edit, which no unit test reads.) The 26 new tests (`account-session.test.ts` 14, `account-session-route.test.ts` 12) pass and were mutation-checked.
- **Whole e2e suite, 2 workers, 7.3 min: 415 passed, 2 skipped, 2 failed.** The 2 skips are `help-center` "capture help screenshots" (a conditional skip that is not part of this change). `tests/profile-navigation.spec.ts` passed in full, 48 of 48 (NAV-01 to NAV-15, NAV-10 at 16 widths from 320 to 1440 px). An earlier 117-test run of `auth-session`, `email-contact`, `gmail`, `receptionist-workspace` and `admin-dashboard` (clean, 2 workers) is covered again by this run, on the final header.
- **The 2 failures** are `privacy-settings.spec.ts` "saveSmsHistory … sign in again" and "customerDataRetentionDays … sign in again". Both end on `POST /api/auth/callback` answering `429 rate_limited` (retry in 1 s). The browser navigations those helpers make to `/api/auth/callback` carry no forwarded client IP, so all of them share the single 600-per-10-minutes bucket for requests with no known IP (`auth.callback`, `unknown`, refilling 1 per second), and the whole suite signs in hundreds of times in about seven minutes. Run alone, `privacy-settings.spec.ts` passes 12 of 12, including both. This change adds no calls to that route, changes no rate-limit file, classifies `GET /api/auth/session` as the ordinary `api.read` bucket (a separate bucket; the policy's `group` field is not used by the limiter), and its own spec gives every test a private IP. **Not shown:** that the full suite passes without this change (it was not run at the base commit). A fix that would remove the fragility for everyone is to give `signInAs`'s browser a per-session `x-forwarded-for`; it was left alone as outside this task.

**Found by looking, then fixed**

- Numeric checks passed while the screenshots showed a real defect: with the icon added, the small "Book demo" button wrapped onto two lines ("Book / demo") at 360–407 px, i.e. on most phones, where it had been a single-line pill. The header now gives way in steps: **420 px and up** is the original look plus the icon; **385–419 px** keeps the button on one line with slightly tighter spacing and 12 px text; **below 385 px** the button leaves the bar to make room (the menu keeps the full-width "Book a Free Demo"). NAV-10 now asserts the button is one line (height ≤ 48 px, width ≥ 80 px) at 385–1079 px and absent below 385 px, which is the check that was missing. An earlier overflow of up to 33 px at 320–352 px was found and fixed the same way.
- Screenshots looked at (English, signed out): header at 320, 360, 375, 384, 385, 390, 414, 419, 420, 430, 768 and 1440 px, and the open phone menu at 375 px (one "Login" row in the same style as the others, above the language switch and the demo button).

**Decision for the owner**

- On phones narrower than 385 px (iPhone SE and mini at 375, many 360 px Android phones) the small "Book demo" button is no longer in the header bar; it is still the full-width button in the menu. The alternative, keeping it, means either a two-line pill or a header too full to fit the icon. Say so if the button should stay and something else give way.
- The icon's wording ("Account", "My dashboard", "Admin dashboard", "Billing" and the French) is new copy to be read.

**Not exercised**

- Firefox and WebKit; a real phone; a screen reader; the French header and the signed-in icon were tested but not looked at; the Postgres store (the new code only calls the existing store interface and adds no SQL); the Cloudflare Worker build.

**Status.** Every automated check for NAV-01 to NAV-12 passes on the final source, apart from the unrelated shared-bucket failures above that pass on their own. KAN-25 is not marked complete: the two decisions above and the checks under "Not exercised" are open, and committing and deploying wait for approval.
