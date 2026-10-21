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

## Simulated appointments

`appointment-sim.ts` keeps an in-memory calendar per organization for tests.
Double bookings and notice windows are enforced. No Google/Outlook calls yet.

## Task 4

Live phone numbers, streaming audio, real transfers, and unanswered-call detection
are out of scope here.
