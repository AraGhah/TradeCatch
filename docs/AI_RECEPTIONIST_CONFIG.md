# AI Receptionist configuration (Task 3)

Per-business AI receptionist settings live in `rc_profiles.settings` (JSONB),
scoped by `organization_id`. There is no shared knowledge across tenants.

## Dashboard

`Dashboard → Receptionist` (`/app/receptionist`)

- Overview: status, name, phone, language, voice, stats, activate/deactivate
- Edit: identity, knowledge/FAQs, call handling, transfers, appointments
- Test: simulated conversation using **that** business's config (no real calls/SMS)
- History: real + `sim_*` sessions for the linked Module A client

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET/PATCH | `/api/businesses/:id/ai-receptionist` | Overview / update settings |
| POST | `/api/businesses/:id/ai-receptionist/activate` | Owner activates routing |
| POST | `/api/businesses/:id/ai-receptionist/deactivate` | Owner deactivates routing |
| POST | `/api/businesses/:id/ai-receptionist/test` | Simulated conversation |
| GET | `/api/businesses/:id/ai-receptionist/calls` | Tenant call history |
| GET/PUT | `/api/businesses/:id/knowledge` | Knowledge + FAQs |
| PUT | `/api/businesses/:id/call-routing` | Call handling mode |
| PUT | `/api/businesses/:id/transfer-settings` | Transfer destinations |
| GET/PUT | `/api/businesses/:id/appointment-settings` | Booking rules (+ sim probe) |

All routes enforce membership (or platform admin) and refuse cross-tenant access.

## Call handling modes

| Mode | Behavior |
| --- | --- |
| `always` | Answer when activated |
| `business_hours` | Answer only during configured hours |
| `after_hours` | Answer only outside hours |
| `overflow` | Prepared for Task 4 telephony forward; until then behaves like always when activated |
| `disabled` | Config `enabled=false` — never answers |

Activation still requires a phone number (ops-assigned, org phone, or Module A SMS from).

## Safety rules baked into facts

- Never invent pricing (explicit “do not quote” when none configured)
- Never claim unconfigured services
- Identify as a virtual receptionist
- Offer human transfer when unsure

## Phone booking (opt-in)

Off by default. The owner turns it on with **Book appointments during the call**
in the receptionist settings (`appointmentSettings.phoneBooking`). Everything else
keeps working as before: the call collects name, address, callback number and a
preferred time, and the team confirms.

When it is on, an appointment call that has those details:

1. reads the caller's wish (day, part of day or clock time) and asks the
   scheduling service for open times, which applies the business hours, notice
   window, daily cap, buffers, existing bookings and the calendar connection;
2. reads up to three numbered openings; the caller answers by voice or by
   pressing 1–3, and may ask for other times (two rounds at most);
3. reserves the pick through the scheduling service (idempotent per call and
   time, serialised per business) and says it is **booked** only when that
   returned a confirmation. A time taken meanwhile is replaced by another offer.

The call falls back to a request the team confirms, with no promise made, when:
the service the caller describes needs approval or is an emergency type, the
business uses Google Calendar without a connection, nothing is open, the caller
declines or stays unclear, or the scheduler fails or is slow. Calls the
receptionist booked end as `appointment_booked` and show in the call log and
dashboard separately from `appointment_requested`.

The owner's "test conversation" in settings never reserves a slot. This has not
been validated on live Twilio traffic; keep describing the feature publicly as
appointment requests confirmed by your team.

## Custom voice (Receptionist Plus only)

Owners on Receptionist Plus can make the LiveKit receptionist speak with a copy
of their own voice (dashboard: **Receptionist → Voice**, `/app/receptionist/voice`).
Everything lives in `src/product/receptionist/custom-voice/`.

**Flow.** The owner accepts the consent wording and types their name → the server
issues a signed challenge of three random words → the owner reads a short text
containing them (recorded in the browser, or an uploaded file) → the sample is
transcribed and must contain the words → ElevenLabs creates the voice → the
owner **previews** it → only then can they switch calls to it. They can switch
back to the standard voice, delete the voice, or withdraw consent at any time.

**What is stored.** `rc_custom_voices` (one row per organization: mode, the
provider voice id, the consent record with its wording version and signer name,
revocation, preview/activation times) and `rc_voice_events` (an audit trail with
no audio, transcripts or secrets). Both tables have RLS on and no `anon` /
`authenticated` grants; the app reaches them over its direct Postgres
connection only. **The recording itself is never stored by TradeCatch**: it is
read into memory, sent to ElevenLabs and dropped. ElevenLabs keeps the sample it
needs until the voice is deleted, which is why the consent text says so.

**Rules enforced on the server** (`service.ts`, not the UI):

- *Plan.* `AI_CUSTOM_VOICE` is in `RECEPTIONIST_EXTRA` only. It is re-checked at
  challenge, clone, preview and activation, and again on every call
  (`resolveForAgent`), so a downgrade stops the cloned voice on the next call.
  Deleting, withdrawing consent and switching back stay allowed on any plan.
- *Roles.* Owner/administrator can change anything; other members can read the
  status. The organization always comes from the session, never from a body.
- *Isolation.* Every store call is keyed by organization id; there is no
  cross-tenant listing. Challenge tokens are bound to organization + user.
- *Consent.* No sample is sent anywhere without the current consent version.
  Bump `CONSENT_STATEMENT_VERSION` in `model.ts` whenever the wording in
  `app.voice.consent.statement` changes.
- *Verification.* The three-word challenge proves the recording was made now by
  someone reading our words. It is a liveness and attestation check, **not**
  biometric proof that the speaker is who they say they are.
- *Never live by itself.* A new voice starts on the standard mode; activation
  needs a successful preview. Re-recording resets it.
- *Voice id.* Never sent to a browser. Only the ops-authenticated
  `/api/receptionist/agent-config` hands it to the call worker.
- *Delete.* The business is put back on the standard voice first, then the
  provider voice is deleted (a 404 counts as already gone). If the provider is
  down the record stays in `deleting` and the owner can retry. A deletion
  request from the account page and deleting a demo business also remove it.

**Calls.** `agent-config` returns `voice: {mode:"standard"}` or
`{mode:"custom", provider, voiceId, model}`; any doubt (no organization, store
error, not entitled, not previewed, revoked) is `standard`. The Python agent
(`agents/receptionist/voice.py`, `agent.py`) re-validates it and, for a custom
voice, builds a speech-to-text → LLM → ElevenLabs pipeline with a fallback TTS
instead of the usual speech-to-speech model (which cannot speak with a custom
voice). If that cannot be built, or ElevenLabs fails mid-call, the caller still
gets an answer in a standard voice. With a custom voice the instructions add a
line so the receptionist never claims to be the owner or a human.

**Configuration.** `ELEVENLABS_API_KEY` (server and agent), optional
`ELEVENLABS_STT_MODEL` (default `scribe_v2`), and the agent variables in
`agents/receptionist/.env.example`. Without the key the feature reports itself
unavailable and every call uses the standard voice. Apply the schema with
`npm run db:schema` (migration `035_custom_receptionist_voice`).

**Not verified without a live account.** Voice quality, French pronunciation of
the clone, call latency of the speech-to-text → LLM → TTS pipeline compared with
the speech-to-speech model, and the real ElevenLabs/LiveKit calls have only been
exercised against fakes. Listen to real calls before announcing the feature. The
consent wording and the voice-cloning terms need legal review for the
jurisdictions you sell in (including Québec Law 25).

## Simulated appointments

`appointment-sim.ts` keeps an in-memory calendar per organization for tests.
Double bookings and notice windows are enforced. No Google/Outlook calls yet.

## Task 4

Live phone numbers, streaming audio, real transfers, and unanswered-call detection
are out of scope here.
