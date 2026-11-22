# Live calls in ElevenLabs voices

The AI receptionist can speak on live phone calls with ElevenLabs voices
instead of the Amazon Polly voices of the classic `<Gather>` flow. Twilio
ConversationRelay does the speech-to-text and the text-to-speech; TradeCatch
keeps doing the thinking with the same receptionist engine, so routing,
bookings, transfers, voicemail, summaries and owner alerts do not change.

It is off by default. Nothing changes for any call until
`CONVERSATION_RELAY_MODE` is set.

## How a call flows

1. `POST /api/twilio/voice/receptionist/incoming` runs the engine as before.
   When the relay applies to the business and the plan is an AI answer, it
   returns `<Connect><ConversationRelay>` with one `<Language>` per receptionist
   language (`fr-CA`, `en-US`), each with its ElevenLabs voice. The opening
   prompts ride along as the `intro` parameter.
2. Twilio opens `wss://…/api/voice/socket?session=<id>`. The Worker entry
   (`worker.ts` → `routeRelayUpgrade`) checks `X-Twilio-Signature` against
   `TWILIO_AUTH_TOKEN` and hands the socket to the `VoiceRelaySession` Durable
   Object named after the session. Without the binding or the token the
   upgrade gets 503; with a bad signature, 403.
3. On `setup` the Durable Object speaks the intro. Each caller turn
   (`prompt`, `dtmf`, or silence after the listening window) is POSTed to
   `/api/voice/relay/turn` over the Worker's self binding, signed with an
   HMAC-SHA256 derived from `TWILIO_AUTH_TOKEN` and a timestamp (60 s). The
   route checks that the session belongs to that call, runs
   `engine.handleGather` and answers with text tokens.
4. A transfer, a voicemail or the end of the call is sent to Twilio as an
   `end` message once the last sentence has had time to be spoken. Twilio then
   calls `POST /api/webhooks/twilio/relay-ended`, which returns the `<Dial>`,
   `<Record>` or `<Hangup>`.

If the relay breaks (Twilio rejects the voice with error 64101, the socket is
unreachable, a turn fails), `relay-ended` continues the call on the classic
`<Gather>` voice through the engine's no-input path instead of hanging up.

## Turning it on

1. Accept Twilio's AI/ML addendum: Console → Voice → Settings → Privacy &
   Security (required for ConversationRelay).
2. Pick voices in Twilio's ConversationRelay ElevenLabs voice list (they are
   billed through Twilio, not the TradeCatch ElevenLabs account). Set
   `ELEVENLABS_RELAY_VOICE_FR` and `ELEVENLABS_RELAY_VOICE_EN`. A bare
   20-character id gets the recommended `-v4` model; a full voice string
   (`<id>-v4-0.35_0.8`) is used as written; anything malformed is ignored and
   Twilio uses its default voice for the language.
3. Deploy the Worker with the `VOICE_RELAY` binding and the
   `v1-voice-relay` migration from `wrangler.jsonc`. The migration only
   creates the Durable Object class; it touches no data.
4. Set `CONVERSATION_RELAY_MODE`:
   - `opt_in`: only businesses whose voice engine is `conversation_relay`.
   - `all`: those plus every business on the default `gather` engine.
     LiveKit businesses keep LiveKit.

Start on staging with `opt_in` and one business, call it in French and in
English, try a transfer, a voicemail and a silent caller, then widen.

## Rolling back

Set `CONVERSATION_RELAY_MODE=off` (or remove it). New calls go back to
`<Gather>` immediately; calls already on the relay finish on it. The Durable
Object binding can stay deployed.

## Limits

- The business's own cloned voice (Receptionist Plus, `/app/receptionist/voice`)
  lives in TradeCatch's ElevenLabs account. Twilio's ConversationRelay
  documentation only covers voices from its own ElevenLabs catalogue, so live
  calls use the voices configured above, not the cloned one.
- ElevenLabs v3/v4 voices do not read SSML, so the owner's speaking-speed
  setting does not apply on the relay.
- Before this change a business set to `conversation_relay` was sent to a
  socket that answered 501. It now gets the classic voice until the mode is
  turned on.
