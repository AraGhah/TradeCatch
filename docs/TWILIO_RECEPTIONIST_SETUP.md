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

References: [Twilio Record behavior](https://www.twilio.com/docs/voice/twiml/record),
[Cloudflare Workers logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).
