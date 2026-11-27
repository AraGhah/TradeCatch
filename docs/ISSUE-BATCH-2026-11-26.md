# Issue batch, 2026-11-26

Six issues, handled by severity, developed on branch `tradecatch-issue-batch`
(based on 9fc4e36e).

| # | Issue | Severity | State |
|---|-------|----------|-------|
| 5 | Receptionist settings do not reach the receptionist | Critical | Fixed in code, tested; live calls and agent redeploy pending (owner) |
| 4 | No email to the customer on a website decision | High | Built and tested; real delivery pending (owner approval) |
| 3 | Call summary email hard to read, outcomes look alike | Medium | Done, rendered on desktop and phone widths |
| 6 | Pricing copy and Professional hierarchy | Medium | Done, EN and FR |
| 1 | Dashboard spacing, account page | Low (visual) | Done |
| 2 | Homepage phone animation | Low (visual) | Done |

## 5. Receptionist settings sync (critical)

The voice path is Twilio, then SIP, then the LiveKit agent (`agents/receptionist`). Bland is not in it. The agent reads
`GET /api/receptionist/agent-config?number=` on every call.

Root causes found, each fixed:

1. Personality and communication style were saved but never put in the agent's instructions. They are now a section,
   capped at 800 characters (`agent-config.ts`).
2. Transfer ring time and the failed transfer action were never sent. They are now `transferRingSeconds` (clamped to
   10 to 60 s by the agent, `transfer.py` `with_business_ring_time`) and a failed transfer rule in the instructions.
3. "Ask for a preferred time" was ignored. When it is off, the agent is told not to ask.
4. The transfer number edited on the Receptionist page was shadowed by `phoneSettings.humanTransferE164`, so the old
   number kept being dialed. The dashboard save now mirrors it there (`ai-receptionist-service.ts`).
5. The Receptionist form posted `transferHours: "always"` and fixed conditions, silently resetting what other pages set.
   It now sends back what it loaded.
6. Six appointment fields on the Receptionist form saved values nothing read: the scheduling module is the source of
   truth. They are replaced by a link to Availability.
7. `PUT /api/app/receptionist` replaced the whole settings object, wiping phone settings, voices and collected fields.
   It now merges into the stored profile.
8. Each Worker instance caches profiles for 30 s, so a test call right after saving could get the old settings. The
   runtime now records each profile's `updatedAt` and refreshes when the database row is newer (`lineState`).

Tests: `tests/unit/receptionist-settings-sync.test.ts` (8), agent `test_transfer.py`.

Not fixed, owner decision: `callHandlingMode` (business hours, after hours, overflow) is not enforced on the direct
SIP to LiveKit path. It needs Twilio routing, not agent code.

## 4. Website decision emails

There was no customer notification at all. Now, when an admin moves a request to approved or rejected:

- Rejection requires a reason for the customer (at least 5 characters), separate from the internal note.
- The customer gets one email in the language they submitted in: domain, new status, decision date, reason (rejection
  only), next steps, link to their requests.
- Dedupe: a history marker per request, status and decision time, plus the Resend idempotency key.
- The outcome (sent, failed, not configured) is written to the request history and shown to the admin. A failure is
  retried on the next save.

Tests: `tests/unit/website-decision-email.test.ts`, including PostgreSQL through PGlite.

Risk: production may be missing migration 041 (admin console). Check before relying on this.

## 3. Call summary email

Each section was its own table with no fixed label column, so values did not line up, and every outcome looked the
same. Now one fixed label column for every row, a status banner (emergency, booked, transferred, follow-up, no action;
emergency always wins), and labels stack above values under 480 px. Test: `tests/unit/owner-call-email-layout.test.ts`.

## 6. Pricing

- Professional: "Recommended" badge in solid orange, orange top edge, deeper shadow, tagline "The complete receptionist:
  it answers, qualifies and books the job.", outcome describing real booking, confirmation and reminder.
- Essential now says plainly that appointment requests go to the team to confirm.
- Step-up and comparison intro rewritten to the real difference.
- Live transfer and emergency routing are deliberately not advertised: the launch flag is off and production transfer is
  off (`AGENT_TRANSFER_MODE`). `plan-catalog.test.ts` bans transfer wording in capabilities for this reason.

## 1. Dashboard

- One card style (`src/components/app/card-classes.ts`) used across 32 dashboard files that had five padding variants.
- One content width (1240 px) and gutter for every dashboard page (`AppShell.tsx`).
- Account management: two columns on large screens (profile, team, requests on the left; setup steps, security and
  billing on the right, sticky), two-column form fields, role pills, a separated deletion area. Every control, role
  check and message is unchanged.

## 2. Homepage phone

`src/components/ui/call-journey-phone.tsx`, translated on the server by `call-journey-preview.tsx`.
After integration, this call journey appears on the sign-in panel; the homepage
uses the separate missed-call workflow demonstration.

- Bigger (300 px) with side buttons, island and status bar.
- One loop of about 23 s: ring, answer, conversation with a live waveform, job details ticked off, booking (or the
  request sent to the team when scheduling is not verified), the owner's notification and dashboard row.
- Screens crossfade, so the end of the loop fades into the next ring with no reset.
- Waveform: 20 bars, each with its own speed and phase. Caller and receptionist use different colours, and the bars
  settle between lines.
- A rail beside the phone shows where the information goes (below it on phones).
- It pauses off screen and in a hidden tab, and it has a pause button. With reduced motion it shows a still frame until
  the visitor presses play.

## Verification

- `npx tsc --noEmit`: clean.
- `npm run test:unit`: 3949 tests, all pass (11 skipped). One French price needed its non-breaking space back.
- Agent: `python -m unittest discover`: 324 run, OK, 6 skipped. pytest and LiveKit are not installed locally.
- Browser, e2e harness on :3100 (in-memory, no production): home EN/FR desktop and phone, reduced motion, pause and
  play, pricing EN/FR and phone, account page desktop, FR tablet and phone, account save persists after reload, no
  console errors.
- Emails rendered at 700 px and 375 px.
- The harness rebuilt `.next` with test settings: rebuild before any deploy.

## Owner steps

1. `lk agent update-secrets --secrets "AGENT_TRANSFER_MODE=warm"`, then redeploy the agent (also ships
   `transferRingSeconds`).
2. Deploy the Worker.
3. Change a setting, then make a live call in French and in English to confirm it applies.
4. Approve one real website decision email to a test address to confirm delivery.
5. Decide how `callHandlingMode` should work on the LiveKit path.
6. Check that migration 041 is applied in production.
