# KAN-30: Refactoring, architecture cleanup and code quality

**Status: not complete.** All changes are uncommitted in `.worktrees/kan-30-refactoring`
(branch `kan-30-refactoring-architecture-cleanup`, from `main` at `6cecbf1c`). Nothing was
deployed and no database, Stripe or provider configuration was touched. See
[What was not verified](#what-was-not-verified) and [Owner decisions](#owner-decisions-open)
before treating this as done.

## Summary

The audit found a codebase that is already in reasonable shape at the type level (4 `any`,
5 `@ts-` suppressions in 974 files, a uniform `{ error }` response shape, body parsing
already centralized). The real debt is **copy-pasted infrastructure** and **a handful of
very large modules**. This pass removes the duplication where the copies were provably
identical. It splits the largest module, the receptionist engine, along lines where the
moved code captures nothing from its closure. It adds characterization tests first, so the
moved code is now tested directly. Everything else is listed as deferred work with the
reason.

| | Before (`main` 6cecbf1c) | After |
| --- | --- | --- |
| `src` TypeScript files / lines | 974 / 164,600 | 979 / 164,036 |
| `receptionist/engine.ts` | 2,733 lines | 2,513 lines (+ `voice-plans.ts` 181, `call-session.ts` 87) |
| `/api` route handler code | — | +92 / −361 lines (18 route files lose their private gate wrappers) |
| Private Postgres pool caches | 8 copies | 1 helper (`createPostgresPoolCache`), 7 stores use it; 1 left on purpose |
| HTML/XML escapers | 7 functions | 2 (`src/lib/escape.ts`) + 2 deliberately different Twilio copies |
| Time-zone validators | 4 | 1 (`src/lib/time-zone.ts`) |
| Tenant feature gates in `/api/app` | 29 hand-written blocks in 18 files | 1 helper (`requireTenantFeature`) |
| Twilio webhook form prelude | 4 hand-written copies | 1 helper (`readVerifiedTwilioForm`) |
| Ops/cron gate (bearer + audit + `X-Ops-Actor`) | 19 hand-written copies | 1 helper (`guardOpsRequest`) |
| Modules importing the 1,000-line SMS store only for the shared pool | 37 | 0 (`getPgPool` lives in `src/lib/postgres-pool.ts`) |
| `any` casts in `src` | 1 (`missed-call/crm.ts`) | 0 |
| Dead modules | 4 | 0 (deleted) |
| Unit tests | 3,663 | see [Test results](#test-results) |

No customer-facing behaviour, copy, design, route, status code, response body or webhook
contract was changed on purpose. Every place where unifying would have changed behaviour
was left alone and is listed under [Owner decisions](#owner-decisions-open).

## Ground rules followed

- Characterization tests were written **before** each change and run against the
  unchanged code, then again after. Mutation spot-checks (below) prove the tests can fail.
- No deletion without proof of no use: each removed file was checked for imports and
  dynamic references in `src`, `tests`, `scripts`, `docs` and **every other worktree**.
- No new dependency, framework or pattern. The helpers are plain functions.
- Behaviour-changing "cleanups" were held for the owner rather than made.
- No commit, push or deploy (per the owner's standing instruction; this overrides the
  per-task commit rule in `AGENTS.md`).

## Initial audit

### Size and structure

Largest files on `main`: `receptionist/engine.ts` 2,733 lines; `scheduling/service.ts`
1,888; `sms-automation/service.ts` 1,645; `missed-call/engine.ts` 1,593;
`components/app/AppointmentDesk.tsx` 1,318; `components/BookAuditForm.tsx` 1,287;
`components/app/ReceptionistSettingsForm.tsx` 1,224; `notifications/service.ts` 1,177.
15 files are over 1,000 lines and 43 are over 600.

The large back-end modules are factory closures (`createXxx(deps) { … return { … } }`).
A TypeScript-compiler-API pass measured what each inner function captures from the
closure, which is what decides whether it can move out without a redesign:

| Factory | Body | Inner functions | Capture nothing (movable as-is) |
| --- | --- | --- | --- |
| `createReceptionistEngine` | ~2,500 lines | 46 | **16 (234 lines) — moved in this pass** |
| `createSchedulingService` | 1,563 | 5 | 0 |
| `createMissedCallEngine` | 1,422 | 12 | 0 |
| `createAutomationService` | 1,380 | 14 | 2 (13 lines) |
| `createNotificationService` | 1,038 | 8 | 2 (69 lines) |

The other four are large because of a few long methods (`slotsFor` 109 lines,
`handleTechnicianSms` 166, `run` 238, `attempt` 178) that all use `deps`. Splitting them
is a design change (smaller dependency sets per concern), not a move, so it is
[deferred](#deferred-work).

### Duplication (confirmed by reading each copy)

| What | Copies on `main` | Identical? |
| --- | --- | --- |
| Per-connection-string `Pool` cache (`pools` Map + `getPool`) | 8 stores | 7 identical; `email-automation` builds a raw `new Pool` (different) |
| `escapeHtml` (5 entities, `'` → `&#39;`) | `lib/email.ts`, `lib/business-notifications.ts`, `email-automation/template.ts` | yes |
| `escapeXml` / `escapeSsmlText` (5 entities, `'` → `&apos;`) | `receptionist/voice.ts`, `receptionist/speech-style.ts` | yes |
| `escapeXml` (4 entities, no apostrophe) | `api/twilio/sms/inbound`, `api/twilio/voice/inbound` | identical to each other, **not** to the above |
| Lazy Resend client | `lib/email.ts`, `lib/business-notifications.ts` | yes |
| `isValidTimeZone` / `isZone` | `missed-call/client-config.ts`, `receptionist/config.ts`, `scheduling/slots.ts`, `components/app/AvailabilityEditor.tsx` | same result for every input (`Intl` throws on `""` too) |
| base64url encode/decode | `email-automation/unsubscribe.ts`, `receptionist/business-test.ts` | yes |
| `ownerPhone` / `primaryPhone` (active roster entry) | `receptionist/config.ts`, `receptionist/profile.ts` | yes |
| In-memory engine set-up + `planMessages` | `receptionist/demo.ts`, `receptionist/business-test.ts` | set-up and `planMessages` yes; `settle` / `transferNote` differ |
| `isPlanId` / `isSoldPlan` | `saas/entitlements.ts`, `saas/plan-catalog.ts` | yes |
| `accentHeadline` | `app/[locale]/page.tsx`, `components/home/HomeMobile.tsx` | yes |
| Twilio form prelude (size cap → parse → signature) | 4 webhook routes (plus 2 that differ) | yes for 4 |
| Session + plan-feature gate | 29 blocks in 18 `/api/app` routes (each with its own `context()` wrapper) | yes |

### Dead code

| File | Evidence |
| --- | --- |
| `src/lib/store.ts` | no importer anywhere (src, tests, scripts, docs, other worktrees) |
| `src/product/scheduling/ai-booking.ts` | no importer; superseded by `receptionist/phone-booking.ts` |
| `src/components/motion/Reveal.tsx` | no importer |
| `src/components/app/BookingForm.tsx` | no importer; replaced by the calendar desk |

Also found but **kept** (each has a reason): `lib/tenant-cache.ts` and
`components/demo-video/timeline.ts` are used only by tests. `product/agent-tools/*` and the
Stripe plan audit are reachable only from `scripts/`, which is legitimate.
`@emnapi/*` and `@swc/helpers` look unused but are lockfile pins the build needs. The
unused barrels `missed-call|receptionist|saas/index.ts` are kept because the receptionist
README documents its barrel as the public import.

### Other areas checked, no change needed

- **Validation:** request bodies already go through the shared bounded parsers and zod
  schemas; nothing to centralize.
- **Error shape:** about 203 routes already answer `{ error }` with a status.
- **Type safety:** 4 `any` and 5 `@ts-` suppressions in the whole tree.
- **Security controls** (rate limiting, CORS, Twilio signatures, admin RBAC, tenant
  isolation, idempotency keys, outbox): read, left intact. The refactor routes
  more code through the same checks; it does not add or remove any.

## Prioritized plan

| Priority | Item | Risk | Done here? |
| --- | --- | --- | --- |
| P0 | Characterization tests around every seam about to move | none | yes |
| P1 | Delete proven-dead modules | low | yes |
| P1 | One webhook prelude for Twilio routes that share it | low (contract pinned by tests) | yes |
| P1 | One tenant feature gate for `/api/app` | low (401/402 bodies pinned for all methods) | yes |
| P1 | Shared infra helpers (pool cache, escapers, Resend, time zone, base64url, roster phones, plan guards) | low | yes |
| P2 | Split the receptionist engine where code captures nothing | low–medium | yes (16 functions) |
| P2 | Shared simulation engine for the demo and the owner's test call | low | yes |
| P3 | Re-shape the other four large factories (smaller dependency sets) | medium–high | **deferred** |
| P3 | Split the three 1,200+ line React forms | medium (visual regressions) | **deferred** |
| P3 | Behaviour-changing unifications (see owner decisions) | needs sign-off | **held** |

## Changes made

### Shared helpers (new files)

| File | Replaces |
| --- | --- |
| [src/lib/escape.ts](../src/lib/escape.ts) | `escapeHtml` ×3, `escapeXml` + `escapeSsmlText` (re-exported under the old names so callers did not change) |
| [src/lib/resend-client.ts](../src/lib/resend-client.ts) | the two lazy Resend singletons (`null` when `RESEND_API_KEY` is unset, as before) |
| [src/lib/time-zone.ts](../src/lib/time-zone.ts) | 4 validators (`slots.ts` re-exports it) |
| [src/lib/base64url.ts](../src/lib/base64url.ts) | 2 encode/decode pairs (byte-identical to Node's `base64url`, tested) |
| [src/lib/postgres-pool.ts](../src/lib/postgres-pool.ts) `createPostgresPoolCache` | the `pools` Map + `getPool` in 7 stores; each store still owns its own cache, built through `createPostgresPool` so the Worker request scope and the idle-error listener are unchanged |
| [src/product/receptionist/roster-phones.ts](../src/product/receptionist/roster-phones.ts) | `ownerPhone` / `primaryPhone` ×2 |
| [src/product/receptionist/simulation.ts](../src/product/receptionist/simulation.ts) | engine set-up + `planMessages` in `demo.ts` and `business-test.ts` |
| [src/components/home/accent-headline.tsx](../src/components/home/accent-headline.tsx) | `accentHeadline` ×2 |

`saas/plan-catalog.ts` now re-uses `isPlanId` / `isPublicPlanId` from `entitlements.ts`
(the single plan → feature source, as the SaaS README already required).

### Twilio webhook prelude

[`readVerifiedTwilioForm(request, maxBytes = 32 KiB)`](../src/product/missed-call/twilio-webhook-auth.ts)
does the size cap, form parse and signature check in one place and returns either the
params or the exact response the routes sent before: **413** `{error:"Payload too large"}`,
**400** `{error:"Invalid form"}`, **403** `{error:"Invalid signature"}`. Used by
`twilio/sms/status`, `twilio/voice/status`, `twilio/voice/inbound` (keeps its own 8 KiB
cap) and `webhooks/twilio/relay-ended`.

Left as they were, because they differ on purpose: `twilio/sms/inbound` (answers
"Invalid form" for an oversized body too) and `voice/receptionist/[step]` (256 KiB cap,
must never fail a live call).

### Tenant feature gate

[`requireTenantFeature(feature)`](../src/product/saas/tenant.ts) =
`requireTenantContext` + `tenantHasFeature`, returning `{ ok: true, ctx }` or the same
response the routes built by hand: **401** `"Not authenticated."` / `"Organization is not
active."`, **402** `{ error: "Feature not included in your plan.", feature, upgrade }`.
29 gates in 18 route files now read:

```ts
const c = await requireTenantFeature("crm");
if (!c.ok) return c.response;
```

Left alone: `timeline` (OR of two features) and `settings` (gate depends on the body).
The existing behaviour that `unauthorizedTenantResponse` answers 401 even for a
membership-level 403 is **kept** as a contract; changing it is an owner decision.

### Receptionist engine split

Pure functions moved out of the `createReceptionistEngine` closure, verbatim, with their
comments:

- [voice-plans.ts](../src/product/receptionist/voice-plans.ts): `voiceOf`, `listen`, `say`,
  `openingFor`, `afterHoursNotice`, `appendEnglishHint`, `hangupPlan`, `sipHandoffPlan`,
  `policyMessagePlan`.
- [call-session.ts](../src/product/receptionist/call-session.ts): `cleanDuration`,
  `bareSession`, `mergeFlags`, `mergeUrgency` (with `URGENCY_RANK`),
  `emergencyTransferAllowed`.
- `reportBookingFailure` and `withinBudget` moved to module scope in `engine.ts`.

A comment-by-comment diff against the original confirmed no comment was lost or moved to
the wrong function. The engine's public API (`createReceptionistEngine` and its returned
methods) did not change.

### Ops and cron gate

[`guardOpsRequest(request, action, authorized?)`](../src/lib/ops-auth.ts) replaces the
block every scheduled endpoint repeated: `authorizeOpsRequest` → `logOpsAccess` → refuse
a production request without `X-Ops-Actor` unless it carries `x-vercel-cron`. Responses are
unchanged: **401** `{error:"Unauthorized"}`, **403** the `X-Ops-Actor` message. The old
`audit.missingActor && !isCron` test was redundant (`missingActor` already excludes cron
requests), so dropping it changes nothing. Routes with their own secret pass the result
as `authorized`, evaluated before the audit entry as before: `notifications/tick` and
`daily-summary/tick` (`authorizeNotificationJob`), `gmail/sync/tick`
(`authorizeGmailCron`), `monitoring/tick` and `monitoring/watch` (`MONITORING_SECRET` or the
ops bearer). Converted: `automations`, `billing/overage-invoices`, `calendar/google`,
`gmail/sync`, the seven `growth/*` ticks, `missed-call/escalations`, `monitoring/tick`,
`monitoring/watch`, both `notifications` ticks, `receptionist/tick`,
`scheduling/reconcile` (GET), `starter/quotes`.

Left alone: routes that read `audit.actor` afterwards or have no actor requirement
(`missed-call/leads*`, `missed-call/ops/*`, `receptionist/calls*`, `ops/demo/reset`,
`missed-call/retention/tick`, sandboxes). Adding the actor requirement there would change
the ops contract.

### Shared pool location

`getPgPool`, `setPgPoolForTests` and `closePgPool` moved verbatim from
`missed-call/postgres-store.ts` to [`src/lib/postgres-pool.ts`](../src/lib/postgres-pool.ts).
Billing, rate limiting, health, notifications and 30 other modules imported the SMS
store only to reach this pool. The store re-exports the three functions, so existing
tests and scripts keep working and both paths share one singleton. `lib/rate-limit.ts`
keeps its lazy `import()` (now of `./postgres-pool`) so `pg` stays out of the proxy path.

### Small duplicates

- `email-automation/store.ts` re-exports `normalizeEmail` from `saas/store.ts` (identical
  body; `saas/store.ts` imports only types).
- `notifications/daily-summary.ts` re-exports `usableTimeZone` from `scheduling/slots.ts`.
  Same fallback (`America/Toronto`) and same result for every input: both reject an empty
  value and both rely on `Intl` throwing for an unknown zone.
- `missed-call/crm.ts`: `(lead as any)[field]` with an `eslint-disable` is now a
  `Record<string, unknown>` cast. The field and value were already validated.

Still **not** done, per owner decision 1: `email-automation/postgres-store.ts` keeps its
raw `new Pool`.

### Deleted

The four dead files above. `BookingForm`'s `app.bookings.*` i18n keys are now unused;
they were **kept** (FR/EN parity is still exact) pending an owner decision.

## Tests added

| File | Tests | Pins |
| --- | --- | --- |
| `tests/unit/twilio-webhook-prelude.test.ts` | 16 | 413 by body and by `Content-Length`, 400 on a broken stream, 403 on a forged signature in production, for the 4 routes |
| `tests/unit/tenant-feature-gate.test.ts` | 55 (8 skipped: plans that include the feature, nothing to deny) | 401 without a session, 401 for a suspended organization, 402 body + `upgrade` plan for every gated method of the 18 routes |
| `tests/unit/kan30-shared-helpers.test.ts` | 14 | escapers, base64url vs Node, time zones, pool-cache identity, plan guards, roster phones, `planMessages` |
| `tests/unit/ops-auth.test.ts` (extended) | +5 | `guardOpsRequest`: 401 before auditing, 403 without actor in production, operator and cron pass, no actor needed outside production, default bearer check |
| `tests/unit/receptionist-voice-plans.test.ts` | 18 | keypad rules per call step (10-digit callback number, 1-key menu/slot), prompt voices, fixed plans, English hint, opening, `cleanDuration`, urgency never downgrades, emergency-transfer matrix, `bareSession` |

The first three were run against the unchanged code first. The voice-plan tests were
added after the move because the functions were not reachable from a test before (they
were closure-local). They cover paths no existing scenario exercised: no receptionist
test reached the `callback_number` step, and no test checked that urgency never
downgrades.

### Mutation spot-checks

To prove the tests guard the moved code, one deliberate bug was put in each seam, the
matching tests were run, and the file was restored (SHA-256 checked):

| Mutation | Result |
| --- | --- |
| `listen`: callback number takes 11 digits instead of 10 | caught |
| `listen`: callback-number step loses keypad input | caught |
| `mergeUrgency`: comparison reversed (downgrades) | caught |
| `emergencyTransferAllowed`: after-hours rule inverted | caught (existing scenarios and new tests) |
| `cleanDuration`: rejects exactly 24 h | caught |
| `planMessages`: consecutive repeats no longer dropped | caught |
| `createPostgresPoolCache`: cache never stores the pool | caught |
| `requireTenantFeature`: plan check removed | caught (11 failures) |
| `readVerifiedTwilioForm`: signature check skipped | caught (5 failures) |

The first two and the urgency one **survived** the pre-existing suite and were only
caught after `receptionist-voice-plans.test.ts` was added. That was a real coverage gap,
not a gap the move introduced.

## Test results

Run locally on 2026-11-21 in `.worktrees/kan-30-refactoring` (Windows, Node 24.13, ICU tz
2025b), with all changes from both passes applied.

| Check | Command | Result |
| --- | --- | --- |
| REF-01 TypeScript | `npx tsc --noEmit -p tsconfig.json` | pass, 0 errors (after deleting stale `.next/types` from an older build) |
| Format (CI scope) | `npm run format:check` | pass |
| Lint | `npm run lint` (`--max-warnings=0`) | pass |
| i18n parity | `npm run check:i18n` | pass |
| Committed secrets | `npm run check:secrets` | pass |
| REF-03 Unit tests | `npm run test:unit` | 3,771 tests: 3,759 pass, 11 skipped (no test database URL), 1 failure, then fixed and re-run (below) |
| QA suite | `npm run test:qa` | 2 / 2 pass |
| REF-02 Production build | `npx next build --webpack` | pass: compiled, 195 / 195 pages generated |

The one unit failure was `rate-limit-policy.test.ts` › "exempts only routes that prove who
is calling". It checks route source text for a known authentication call.
`twilio/sms/status` and `twilio/voice/status` now authenticate through
`readVerifiedTwilioForm`, which calls `assertTwilioWebhook`, so the text no longer
matched. `readVerifiedTwilioForm` and `guardOpsRequest` were added to the accepted
proofs; the four affected files (`rate-limit-policy`, `ops-auth`,
`twilio-webhook-prelude`, `twilio-webhook-auth`) then passed 57 / 57. No route lost its
authentication.

## What was not verified

- **Browser and E2E** (`npm run test:e2e`, REF-05, REF-06, REF-12): not run in this pass.
  No page, component or client code changed in the second pass.
- **Turbopack build**: `npm run build` (Turbopack) stops before compiling in this worktree,
  because its `node_modules` is a junction to the main checkout and Turbopack will not
  resolve `next` outside the worktree root. That is a property of the local setup, not of
  the code. The webpack build above compiles the same sources. CI builds from a normal
  install.
- **Cloudflare artifact** (`npm run build:cloudflare`, `check:cloudflare-bundle`): not
  run. The shared-pool move keeps `createPostgresPool`, so the Worker request scope is
  unchanged, but the bundle itself was not built.
- **PostgreSQL integration suites**: the 11 skipped tests need the `*_TEST_DATABASE_URL`
  databases that CI provisions (REF-04, REF-11). CI must be green before merge.
- **Live providers** (Twilio, Bland, Stripe, Google, REF-07 to REF-10): no live call, SMS,
  payment or calendar sync was made. Webhook contracts are covered only by unit tests.
- **Performance** (REF-14): no benchmark. Nothing on a hot path gained work: the ops gate
  runs the same three checks, and the pool move changes only where the module lives.
- **Time-zone test on older ICU**: on the `Ara` branch, `call-activity.test.ts` expects
  B.C.'s permanent UTC-7 from November 2026, which tz 2025b does not know yet. It
  passed in this worktree. Use Node 22 with current ICU, as in CI.

## Owner decisions open

1. **`email-automation/postgres-store.ts` builds a raw `new Pool`.** It bypasses the Worker
   request scope and the idle-error listener every other store gets from
   `createPostgresPool`. Moving it onto the shared cache is very likely a fix, but it
   changes runtime behaviour on the Worker, so it was not done here.
2. **The 4-entity `escapeXml` in `twilio/sms/inbound` and `twilio/voice/inbound`.** It does
   not escape apostrophes. Using the shared escaper is harmless XML-wise but changes the
   TwiML bytes Twilio receives.
3. **`unauthorizedTenantResponse` always answers 401**, even when the underlying reason is
   a 403 (membership / role). Kept as is; changing it changes the API contract.
4. **Shared Resend client.** The two email modules now share one lazy client. In
   production the key is constant, so this is identical; a test that changes
   `RESEND_API_KEY` between sends in one process would now reuse the first client.
5. **Orphan i18n keys** `app.bookings.*` (from the deleted `BookingForm`): delete or keep.
6. **Unused barrels** `missed-call|receptionist|saas/index.ts`, the 17-file
   `components/demo-video` tree, and the test-only `lib/tenant-cache.ts`: keep or remove.
7. **Deferred refactors** below: schedule as their own tickets or not.

## Deferred work

- **Large factories** (`scheduling/service.ts`, `missed-call/engine.ts`,
  `sms-automation/service.ts`, `notifications/service.ts`): nothing meaningful is movable
  without redesigning their dependency sets. Suggested route: one ticket per module,
  characterization tests per public method first, then split by concern (for example
  slot search vs reservation vs confirmation delivery in scheduling).
- **Large React forms** (`AppointmentDesk`, `BookAuditForm`, `ReceptionistSettingsForm`):
  split into section components behind visual-regression screenshots. Not attempted here
  because the brief forbids design changes and there is no screenshot baseline yet.
- **The remaining 30 receptionist engine inner functions** use the engine's store, clock
  or brain; moving them means passing those explicitly. Possible, but each needs its own
  tests.

## Changes for the KAN-29 guides

The KAN-29 guides (`docs/architecture.md`, `contributing.md`, `security.md`,
`api-reference.md`, `database.md`, `integrations.md`, `workflows.md`,
`diagrams/sequences.md`) are still uncommitted in `.worktrees/kan-29-documentation`, so
they are not edited here. When both land, update:

| Guide | Line today | Change |
| --- | --- | --- |
| `architecture.md` (Known structural limits) | "`receptionist/engine.ts` about 2,700 lines" | about 2,500 lines, with `voice-plans.ts` and `call-session.ts` holding the pure parts; link this document |
| `contributing.md` (Large files) | "Prefer extracting a pure function…" | add: shared helpers live in `src/lib/escape.ts`, `time-zone.ts`, `base64url.ts`, `resend-client.ts`, and `createPostgresPoolCache`; use them instead of a local copy |
| `api-reference.md` (auth table, `session` row) | lists `requireTenantContext` and module guards | add `requireTenantFeature` as the single-feature gate (same 401/402) |
| `api-reference.md` + `integrations.md` (`twilio-signature`) | `assertTwilioWebhook` | add `readVerifiedTwilioForm` (413 / 400 / 403) as the route prelude that calls it |
| `database.md` (pools) | "Pools are created only through `createPostgresPool`" | add `createPostgresPoolCache` for per-store caches and `getPgPool` (now in `src/lib/postgres-pool.ts`) for the shared pool; note the `email-automation` exception |
| `security.md` / `api-reference.md` (ops bearer) | `authorizeOpsRequest` + `logOpsAccess` | add `guardOpsRequest` as the gate scheduled endpoints use (401 / 403 `X-Ops-Actor`) |
| `diagrams/sequences.md` (Twilio inbound/status) | `assertTwilioWebhook` | optionally `readVerifiedTwilioForm` |

## Files changed

New: `src/lib/{escape,resend-client,time-zone,base64url}.ts`,
`src/product/receptionist/{roster-phones,simulation,voice-plans,call-session}.ts`,
`src/components/home/accent-headline.tsx`, the four test files above, this document.

Deleted: `src/lib/store.ts`, `src/product/scheduling/ai-booking.ts`,
`src/components/motion/Reveal.tsx`, `src/components/app/BookingForm.tsx`.

Modified: 18 `/api/app` routes, 4 Twilio routes, 7 Postgres stores, `lib/postgres-pool.ts`,
`lib/email.ts`, `lib/business-notifications.ts`, `email-automation/{template,services,unsubscribe}.ts`,
`receptionist/{engine,voice,speech-style,config,profile,demo,business-test}.ts`,
`missed-call/{client-config,twilio-webhook-auth}.ts`, `scheduling/slots.ts`,
`saas/{tenant,entitlements,plan-catalog}.ts`, `app/[locale]/page.tsx`,
`components/home/HomeMobile.tsx`, `components/app/AvailabilityEditor.tsx`, and the
receptionist and SaaS module READMEs.

Second pass: `lib/ops-auth.ts`, 19 ops/cron routes, `lib/postgres-pool.ts`,
`missed-call/{postgres-store,crm}.ts`, `lib/rate-limit.ts`, the 36 modules that imported
`getPgPool` from the SMS store, `email-automation/store.ts`,
`notifications/daily-summary.ts`, `tests/unit/ops-auth.test.ts`,
`tests/unit/rate-limit-policy.test.ts` (adds `guardOpsRequest` to the list of accepted
authentication proofs for routes exempt from the address rate limit).
