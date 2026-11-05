# AI Call Handling: smart call routing

Operator guide for the two receptionist modes, personal contacts, and the production steps the owner runs by hand. Nothing in the code changes Twilio numbers, SIP trunks, LiveKit dispatch or carrier forwarding. Every production change below is a command you run yourself.

## The two modes

| Mode | What callers get | Plans |
|---|---|---|
| **Missed Calls Only** (recommended, default for new customers) | The contractor's phone rings first. The receptionist answers only when nobody takes the call. | Receptionist (`growth`), Receptionist Plus (`receptionist`) |
| **AI Answers All Calls** | The receptionist answers at once. | Receptionist, Receptionist Plus |

Starter has no voice. The API refuses to save a mode for it (HTTP 403 `plan_upgrade_required`), and a Starter config is built with `enabled: false`.

The dashboard (`/app/calls/settings`, section **AI Call Handling**) keeps three facts apart:

- **Requested mode**: what the owner saved. Profiles saved before this feature derive it from `inboundStrategy` (`human_first` → Missed Calls Only, else AI Answers All) and are labelled "from your earlier settings". Their live behaviour is unchanged until the owner saves.
- **Effective mode**: what the current routing really does with a call. For example, Missed Calls Only with no contractor phone, or with a number still on the SIP trunk, is effectively AI Answers All.
- **Setup status**: `unsupported_plan`, `disabled`, `not_configured`, `setup_required`, `awaiting_test_call` or `verified`. The UI says "Active" only when the status is `verified`. That means a test call made after the last mode change took the expected route.

## Call paths

```
A. SIP trunk (production today)
   caller → Twilio number → Elastic SIP trunk → LiveKit inbound trunk ST_SRLKTaYtdLkd
          → dispatch rule SDR_PikdfX5ovdTB → agent "tradecatch-receptionist"
   TradeCatch sees the call only when the agent fetches /api/receptionist/agent-config.
   ⇒ Always "AI Answers All Calls". The contractor's phone cannot ring first.

B. Voice webhook (needed for Missed Calls Only on the TradeCatch number)
   caller → Twilio number → POST /api/webhooks/twilio/voice
     Missed Calls Only:  <Dial timeout=N><Number url=…/screen>contractor</Number></Dial>
        contractor presses 1  → bridged; no summary, no missed-call text, no CRM lead
        no answer / busy / declined / unreachable / voicemail (no press 1) → AI leg
        caller hangs up while ringing → missed call: SMS recovery + owner summary
     AI leg: voice engine "livekit" + RECEPTIONIST_LIVEKIT_SIP_HOST set
               → <Dial><Sip>sip:+1NUMBER@HOST</Sip></Dial> → same LiveKit agent
             otherwise, or if the SIP leg fails → built-in receptionist (gather)

C. Carrier forwarding (customers keep calling the contractor's own number)
   caller → contractor's line → (carrier: no answer / busy / unreachable, or all)
          → TradeCatch number → path A or B
   TradeCatch never rings the forwarding phone back (it would loop). Transfer,
   emergency, backup and department targets equal to that phone are dropped.
```

### Voicemail is not an answer

A carrier voicemail that picks up the ring-first leg makes Twilio report `DialCallStatus=completed`. Missed Calls Only therefore screens the leg: whoever answers hears "Press 1 to take it". The call counts as answered only after that key press is recorded (`routing.acceptedAt`). A completed leg without it goes to the AI (`routing.ringResult = voicemail_or_unscreened`). Keep the ring time shorter than the contractor's voicemail pick-up (dashboard default and cap: 10–40 s, recommended 15–20).

### Personal contacts

Up to 50 numbers, normalized to E.164. When one calls, the AI never starts. The owner picks one policy: play a short message (French and English, owner-written or default), ring an owner-chosen line, or end the call. Withheld numbers (`anonymous`, Twilio's `+266696687` and the other placeholder numbers) have their own policy: answer normally (default) or ask them to call back with caller ID shown. These calls are finalized quietly: no summary, no missed-call text, no CRM lead.

Caller ID can be spoofed, so a match only reduces what a call can do. It cannot unlock anything. The transfer target must be a Canadian geographic number. It cannot be the TradeCatch number, the caller's own number, or (with forwarding) the forwarding phone. The list never leaves the server. On path A the agent sends the caller ID to `agent-config?number=…&from=…` (`anonymous` when withheld) and gets back only this call's decision (`callerPolicy`). Agents that do not send `from` get today's behaviour.

## What is verified, and what is not

Verified by automated tests with Twilio and LiveKit simulated (`tests/unit/ai-call-routing*.test.ts`, `agents/receptionist/test_caller_policy.py`, `test_tradecatch_api.py`):

- every ring-first outcome (pressed 1, no answer, declined, busy, unreachable, canceled, voicemail, caller hang-up during ringing and after the AI)
- AI Answers All, with the built-in receptionist and with the LiveKit SIP hand-off (TwiML shape, credentials only at render time, fallback when the SIP leg fails or is not configured)
- duplicate and out-of-order Twilio callbacks: retried incoming webhook (one session, one hand-off), late dial results after finalization, stale screening callbacks, ParentCallSid mismatch, a single summary per call
- legacy profiles unchanged, mode switches, verification reset on change, plan gating, loop guards, personal-contact and withheld-number policies, no list leakage to the agent config, test-call path detection, the read-only number check (GET only, no request without credentials)

**Not verified, needs real calls on staging (procedure below):**

- Twilio's real `DialCallStatus` and `ParentCallSid` values for screened legs on Canadian carriers
- The LiveKit inbound trunk accepting `<Dial><Sip>` from Twilio Programmable Voice. It is a different source than Elastic SIP trunk origination (see step 3).
- Carrier forwarding codes on each carrier and plan
- Voice quality and latency of the extra hop (webhook → SIP → LiveKit)
- The dashboard has passed typecheck and lint only. It has not been viewed in a browser.

## Production steps (owner-run)

Read-only checks first. Run them in an owner-controlled PowerShell. They print routing identifiers, never secrets.

```powershell
twilio api:core:incoming-phone-numbers:list --phone-number "+1NUMBER" -o json
twilio api:trunking:v1:trunks:list -o json
lk --project tradecatch sip inbound list
lk --project tradecatch sip dispatch list --json
```

### 1. Release the backend

Release this revision through the normal Worker release. No database migration is needed. Every new setting lives in the existing profile JSON (`settings.phoneSettings`), and every new field is optional.

### 2. Deploy the agent update (caller policy)

Use the existing update procedure in [agents/receptionist/CUTOVER.md](../agents/receptionist/CUTOVER.md). This is an update to the existing agent. Do not recreate it. Older agents keep working: they simply never send `from`.

### 3. Only for Missed Calls Only on a TradeCatch number: the LiveKit hand-off

Path B reaches LiveKit from Twilio Programmable Voice, not from the Elastic SIP trunk. Keep the existing inbound trunk `ST_SRLKTaYtdLkd` as it is, because the trunk path depends on it.

1. In LiveKit Cloud → Telephony → SIP trunks, create a **separate inbound trunk** for the pilot number, with digest authentication (username and password). Make sure the dispatch rule `SDR_PikdfX5ovdTB` (or a new rule) dispatches `tradecatch-receptionist` for calls on that trunk. Confirm in LiveKit's documentation how trunks are matched when the same number is on two trunks, before routing any real call.
2. Store the settings in the Worker. Each `secret put` prompts for the value, so it never enters shell history:

    ```powershell
    npx wrangler secret put RECEPTIONIST_LIVEKIT_SIP_HOST       # e.g. <project>.sip.livekit.cloud
    npx wrangler secret put RECEPTIONIST_LIVEKIT_SIP_USERNAME
    npx wrangler secret put RECEPTIONIST_LIVEKIT_SIP_PASSWORD
    npx wrangler secret put RECEPTIONIST_LIVEKIT_SIP_TRANSPORT  # optional: tls | tcp | udp
    ```

   Until the host is set, the dashboard warns `livekit_handoff_not_configured` and the built-in receptionist answers the AI leg.
3. In the business's phone settings (advanced form), set **Voice engine** to *LiveKit agent*.

### 4. Only for Missed Calls Only on a TradeCatch number: move the pilot number to the webhook

Set the voice URL first, then take the number off the trunk, so no call finds the number with nowhere to go:

```powershell
twilio api:core:incoming-phone-numbers:update --sid PN... `
  --voice-url "https://<MISSED_CALL_PUBLIC_WEBHOOK_BASE>/api/webhooks/twilio/voice" --voice-method POST `
  --status-callback "https://<MISSED_CALL_PUBLIC_WEBHOOK_BASE>/api/webhooks/twilio/status" --status-callback-method POST
twilio api:trunking:v1:trunks:phone-numbers:remove --trunk-sid TK... --sid PN...
```

Run `--help` on each command first to confirm its flags in your CLI version. Then, in the dashboard, press **Check number routing**. It should report "calls go to TradeCatch first".

### 5. The owner saves the mode, then places a test call

**Start test call** → call the TradeCatch number (or the forwarded number) from another phone → **Check test call**. Only calls that start after Start, within 15 minutes, count. Personal-contact calls never count.

## Carrier forwarding (owner's phone)

Dial from the business phone. TradeCatch cannot set or read the carrier's forwarding. That is why a forwarded mode stays "unknown" until a test call arrives.

| Purpose | GSM code (most Canadian carriers) |
|---|---|
| No answer | `**61*NUMBER#` |
| Busy / declined | `**67*NUMBER#` |
| Off / unreachable | `**62*NUMBER#` |
| All calls (AI Answers All) | `**21*NUMBER#` |
| Cancel all forwarding | `##002#` |

NUMBER is the TradeCatch number's 10 digits. Codes vary between carriers, plans and landlines. With forwarding, the dashboard setting describes what the owner configured on the carrier side. It does not change it.

## Staging real-call procedure (owner-run, own phones only)

Use a staging number and two phones you control: A is the caller, C is the contractor. Do not use customer numbers.

| # | Setup | Action | Expected |
|---|---|---|---|
| 1 | Missed Calls Only | A calls; C answers and presses 1 | Bridged; no SMS to A; no owner summary |
| 2 | same | A calls; C does not answer | Receptionist answers within ring time + 1 s |
| 3 | same | C declines | Receptionist answers |
| 4 | same | C on another call | Receptionist answers |
| 5 | same | C switched off | Receptionist answers |
| 6 | same | C's voicemail picks up (ring time > voicemail delay) | Receptionist answers. Voicemail does not keep the caller |
| 7 | same | A hangs up while C rings | A gets the missed-call text; owner summary says missed |
| 8 | same | A hangs up mid-conversation | One summary |
| 9 | AI Answers All | A calls | Receptionist answers immediately |
| 10 | switch mode | Save, test call | Status returns to verified only after the new test |
| 11 | C's number in personal contacts, message | C calls | Message, hang-up, no summary |
| 12 | Withheld policy = message | A calls with *67 | "Call back with your number shown" |
| 13 | LiveKit engine | as #2 | Sophia (LiveKit) answers; one call in history |
| 14 | LiveKit host unset | as #2 | Built-in receptionist answers |
| 15 | Carrier forwarding | A calls C's line, unanswered | Arrives at TradeCatch; C never rings twice |

Record each result (pass or fail, plus the CallSid) before enabling a real customer.

## Limitations

- TradeCatch sees only calls that reach Twilio. Forwarding rules on the carrier are invisible to it, so a forwarded mode can be verified only by a test call.
- On path A (SIP trunk) Missed Calls Only is impossible. The number must move to the webhook (step 4).
- Screening adds a short prompt for the contractor before they are connected.
- The test call proves one route at one moment. A later carrier or Twilio change is not detected until the next test or number check.
- Caller ID is spoofable. Personal contacts are a convenience, not a security control.
- A call handed to LiveKit keeps its webhook routing record in the store (hidden from owner call lists). The conversation itself appears once, from the agent's report.

## Deployment checklist

- [ ] Typecheck, lint, the TypeScript unit suite and the Python suite pass on the release commit
- [ ] Backend released; `/api/health` OK
- [ ] Agent updated (not recreated); `lk --project tradecatch agent list` shows one receptionist
- [ ] Existing SIP-trunk numbers still answered by Sophia (one call to a pilot number on path A)
- [ ] For each pilot moving to Missed Calls Only: step 3, step 4, number check = webhook, staging procedure #1–#9 and #13 pass
- [ ] Owner saved the mode and the dashboard shows **verified**

## Rollback

- **One number**: put it back on the trunk. Calls go straight to LiveKit again (AI Answers All):
  `twilio api:trunking:v1:trunks:phone-numbers:create --trunk-sid TK... --phone-number-sid PN...`
- **Mode only**: the owner selects AI Answers All Calls and saves, or switches the voice engine back to Gather. Takes effect on the next call (runtime refresh ≤ 30 s).
- **Hand-off**: `npx wrangler secret delete RECEPTIONIST_LIVEKIT_SIP_HOST`. The AI leg falls back to the built-in receptionist.
- **Code**: redeploy the previous Worker and agent versions. Stored new fields are optional and ignored by older code, so no data rollback is needed.
- **Carrier**: the owner dials `##002#` to cancel forwarding.
