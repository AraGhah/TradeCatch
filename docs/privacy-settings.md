# Privacy settings

Page: **Settings → Privacy** (`/app/receptionist/privacy`, French `/fr/app/receptionniste/confidentialite`).
API: `GET` / `PATCH /api/businesses/{id}/privacy`.
Code: `src/product/privacy/` (settings, store, retention job, runtime).

Only settings that change what TradeCatch does are offered. Everything below names the
code that enforces it.

## Settings

| Setting | New business default | Existing businesses (migration 040) | What it does | Enforced in |
| --- | --- | --- | --- | --- |
| `callRecordingEnabled` | off | on only if the owner had switched recording on before (either the old Privacy page switch or the old Phone settings switch), otherwise off | The only audio TradeCatch records is the voicemail taken when the receptionist cannot handle a call and there is no fallback line. **On:** the caller hears that the message will be recorded and can hang up before the beep (unchanged wording). **Off:** no `Record` verb is emitted and the caller is never told to call back. A fallback line, if configured, still rings. Otherwise the caller hears that a text message is coming and the call ends, and the missed-call text-back is sent immediately (`engine.sendFailSafeTextBack`, fired after the response by the route). It dedupes on the call id, so finalizing the same call cannot send a second text. If the business has text recovery off (`smsRecoveryOnIncomplete`), or the caller's number is unknown (blocked or anonymous), no text is promised: the caller hears that the team will see the call and get back to them, and the call is logged and summarized to the owner as usual. | `engine.ts` `failSafePlan` |
| `saveCallTranscripts` | on | on | **Off:** when a call is finalized, the summary (caller, need, callback number, AI summary) is built from the transcript first. The turns are then dropped before anything is sent or stored, and `transcriptPurgedAt` is set. The owner still gets the summary. The call history shows "Transcript not kept". Webhook payloads carry no transcript. Existing transcripts stay until retention removes them. Covers the Twilio engine, the LiveKit agent and the Bland agent: they all finalize through the same function, and `tests/unit/bland-calls.test.ts` runs the Bland and LiveKit paths through it. Lines defined only in founder env config have no owner business, so no setting applies to them. | `engine.ts` `finalizeSession` |
| `saveSmsHistory` | on | on | **Off:** message wording is cleared 24 hours after it was sent or received. That covers CRM conversation messages, quote follow-up messages, SMS-automation logs, and receptionist/missed-call outbound texts. Sending is unaffected. Queued, sending, retrying and uncertain messages are never touched. The delivery record (who, when, status) and every opt-out and consent record stay. The SMS assistant ignores cleared messages when it builds its context. | `privacy/retention.ts`, run by `/api/missed-call/retention/tick` |
| `customerDataRetentionDays` (30 / 90 / 180) | 90 | **"Standard (current)"** (`NULL`): nothing is removed sooner than today, until the owner picks a value | Call content: the chosen period replaces the transcript retention. The receptionist tick then clears transcripts, voicemail links, caller details in summaries and booking details. Message content: wording older than the period is cleared by the same job as above. Not affected: invoices, payments, billing and usage records, opt-out and consent records, audit logs, and the CRM customer list, jobs and quotes. Missed-call workflow records keep the platform-wide 24-month policy. | `profile-loader.ts` `applyPrivacySettings` → `engine.ts` `tick`; `privacy/retention.ts` |
| `analyticsEnabled` | off | on (what happens today) | Dashboard pages (`/app`, `/fr/app`) are measured only when the business allows it **and** the person accepted analytics cookies. Unknown counts as no. When not allowed, Google's `ga-disable-<id>` switch is set, so nothing is sent, including automatic events. Marketing pages are unchanged. The switch is only shown when `NEXT_PUBLIC_GA_MEASUREMENT_ID` is configured. It currently is **not** configured in production, so the page says analytics are not used. | `lib/analytics.ts`, `components/Analytics.tsx`, `app/[locale]/app/layout.tsx` (`BusinessAnalyticsFlag`) |

### Not offered, and why

- **`shareCalendarDetails`.** Re-checked against `main` after the Cal.com integration landed. Nothing private is read, so a switch would do nothing. The page states this.
  - Google Calendar is read only through free/busy (`scheduling/google.ts`). Event titles, attendees and notes are never read, and only the events the receptionist booked are created or changed.
  - Cal.com owns availability (`freeBusy()` returns nothing). The booking list is parsed into `uid`, status, start/end, event type and TradeCatch's own `tcAppointmentId` / `tcOrgId` tags only (`scheduling/calcom/client.ts` `bookingSchema`). Attendees, titles and notes are not parsed, so they cannot be stored or logged.
  - If a future integration reads event details, it needs a stored setting that defaults to availability only.
- **`marketingEmailsEnabled`.** TradeCatch sends business owners no marketing email, so a consent switch would have no sender behind it. The page says nothing will be sent without agreement. If it is added later, it needs a stored opt-in that defaults off (CASL), checked by the sender. Searched on `main` and found only things that are not an owner's account preference:
  - `marketing_consent` on the public "Book an audit" lead form is a per-lead record taken before any account exists.
  - The email-automation module is a business emailing its own customers, with a per-contact unsubscribe.
  - Reactivation campaigns are texts to a business's customers, behind the `bulkCampaigns` launch flag.

### Data management

- **Export:** `GET /api/businesses/{id}/account/export` (existing), linked from the Privacy page through Settings → Account.
- **Deletion request:** `POST /api/businesses/{id}/account/deletion-request`.
  - Owner only. Admins, members, viewers and other businesses get 403.
  - Now requires the business name typed as `confirm`. The match ignores case and extra spaces. A mismatch returns 400 and is audited as `account_deletion_confirmation_failed`. The body is read with a 4 KB limit; an oversized or malformed body counts as a failed confirmation.
  - One open request at a time: asking again returns the open one.
  - Audited as `account_deletion_requested`.
  - The request deletes nothing itself. It enters the support review queue, and billing and legal records are kept. As before, the cloned voice is removed right away.
- Caller-subject privacy requests (`/privacy/requests`) are unchanged.

## Persistence and safety

- **Table `tc_privacy_settings`** (migration `040_privacy_settings`, `src/product/privacy/privacy-settings.sql`).
  - One row per business. Each setting is its own column, scoped by `organization_id`, with `ON DELETE CASCADE` from `tc_organizations`.
  - A `CHECK` allows only 30, 90, 180 or `NULL` as the retention period.
  - Columns `version`, `updated_at` and `updated_by`.
- **Backfill.**
  - Runs only before `040_privacy_settings` is recorded, so a repeated `npm run db:schema` never overwrites saved values.
  - A business created after the migration has no row and gets the new-business defaults.
- **Which store.** `selectPrivacyStoreKind()` in `privacy/runtime.ts`, with the same rules as the SaaS store, so settings are durable exactly when accounts are.
  - A durable flag (`MISSED_CALL_DURABLE_STORE=1` or `SAAS_DURABLE_STORE=1`) with `DATABASE_URL` uses Postgres.
  - A durable flag without `DATABASE_URL` **throws**. It never falls back to memory: a memory store lives in one Worker isolate, so a "saved" setting would be gone on the next request that lands elsewhere. The API answers 503.
  - `SAAS_REQUIRE_DURABLE=1` in production also refuses memory.
  - Memory is only for local development and tests.
- **Saving (`PATCH`).**
  - The body is read with a 4 KB limit (`readJsonBody`): oversized gets 413, malformed JSON gets 400, and nothing is stored or audited.
  - The body names only the settings being changed, plus `expectedVersion`. Unknown fields and values outside the allowed set get 400.
  - The store locks the row (`SELECT … FOR UPDATE`), refuses a stale version with 409 and the current values, then writes only the named columns.
  - In the same transaction it writes the audit row (`privacy_settings_updated`, e.g. `callRecordingEnabled:false→true`). A failed save changes nothing and logs nothing.
- **Access.** Any member can read; only owner, admin or platform admin can change (`manage_security`); another business gets 403.
- **The page.**
  - Values are loaded from the API. If loading fails, the page shows an error and a retry button, never guessed defaults.
  - "Saved" appears only after the API confirms. The page then shows the stored values the API returned.
  - On failure, the page shows an alert. Unsaved fields keep a "Not saved" mark, and reloading shows the stored value.
  - On 409, the page shows the current stored values and explains why.
  - Only one save runs at a time.
- **Effect on calls.**
  - The receptionist reloads configs every 30 s, so a change reaches new calls within about 30 s per server instance.
  - If the settings cannot be read during a reload, calls are still answered, with recording off and transcripts not kept for that reload. Nothing is deleted early.
- **Phone settings.** The old recording checkbox there was never enforced and is replaced with a link to the Privacy page. Saving Phone settings sends the stored legacy value back unchanged.

## Deploy notes

1. Apply the migration with `npm run db:schema` **before** or with the deploy. Without the table, the Privacy page and API return 503.
   - The dashboard still loads, with analytics off.
   - The receptionist answers with recording and transcripts off until the table exists.
2. **Behaviour change to confirm.** Recording was never enforced, so existing businesses had voicemails recorded even with the switch off. After the deploy, voicemail-on-failure is taken only where an owner had switched recording on. Everyone else's callers in that rare path get an immediate text instead (see the table), never "call back later".
   - One spot still says "please call back later": the route's last-resort message when the whole receptionist runtime cannot start (`api/twilio/voice/receptionist/[step]/route.ts`). There is no business, number or settings to act on at that point, so nothing better can be promised.
3. The retention cron (`/api/missed-call/retention/tick`) now also runs the per-business pass. It returns `businessPrivacy` counts and HTTP 500 if either pass fails.
4. **Provider-side audio is outside this setting.** `callRecordingEnabled` governs audio TradeCatch records itself (the voicemail above). Bland and LiveKit calls can also be recorded by the provider, which is configured in the provider's own dashboard, not in this repository. TradeCatch stores no provider audio or recording link (the Bland webhook schema has no recording field). If a business turns recording off here, the operator should keep the provider's recording switched off for that business's line.
5. Production should set `SAAS_REQUIRE_DURABLE=1` so a missing database fails loudly instead of using memory.

## Tests

- **Unit** (`npm run test:unit`, all green on the current `main`: 2,497 tests, 2,494 passed, 0 failures, 3 skipped that need a real Postgres server):
  - `tests/unit/receptionist-failsafe-text-back.test.ts` (3). The Twilio receptionist route's error branch with recording off: a known caller hears that a text is coming and is texted once with the right number and call id; an unknown caller is not promised a text; with recording on the voicemail is unchanged. Nobody hears "call back".
  - `tests/unit/privacy-settings-store.test.ts` (14). The same contract runs on the memory store and the Postgres store via PGlite:
    - defaults
    - independent per-field saves with audit
    - stale version refused with no audit
    - concurrent saves with exactly one winner
    - business isolation
    - a failed write changes nothing
    - migration 040 backfill, re-run safety, and the retention-days constraint
  - `tests/unit/privacy-settings-route.test.ts` (39, including the store-selection rules and the oversized/malformed body case). Real signed sessions. For each of the 5 settings:
    - enable → save → reload
    - disable → save → sign in again
    - database failure → 503, no success, unchanged
    - member, viewer, other business or signed-out → refused, while an admin is allowed
    - business A's saves leave B unchanged
    - rapid saves keep the latest value, a stale save gets 409, and of two simultaneous saves one wins

    Plus: partial saves, invalid bodies, and an unreadable store returning 503.
  - `tests/unit/privacy-settings-enforcement.test.ts` (16):
    - recording on emits notice then `record`; off emits no `record` and no "call back" wording; a fallback line still dials
    - recording off: the text-back is sent once with the caller's number and call id; the "team will see your call" wording when texting is off, no sender is wired, or the number is unknown; a failing sender never fails the call
    - transcripts kept versus dropped, with the summary still sent
    - the retention period purges a 40-day-old call
    - "standard" keeps the profile retention
    - the loader routes each business's settings to its own line, and falls back safely when settings are unreadable
    - the SMS history and retention SQL on PGlite, including queued and retrying messages and opt-outs
    - the dashboard analytics gate
  - `tests/unit/account-deletion-confirmation.test.ts` (3): wrong or missing name, correct name with dedupe and audit, and non-owners refused.
- `tests/unit/bland-calls.test.ts` (4 added): Bland and LiveKit calls drop the transcript when the setting is off and keep it when on or unset, with the summary and outcome unchanged.
- **Browser** (`tests/privacy-settings.spec.ts`, 12 passed against a production build in the E2E harness on the current `main`; the account-lifecycle, notification-preferences-loading and CORS specs also passed alongside it, 31 in all):
  - a phone-width (390 px) run: no sideways scroll, every control inside the viewport, and a save that persists after reload
  - real values on load
  - per-setting change → save → reload, and change back → save → sign in again
  - 503 and network failure show an error with "Not saved"
  - load failure shows retry
  - rapid clicks and a double-click send a single save
  - a stale second tab is refused
  - business A cannot read or write B
  - deletion needs the typed name
- `tests/unit/schema-runner-repeatable.test.ts` now also checks 040. It only runs with `SCHEMA_RUNNER_TEST_DATABASE_URL` set.
