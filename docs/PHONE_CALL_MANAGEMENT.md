# Phone call management (Task 4)

Connects TradeCatch to Twilio voice so each business can receive calls, route
them to the AI receptionist or a human, and review history in the dashboard.

## Dashboard

| Path | Purpose |
| --- | --- |
| `/app/calls` | Call history |
| `/app/calls/settings` | Phone numbers, routing, transfers, recording |
| `/app/test-center/live-phone` | Simulation + live dial instructions |

## Webhooks

Point the Twilio voice URL at:

```text
https://<public-base>/api/webhooks/twilio/voice
```

Status callback:

```text
https://<public-base>/api/webhooks/twilio/status
```

Existing step callbacks under `/api/twilio/voice/receptionist/{incoming,gather,dial,voicemail,status}` remain supported.

Signatures are verified via `assertTwilioWebhook` (required in real production).

## Routing

| Strategy | Behavior |
| --- | --- |
| AI first | AI answers immediately (subject to Task 3 call-handling mode) |
| Human first | Rings the authorized contractor number, then AI on no-answer |
| Overflow mode | Same as human-first when `ringHumanOnOverflow` is on |

Only configured Canadian transfer numbers are dialed — never model-invented numbers.

## Voice engines

| Engine | Status |
| --- | --- |
| `gather` | Default. TwiML `<Gather>` + existing receptionist engine. Live-ready. |
| `conversation_relay` | TwiML `<Connect><ConversationRelay>` rendered. Production WebSockets need Cloudflare Durable Objects; staging can POST relay JSON to `/api/voice/socket` (ops bearer required; 404 on real production unless `MISSED_CALL_SANDBOX=1`). |

## Simulation vs live testing (Test Center → Live phone testing)

**Nothing on this page places a call.** A simulation runs in memory; the live test only tells the owner what to dial.

### Simulation

`POST /api/businesses/:id/calls/test` with `mode: "simulation"`, a `scenario`, an optional caller `language` and a `runId` (one per click).

- It runs the real receptionist engine on the business's *saved* configuration, on an in-memory store and a virtual clock. The routing is `resolveInboundRouting`, the function the live Twilio webhook uses, evaluated at the time of the request with the plan's capabilities, so business hours, the ring-first setting, the languages, the greeting and the plan limits (for example no live transfer) are the ones a real call gets.
- The simulation modules import no Twilio, Bland, LiveKit, SMS or notification client and never call `fetch`. The owner is never alerted. `tests/unit/live-phone-testing.test.ts` (SIM-05) stubs `fetch` and asserts zero calls, and statically checks the imports.
- Scenarios: `answered_call`, `missed_call` (needs ring-first routing), `caller_hangup`, `receptionist_response`, `routing_failure` (a failed ring or an unanswered transfer), `transfer_request`, `appointment_request`. The names `ai_answers` and `human_first_missed_then_ai` from the first version still work.
- Every event carries `payload.simulated = true` and the call id starts with `sim_live_`, which every owner-facing call list already treats as a practice call: never listed as a real call, counted, alerted or metered.
- The timeline has timestamps and offsets, the routing decision, when the receptionist started, the duration, the final status (`completed`, `transferred`, `caller_hung_up`, `voicemail`, `failed`) and why the call ended. The status and reason come from the stored call record, not from the scenario's name. Durations are modelled (a human answers after about 8 s, a turn takes about 8 s) and labelled as simulated.
- Results are saved (call record plus `rc_call_events` rows, no new table) for the authenticated business only, and reload after a refresh or a new sign-in (`GET /api/businesses/:id/calls/test`, or `?callSid=`). Event ids are deterministic (`callEventId`), so the same run saved twice, or a retried request with the same `runId`, never adds a row.
- Errors are specific and translated: `receptionist_not_activated`, `receptionist_disabled`, `no_phone_number`, `invalid_configuration` (422, with the field names), `call_not_answered_now`, `routing_rejected`, `language_not_enabled`, `scenario_not_applicable`, `no_transfer_destination`, `voice_engine_not_simulatable`, `persistence_failed` (503: the run is not shown if it could not be saved), `history_unavailable`, `simulation_incomplete`. A failed simulation never returns a result.
- Limits: the simulation runs the built-in rules receptionist. When the line uses the streaming voice engine or the LiveKit/Bland agent on real calls, the wording can differ (the run says so), and a business handed to the LiveKit agent cannot be simulated at all.

### Live test

`POST /api/businesses/:id/calls/test` with `mode: "live_instructions"` (read-only, writes nothing) returns what the page shows:

- the number(s) to dial: the number the receptionist is configured on (the one the webhook matches), any Bland line routed to this business, and the owner's public line when callers reach TradeCatch through carrier forwarding. The owner's own contact phone is never offered;
- what a call does right now (rings the contractor first, or the receptionist answers) and what it should sound like (greeting, language, voice);
- readiness checks, including that each number reaches this business and no other;
- a prominent notice that **carrier charges may apply**, because the owner dials from their own phone.

The page never calls the owner. A real call to the number is recorded as a real call, with the same timeline (`incoming`, `routing_decision`, `human_ring` / `missed` / `ai_started`, `status`, `finalized`, all idempotent), and never carries the simulation label.

Not verifiable from this repository: the Bland pathway's own greeting text and voice, and the carrier's routing of the number. Place one real call after any change to either.

## Schema

Migration `009_phone_call_events` adds `rc_call_events`. Phone settings live in
`rc_profiles.settings.phoneSettings` (JSONB) so each business stays isolated.
