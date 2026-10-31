# Twilio receptionist setup and diagnosis

All URLs below use HTTP POST:

| Twilio setting | Production URL |
| --- | --- |
| A call comes in | `https://tradecatch.ca/api/webhooks/twilio/voice` |
| Call status changes | `https://tradecatch.ca/api/webhooks/twilio/status` |
| A message comes in | `https://tradecatch.ca/api/twilio/sms/inbound` |

The voice and status routes delegate to the receptionist handlers. Gather,
dial, and voicemail URLs are generated in TwiML; do not replace the incoming
webhook with a voicemail URL or manually add a session ID.

## Findings from the October 27 call

The inspected call received HTTP 200 with an apology followed by `<Record>`.
The recording callback had no `session` query parameter and returned `<Hangup/>`.
The database event for the same CallSid had organization `unknown`, no session,
and no `ai_started` event. No receptionist profiles were present, and the
deployed Worker had neither `RECEPTIONIST_CONFIG_JSON` nor `RECEPTIONIST_ENABLED`.
The existing business had no linked missed-call client or assigned phone.

These facts identify `startCall()`'s missing-number-configuration branch:
`resolveConfig(toE164)` returns null and `failSafePlan(null, null)` renders the
apology and voicemail. The receptionist handler is reached; it cannot resolve a
business to answer as. A successful webhook response alone does not establish
that the AI session started.

The recording exists in Twilio. Without a session, it is not attached to a
business call in TradeCatch and does not trigger its normal summary email.
Historical Workers log queries were unavailable to the authenticated OAuth
account; the finding uses the saved database event, configuration metadata,
TwiML, and code rather than claiming access to those logs.

## Required configuration before a live test

1. Provision and link a real client to the intended organization using the
   existing onboarding/ops workflow. Do not use demo technician numbers or
   forward a transfer back to the incoming Twilio number.
2. Save the receptionist profile with the exact Twilio number, enable the AI,
   choose `ai_first`, and activate the profile. The production deployment must
   select durable storage and use the database containing that profile.
3. If no human number exists yet, explicitly choose voicemail as the failed
   transfer action and configure a notification email. This produces
   `allowVoicemailOnly: true`; the production validator still requires an email
   recipient. Founder-managed JSON can set that flag explicitly. Live transfer
   numbers can be added later. Emergency instructions remain enabled.
4. Verify Resend credentials and sender configuration. Binding presence does
   not prove delivery; confirm an actual notification in an authorized live
   acceptance test. Keep provider secrets out of source control and logs.
5. Configure an LLM provider and its credentials for model-backed conversation.
   Without one, the existing rule-based brain can still greet and collect a
   request. Missing LLM credentials did not cause this call's initial fallback.
6. Review the organization's plan against `AI_RECEPTIONIST_VOICE` entitlement.
   The inspected business was on Growth. Do not change billing or plan records
   merely to suppress a call-routing failure.

The local prepared settings in `.artifacts/twilio-pdf-review/` contain the
requested recipient and phone assignment. They are not applied by a Git push.
Code merges do not create a client, activate a profile, configure credentials,
or deploy a Worker.

## Verification

For a configured business, the incoming response should contain a greeting and
`<Gather action=".../gather?session=rcs_...">` (or the explicitly configured
ConversationRelay connection). Saved events should include `ai_started` with
the intended business and session. Voice callbacks must carry the matching
CallSid. Test voicemail, completed-call persistence, and notification delivery.

Structured diagnostics distinguish `NO_ENABLED_CONFIG_FOR_NUMBER`, profile
reload errors, runtime failures, and orphan voicemail. Correlate by CallSid;
diagnostics omit full phone numbers, recording URLs, and raw exceptions.
Set `RECEPTIONIST_TIMING_DIAGNOSTICS=1` only when phase timing is needed.

The configuration screenshots' empty primary-handler-failure URL is not what
selected this fallback: the primary handler returned valid HTTP 200 TwiML.
The supplied call also provides no evidence that a trial restriction caused
the apology. Trial limits can still affect later live-transfer tests.

## French-first language menu and voice tuning

Every call opens in Canadian French: "Bonjour! Merci d'avoir appelé *Business*.
Pour continuer en français, restez en ligne. For English, press 1." The first
`<Gather>` accepts `speech dtmf` with `numDigits=1`.

- Key `1` → English, key `2` → French, no key within
  `RECEPTIONIST_LANGUAGE_SELECT_TIMEOUT_SECONDS` (default 3, range 2-10) → French.
  Any other key is ignored.
- Speech at the menu never changes the language. If the caller talks in English
  instead of pressing a key, the call stays French, keeps what they said, and
  repeats "For English, press 1" once.
- After the menu the language stays fixed unless the caller asks to change it
  ("in English please", "en français"). The greeting is not repeated on a switch.
- The language menu runs for every bilingual profile; `defaultLanguage` no longer
  decides the opening language when French is enabled. An English-only profile opens
  in English with no menu.

Environment settings (all optional, documented in `.env.example`):

| Variable | Effect |
| --- | --- |
| `RECEPTIONIST_LANGUAGE_SELECT_TIMEOUT_SECONDS` | How long the menu waits for a key |
| `RECEPTIONIST_GATHER_SPEECH_MODEL` | Twilio recognition model (`phone_call`, `deepgram_nova-3`, …) |
| `RECEPTIONIST_GATHER_ENHANCED` | `1` to request the enhanced phone-call model |
| `RECEPTIONIST_GATHER_SPEECH_TIMEOUT` | `auto` or 1-10 s of quiet that ends a turn |
| `RECEPTIONIST_GATHER_TIMEOUT_SECONDS` | Silence before a turn is treated as "no input" (3-15) |
| `RECEPTIONIST_MIN_ASR_CONFIDENCE` | Below this (0-0.9, default 0.5) a free-form answer is repeated back, at most twice |
| `RECEPTIONIST_SSML` | `0` turns off the pacing markup if a voice rejects it |

Pacing markup is limited to `<prosody rate>` and `<break>` and only sent to
Polly/Google voices. If a voice rejects it the caller hears silence, so switch it
off first when diagnosing a silent line.

Silence: the first quiet turn asks "Are you still there?" and repeats the open
question; the second says a polite goodbye and hangs up. It no longer drops the
caller into voicemail.

### Needs a live call to verify

These depend on audio, carriers and Twilio/LiveKit behaviour that unit tests cannot
reproduce. Check them on a real number before relying on it:

- How the Polly voices sound in French (fr-CA) and whether the rate percentages in
  `speech-style.ts` feel right at 140-160 words per minute.
- Which `RECEPTIONIST_GATHER_SPEECH_MODEL` recognises Québec French best; the
  default is left unchanged until compared on real calls.
- DTMF delivery on the SIP path (LiveKit receives keys as `sip_dtmf_received`).
- LiveKit transfers (SIP REFER) cannot report a no-answer after the hand-off; the
  Twilio `<Gather>` path can and offers a callback.
- The realtime voice model has no speed setting; its pacing follows instructions only.
- Latency under load, interruption sensitivity, and recovery from model errors.

References: [Twilio Record behavior](https://www.twilio.com/docs/voice/twiml/record),
[Cloudflare Workers logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).
