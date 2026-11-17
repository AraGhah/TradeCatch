# Call activity and phone numbers (KAN-15)

How a phone call becomes a row in the dashboard, what was wrong with each step,
and what was changed. Written after reading the code; nothing here was
confirmed against production data or a live provider (see "Not verified").

## The path of a call

```
Twilio number ─ voice webhook ─► /api/webhooks/twilio/voice ─► receptionist "incoming"
              └ status callback ► /api/webhooks/twilio/status ─► receptionist "status"
Bland agent  ─ post-call webhook ► /api/bland/webhook  (X-Webhook-Signature, HMAC)
LiveKit agent ─ tool calls / report ► /api/receptionist/agent-*  (bearer secret)
                                      │
                                      ▼
              rc_call_sessions (Postgres, one row per provider call id)
                                      │
   /app/calls page · /api/businesses/[id]/calls · /api/businesses/[id]/ai-receptionist/calls
```

One row per call: `call_sid` is UNIQUE and every writer uses
`insertSessionIfAbsent` (`ON CONFLICT (call_sid) DO NOTHING`), so a repeated
webhook can only find the existing row. Ids: Twilio `CA…`, Bland `bl_…`,
LiveKit `lk_…`. Updates use an optimistic `version` check. The Postgres store is
mandatory in production (`runtime.ts` refuses the memory store), so a refresh
cannot lose a call to a per-isolate store.

A second, separate path exists: numbers bought through TradeCatch provisioning
point at the Module A (missed-call text-back) routes, `/api/twilio/voice/inbound`
and `/api/twilio/voice/status`. Those write Module A's own call/lead tables
(`mc_calls`) and never `rc_call_sessions`, so they did not appear on
`/app/calls` (problem 10 below, fixed by reading both at display time).

## What was wrong

| # | Problem | Effect |
|---|---|---|
| 1 | Seven hand-written number normalizers; the dashboard printed raw `+15145551234`, and the lead list used `514-555-1234`. | No `(514) 555-1234`; international numbers unformatted; `514 555 1234 x22` became `+514555123422` in `normalizeE164` (extension digits appended to the number). |
| 2 | `startCall` returned early, with no record, when the receptionist was off, outside its hours, or routing rejected the call. | A real call to a known business left nothing in the history. |
| 3 | A status callback for a call that was never saved was dropped (`handleCallStatus` returned). | If the `incoming` write failed once, the call was lost for good. |
| 4 | A status callback that arrived after the call was finalized (the 30-minute stale sweep) changed nothing. | The real duration was never recorded. |
| 5 | A call handed to the LiveKit agent leaves two records, and the routing one was always hidden. | If the agent's report never arrives, the call is invisible. |
| 6 | An end-of-call report that created the record dated the call from its hang-up. A report after the sweep was discarded. | Wrong start time; a delayed webhook could not complete the call. |
| 7 | The calls page swallowed every load error and rendered "no calls yet". | A database fault looked like an empty history. |
| 8 | The page formatted dates with `toLocaleString` on the server (UTC on a Worker) and the history component in the viewer's zone. Duration showed as `300s`. | Times in the wrong zone; hard-to-read durations. |
| 9 | The status step's one `try/catch` logged and gave up. | A failed save was visible only as a log line and left no retry or incident. |
| 10 | Calls taken by the missed-call text-back path (Module A) were never read into `/app/calls`. | A real call to a provisioned number was missing from the history. |
| 11 | A call the receptionist never handled was recorded quietly: nobody was told. Owner SMS/email printed `+1 514-555-0123` (the emergency alert and the summary headline printed the raw E.164). | The owner found out about a declined or unreported call only by opening the dashboard; numbers in alerts were not in the display format. |

Problems 2–6, 9 and 11 are reproduced by tests; which of them cost a production
call is not known (no production data was read).

## What changed

- `src/lib/phone.ts` (new, on `libphonenumber-js/min` 1.13.15): `parsePhone`,
  `toE164`, `normalizeProviderNumber`, `formatPhone`, `isWithheldCaller`.
  Rules: E.164 is the stored form; `(514) 555-1234` for any `+1` number; other
  countries in international grouping; an extension is returned separately and
  shown as `ext. 22`; an unreadable value is returned unchanged, never
  guessed. A seven-digit local number is refused (it would be stored as a number
  with no area code). `isPossible()` gates, not `isValid()`, so test and
  newly issued ranges are not refused.
  `formatPhoneDisplay` and the caller-policy withheld list now use it.
  `parsePhoneInput` is unchanged on purpose: it still refuses a number typed with
  an extension, and `tests/unit/dashboard-qa-fixes.test.ts` pins that.
- `CallSession.activity` (optional, JSON only): `provider`, `direction`,
  `origin`, `providerStatus`, `declinedCode`, `startDerived`.
- `engine.startCall`: numbers stored as E.164; `activity` set; a declined call to a
  known business is saved as a finished, quiet record (no summary, no text, no
  lead) before the caller's answer.
- `engine.handleCallStatus`: idempotent and order-safe. Creates the record from
  the callback's own `From`/`To`/duration when none exists (inbound parent calls
  only; never a leg the platform dialed out; never a number that is not a
  business's). After finalization it fills only a blank duration/status, so the
  first real value wins and nothing is re-sent.
- `status-recorder.ts`: the status step retries a failed save twice (150 ms,
  600 ms), then logs `status_finalize_failed` (no caller number) and opens a
  reliability incident. Safe to repeat.
- `agent-calls`: a report that creates the record dates it `now - duration`
  (`startDerived`); a report after finalization adds the real duration and
  transcript to the same record, never a purged transcript, and sends nothing.
- `ownerVisibleCalls`: sorted newest first; a handoff routing record is hidden
  only when the agent's report exists (one-to-one, closest in time, same business
  and caller, withheld callers pair with any). Otherwise it stays, and reads
  "Handled by the voice agent (summary not received)".
- `callState`: `in_progress | completed | missed | unanswered | failed | unreported`.
- Dashboard: `/app/calls` shows an error state instead of an empty one, formats
  numbers, shows the business's local time and `5m 00s`, the dialed number and
  the state. The two list APIs return `state`, `direction`, `provider`,
  `toE164`, and `timezone`; a store failure is a logged 503, not `[]`.
- `postgres-store`: accepts an injected pool (tests run the real SQL on PGlite).
- **Module A calls on `/app/calls`** (`receptionist/call-feed.ts`): the page and
  `GET /api/businesses/[id]/calls` read the receptionist's sessions and Module A's
  `mc_calls` for the signed-in business and merge them, newest first. Read-only:
  a Module A call is converted when listed (`activity.origin = "missed_call"`,
  its own disposition) and is never written to `rc_call_sessions`, so there is
  nothing to backfill or duplicate. A call both paths know (same provider call
  id, hidden handoff routing records included) is shown once, as the receptionist's
  record. Only what Module A recorded is shown: no dialed number, outcome,
  summary or language is invented. A Module A read failure keeps the receptionist's
  calls and shows "this list may be incomplete" (`incomplete: true` in the API);
  a receptionist read failure is the error state. Records from another business
  are dropped even if a store returned them. The dashboard overview's call
  counts are unchanged (they count receptionist calls only).
- **The owner is told about a call the receptionist never handled**
  (`engine.alertOwnerOfUnhandledCall`): a declined call (deactivated, outside its
  hours, routing rejected) and a call known only from a `no-answer`, `busy`,
  `failed` or `canceled` status callback. The owner gets the usual SMS and email
  (their own muted channels and "emergencies only" setting apply), worded
  "Not taken by the receptionist — call back" or "Missed call — call back".
  The caller is never texted and no CRM lead is made. The alert is claimed by
  saving the summary first, so a retried webhook alerts once; on a declined call
  it is sent after the caller's answer (`defer`); deliveries are recorded on the
  call so the existing notification retry job re-sends a failed one. A
  status-only `completed` call is listed but not alerted (it may well have been
  answered), and practice calls (`sim_`, `demo_`) never alert.
- **Numbers in owner alerts**: SMS, email, the emergency alert and the summary
  headline/next step use `(514) 555-1234` (international numbers in international
  grouping). A withheld caller is not printed as a number ("unknown number").

## Database changes

None. Everything is optional JSON inside `rc_call_sessions.data`; no migration,
no backfill, no `CHECK` change. Existing rows read exactly as before:
numbers are normalized when shown, not rewritten, and a row without `activity`
is classified from its status and outcome. Rows are never deleted or edited by
this change except to add a missing duration/status to a call that lacked one.

## Deploy notes

- Nothing to apply in the database. The new dependency must be installed
  (`npm ci`).
- The receptionist status callback must be set on the number
  (`/api/webhooks/twilio/status`); the voice webhook alone cannot report how a
  call ended. `docs/AI_CALL_ROUTING.md` has the command.
- Bland: `BLAND_WEBHOOK_SECRET` must be set, otherwise the webhook answers 503
  and Bland's report never lands (problem 5 then applies to every call).
- `libphonenumber-js/min` adds roughly 80 KB to the browser bundle of the pages
  that format numbers.
- Both this branch and `kan-14-privacy-settings` edit `engine.ts` and the Twilio
  `[step]/route.ts`; expect to resolve textual conflicts when the second merges.

## Tests

`tests/unit/phone-format.test.ts` (CALL-01, CALL-02, extensions, refusals),
`tests/unit/call-activity.test.ts` (CALL-03 to CALL-14 on the memory store and on
the real SQL on PGlite), `tests/unit/call-activity-webhooks.test.ts`
(signature check, one record however often reported, no leg or stranger's
number recorded), `tests/unit/call-activity-feed.test.ts` (Module A calls
listed once, newest first, this business only, failures said),
`tests/unit/call-activity-owner-alerts.test.ts` (owner alerted once, never the
caller, readable numbers, withheld callers, failures recorded) and
`tests/call-activity.spec.ts` (browser smoke). PGlite is optional tooling; those
cases skip without it.

## Not verified

- Production data, the live Twilio/Bland/LiveKit accounts, and Cloudflare logs
  were not read. Which numbers use which webhook set is unknown.
- Bland's post-call payload has no documented start/end timestamp in this repo,
  so none is used; the derived start is `now - duration` and is flagged.
- The call-event timeline (`telephony events`) still stores `from=… to=…` in its
  detail text; it is a per-business record, not a log, and was left as is.
- Module A's own SQL (`mc_calls`) was read through its memory store in tests;
  its Postgres `listCalls` is existing, unchanged code and was not run here.
- No real SMS or email was sent: the owner alerts are proven with the in-memory
  SMS port and a capturing email function.
- Module A's technician job-card and reply texts (`missed-call/messaging.ts`
  `technicianAlertBody`, `technicians.ts` `buildJobCardSms`, and the "Appelez le
  client" reply in `missed-call/engine.ts`) still print the raw E.164
  (`Tel: +15145551234`). They go to the on-call technician, not to the owner's
  receptionist alert, and were left as is; say if they should match.
- The dashboard overview counts receptionist sessions only, and counts a handed-off
  call's routing record and the agent's record separately. Left as is: its KPIs are
  a different widget.

## Open decisions

- Whether an owner who deliberately switched the receptionist off wants an alert
  for every call it declines. They get one each time today (the owner asked for
  this); the per-channel mute and "emergencies only" settings turn it down.
