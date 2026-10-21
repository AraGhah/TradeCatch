# TC-020 — phone booking verification

Problem: *AI Receptionist cannot yet book appointments directly.* The receptionist
collected a requested time window, but never checked availability, reserved a
slot, confirmed it, or protected against a double booking.

Development branch: `tc-020-022-booking-health`. Recovered and reviewed the previously unmerged phone-booking work, preserving current outage handling.

## Implemented behavior

Phone booking is an **owner opt-in** (`appointmentSettings.phoneBooking`, default
off, switch in the receptionist settings). With it off, calls behave exactly as
before: they end as `appointment_requested` and the team confirms.

With it on, a call that is an appointment request and already has the caller's
name, address and callback number runs a deterministic booking stage in the call
engine (not the language model):

1. **Availability** — the caller's wish (day, part of day, clock time, in French
   or English) is turned into a search window; the scheduling service
   (`src/product/scheduling`) returns the open times, applying hours, notice,
   buffers, the daily cap, existing bookings and the calendar connection.
2. **Offer** — up to three numbered openings are read out; the caller answers by
   voice or by pressing 1–3, or asks for other times (two rounds, two misses).
3. **Reservation and conflict prevention** — the pick is reserved through the
   scheduling service's per-business lock with the idempotency key
   `rcs:<session>:<start>`. A time taken in the meantime returns a conflict and
   the caller is offered other times; no pending request is left behind
   (`requestIfUnavailable: false`). A replayed webhook cannot book twice.
4. **Confirmation** — the caller hears "booked" only when the scheduling service
   returned a confirmation (and, for Google Calendar, after the event was
   created). The call ends as `appointment_booked`; the owner's SMS/email and the
   dashboards show the confirmed time separately from requests.

It falls back to a request the team confirms, saying so honestly, when the
service the caller describes needs approval or is an emergency type, the Google
calendar is not connected, nothing is open, the caller declines or stays unclear,
or the scheduler errors or takes longer than 7 s. The language model can never
confirm a time: its prompt forbids it, and a reply that claims a booking is
replaced by the rule brain.

Also fixed on the way: `listSlots` counted *offered* slots toward
`maxDailyBookings`, which closed every afternoon on the default schedule so only
8:00–11:30 was ever offered. It now counts booked appointments only (regression
test added in `tests/unit/scheduling.test.ts`).

Dashboards, call log and owner overview previously labelled "requested" as
"booked"; they now count `appointment_booked` and `appointment_requested`
separately.

## Validation

The phone-booking suite exercises complete English/French calls, spoken and DTMF
selection, conflicts, retries, off-by-default behavior and failure recovery.
`scheduling-atomic.test.ts` checks that a reservation stays a hold until calendar
creation completes, rejects unknown availability, and tests 12 concurrent
PostgreSQL workers with idempotent replay in an isolated staging schema.
Full release results are recorded by the linked commit's GitHub CI run.

## Not verified / limits

- **Not validated on live Twilio traffic.** The capability matrix keeps phone
  booking at *pilot*; public copy must keep saying "appointment requests
  confirmed by your team" until a controlled live pilot passes.
- Phone reservations have a six-second deadline before the engine's seven-second
  fallback. Expired attempts do not start a reservation; a late calendar result
  is canceled. Calendar requests have a five-second network timeout. Existing
  confirmed reservations are returned idempotently; an in-progress hold is never
  represented as confirmed.
- Reading the caller's wish is best-effort. "Quote", "estimate" and similar
  words map to the appointment intent, so those callers are offered visit times.
- Only appointments made in TradeCatch or on a connected calendar block a time.
- The owner's "test conversation" and the simulated live test use engines
  without a scheduler, so they never reserve a slot.
