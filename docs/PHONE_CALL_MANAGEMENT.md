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
| `conversation_relay` | TwiML `<Connect><ConversationRelay>` rendered. Production WebSockets need Cloudflare Durable Objects; staging can POST relay JSON to `/api/voice/socket`. |

## Simulation vs live testing

- **Simulation** (`POST /api/businesses/:id/calls/test` with `mode: simulation`): no Twilio charges; events + session saved for that business only.
- **Live instructions**: never silently places an outbound call. Shows the staging number to dial from an authorized device.

## Schema

Migration `009_phone_call_events` adds `rc_call_events`. Phone settings live in
`rc_profiles.settings.phoneSettings` (JSONB) so each business stays isolated.
