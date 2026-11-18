# KAN-19: the appointment calendar

Status (2026-11-18): **code work done, verified locally, committed and pushed;
not deployed.** The work is on `kan-19-appointment-calendar` (worktree
`.worktrees/kan-19-calendar`) and `main`. No database migration is needed.
Nothing was written to a live service.

## What the person sees

`/app/bookings` (Professional plan) opens on a calendar of the business's
appointments.

| Part       | Behaviour                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Views      | Day, Week, Month. Week is the default on a desktop, Day on a phone. A week is **Sunday to Saturday**.                                             |
| Hour grid  | An appointment sits at its real start and has its real length (56 px an hour, never shorter than 22 px). Overlapping jobs sit side by side.       |
| Month      | Whole weeks, three appointments a day and "+N more"; a phone shows a count per day that opens that day.                                           |
| Time zone  | Every time is read in the **business's own zone**, never the browser's, and the page names it ("Times are shown in EST (America/Toronto)").       |
| Navigation | Previous, next and Today; clicking a day heading or a month number opens that day.                                                                |
| Hours      | The grid follows the business's opening hours and stretches for a job outside them; closed days are shaded.                                       |
| Details    | Clicking an appointment opens its details: edit the customer, phone and address; reschedule; cancel (with a reason); complete; approve a request. |
| Booking    | The date and time picker books through the same service. The new appointment shows at once, on the day it was booked, without a reload.           |
| Filters    | Status, technician, customer search, and "Show canceled" (a canceled appointment frees its time but keeps its record).                            |
| Failures   | A failed save says so and shows nothing as saved; the chosen time is kept, so Confirm again is a plain retry. A failed load offers Retry.         |
| Languages  | English and French, every string translated.                                                                                                      |

## How it works

**One scheduling service.** The calendar, the dashboard picker, the legacy
`/api/app/bookings` route and the phone receptionist all use `getSchedulingService()`:
the same hours, notice, buffers, overlap rules and tenant check. The legacy route
used to write to a table nothing else read, with none of those rules; it now books
through the service and a taken time answers 409 there too.

**Times are instants.** Appointments are stored as UTC instants and carry the
business zone. The API refuses a time without an offset (`2026-12-01T10:00`) or that
is not a real moment (`2026-13-45T10:00:00Z`), because either would be read in the
server's zone or silently shifted (`src/product/scheduling/instant.ts`). Daylight
saving is handled by the layout code: the spring-forward day is 23 hours, the
fall-back day 25, and 10:00 is 10:00 on both sides of the change.

**The API.**

| Route                                                        | Purpose                                                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `GET /api/businesses/{id}/appointments?from=&to=`            | The appointments overlapping a window, plus technicians, hours and the business zone               |
| `POST /api/businesses/{id}/appointments`                     | Book. 201 confirmed, 409 when the time is taken, 400 for a bad time or phone number                |
| `GET` / `PATCH .../appointments/{appointmentId}`             | Details and history; edit name, phone, address, technician, complete                               |
| `POST .../{appointmentId}/reschedule`, `/cancel`, `/approve` | Move, cancel, accept a request                                                                     |
| `GET /api/businesses/{id}/availability?month=&exclude=`      | Free times of a month, grouped by business-local day (`exclude` frees the appointment being moved) |
| `PATCH /api/businesses/{id}`                                 | A changed time zone is validated and the calendar follows it                                       |

Every route checks, on the server, that the caller belongs to the business, that the
plan includes appointments (Professional), and for writes that the role may manage
settings (403 otherwise). Another business can neither read nor change an
appointment (CAL-14).

**Failures are never success.** `schedulingFailure()` turns anything the service does
not recognise (a database outage) into a 503 with no success flag and no calendar
data, so the screen never shows "saved" or "no appointments" for something that did
not happen. The cause is logged on the server and never sent to the browser.

**One time, one appointment.** Bookings, moves, cancels, approvals and edits run under
one lock per business, and the store only inserts a row when its time is free. A
double click is one request, and the same `idempotencyKey` sent five times at once is
one appointment.

## The four failures of the first run, and what they were

The first run of `tests/appointment-calendar.spec.ts` passed 11 of 15. None of the
four was fixed by loosening a test.

### CAL-12 and CAL-11: a real double-booking bug

Five people booking one time at once returned four 201 and one 409; and a second
booking of a taken time, sent after the first, returned 201.

**Cause.** A business's first setup (hours, the five default services, one
technician) ran in `ensure()` for every request that found it empty. The dashboard
asks four questions at once on a new calendar (`list`, `listTechnicians`,
`connectionStatus`, `getRules` in one `Promise.all`), so four setups ran together and
the business ended with **four technicians and four copies of every service**. The
page snapshot of the failed run showed it: four "On-call technician" entries. A
technician is another person who can take the same hour, so up to four customers
were confirmed for the same time and only the fifth was refused. The booking lock was
fine: the setup ran outside it.

**Fix** (`src/product/scheduling/service.ts`):

- The setup is shared: requests that arrive together wait for one setup, and the
  result is a copy per caller. The in-flight map lives on `globalThis`, because every
  request builds its own service object.
- The setup rows have fixed ids (`tech_<organizationId>_default`,
  `svc_<organizationId>_<n>`), so a second server instance that also found the
  business empty writes the same rows instead of adding copies. This is what protects
  a durable deployment with several instances, where an in-process map cannot.
- The rules are saved last, because they are what marks a business as set up: a setup
  cut short is simply done again instead of leaving a business with hours and no
  services.

**Regression tests** (`tests/unit/scheduling-seed.test.ts`): four simultaneous reads
leave one technician and five services; different service objects over one store do
too; two workers that both found the business empty still leave one technician; five
people grabbing one time on a new calendar leave exactly one confirmed. They failed
before the fix (4 technicians, 4 confirmed) and pass after.

### CAL-15: phone accessibility (`label-content-name-mismatch`)

An event button's accessible label did not contain the text shown on it.

**Cause, two parts.** (1) The label read `title, service, time, status` while the block
showed `title`, then `service`, then `time · status`: not the same order, so the
visible text was not a contiguous part of the name. (2) The lines of the block are
separate `<span>`s with no space between them; axe joins their text with nothing, so
the visible text was `Phone Customer8:00 a.m. …` and the word `customer8` could never
match `customer` in the label. Fixing the order alone did not clear the violation.

**Fix** (`src/components/app/AppointmentCalendar.tsx`): the label now **starts with the
visible title and time** and adds what the block has no room for after them
(`Phone Customer, 8:00 a.m. – 9:00 a.m., Confirmed, Water heater repair`); the service
line moved below the time so the visible order matches the label; a space between the
lines (invisible, they are blocks) keeps the words apart. The same two defects were
fixed in the week day headings (`Sun15` against `Sunday, November 15`; the label is
now `Sun 15, Sunday, November 15`) and the month chips (the label starts with the time,
then the name, as on screen).

The spec scans the phone's Day view only. A throwaway scan of Day, Week and Month, on
a phone and on a desktop, with a tall block, a practice appointment and a plain one,
found no violation after the fix (it was deleted afterwards).

### CAL-06: reschedule, a race in the test's helper

The reschedule picker never showed any times. The picker draws the old month until the
next one arrives. `pickDay()` counted day buttons straight after the page opened,
found none (the picker had not loaded), clicked "Next month", then clicked a day of
the month that was about to be replaced; December arrived and the choice was dropped
with the November grid. The product behaves correctly (a click in that gap is a
no-op); the helper read a month that was still loading.

**Fix** (`tests/appointment-calendar.spec.ts`): `pickDay()` looks at a month only once
it has settled (`aria-busy="false"`). No assertion changed.

## The demo's sample visits depended on the time of day

Found by the full unit run, not by the calendar tests: `demo-businesses.test.ts`
("the demo's sample visits are on the calendar, inside the business's hours") failed
with `2026-11-18T22:00:00Z is 17:00 in America/Toronto`. It is a product defect, not
a fragile test, and it moved with the clock.

**Cause, three parts** in `seedDemoCalendar`:

1. It asked for the open times with the default cap of 48. At 19 open times a day that
   is two and a half days, so after the first day was over the seed could only reach
   three days and put three visits on the calendar, not four.
2. It grouped the times by UTC date, not by the business's own day.
3. It took the fourth time of each day, or the last one when fewer were left. On a
   day that was already half over (today) that is the last open time, at closing
   (17:00 for a 08:00-18:00 day with one-hour visits), not "mid-morning".

**Fix** (`src/product/demo/business-service.ts`): the seed reads this month and the
next with `availabilityMonth` (every open time, already grouped by the business's own
days, with the local clock time), and on each day takes the open time closest to
10:00 among those from 09:00 up to noon. A day with no mid-morning left (today, in
the afternoon) is skipped. Two months cover a month or year change.

**Regression tests** (`tests/unit/demo-businesses.test.ts`): the seed is run with the
clock set to early on a weekday morning, the middle of a weekday afternoon (the
failing case), after closing on a Friday, a Saturday, and the end of the year. Each
must give four visits on four different days of the business, all between 09:00 and
12:00 local and in the future. All five fail on the old code and pass on the new one;
the existing CAL-01 test, which failed at the time of the run, passes too.

## "Move Me" late in the week

Weeks are now Sunday to Saturday and the calendar opens on this week. The
`schedule-picker` test "rescheduling uses the same calendar" books the first free time
by API and then opens the page: late in the week the first free time belongs to next
week and the appointment is not on screen. The test now pages forward with "Next
dates" until the booked day's column is drawn, then clicks the appointment. A throwaway
test that booked next week's first free time (the late-in-the-week case, which cannot
happen on a Wednesday) confirmed that it works; it was deleted afterwards. After a
booking made in the screen the calendar already follows the new date, so the other
tests did not need a change.

## Files

Added: `src/components/app/AppointmentCalendar.tsx`,
`src/components/app/calendar-layout.ts`, `src/product/scheduling/http.ts`,
`src/product/scheduling/instant.ts`, `tests/appointment-calendar.spec.ts`,
`tests/unit/appointment-calendar.test.ts`,
`tests/unit/appointment-calendar-api.test.ts`, `tests/unit/calendar-layout.test.ts`,
`tests/unit/scheduling-seed.test.ts`, `docs/KAN-19-APPOINTMENT-CALENDAR.md`.

Changed: `src/components/app/AppointmentDesk.tsx`,
`src/product/scheduling/service.ts` (strict instants, window listing, locks on cancel
and edit, reassigning only to a free technician, the first-setup fix, the zone),
`store.ts` (the memory store's buffer is applied to the existing booking only, as in
SQL and `listSlots`), `postgres-store.ts` (a save only changes a row of its own
business), `runtime.ts` (the business zone seeds the rules),
`src/app/api/businesses/[id]/appointments/**`, `availability/route.ts`,
`src/app/api/businesses/[id]/route.ts`, `src/app/api/app/bookings/route.ts`,
`src/product/receptionist/*` (a caller's "tomorrow at 2" is read in the scheduling
zone), `src/product/demo/business-service.ts` (the sample visits: a mid-morning time
on four open days, whatever the time of day), `src/messages/en.json`,
`src/messages/fr.json`, `docs/CAPABILITY_MATRIX.md`, `tests/unit/demo-businesses.test.ts`,
`tests/schedule-picker.spec.ts` ("Move Me").

## Test results

Run on 2026-11-18 in the worktree.

| Criterion | Covered by                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| CAL-01    | e2e: this week, Sunday first, today marked, zone named, navigation; unit on real SQL: zone and hours in the list, windowed list |
| CAL-02    | e2e: real start and length on the grid; unit: hour grid, side-by-side overlaps                                                  |
| CAL-03    | e2e: each appointment in its own day column; unit: week crossing a month or a year                                              |
| CAL-04    | e2e: count past three, "+N more", opens the appointment; unit: whole weeks, four to six rows                                    |
| CAL-05    | e2e: a booking shows at once without a reload; unit on real SQL: returned and listed                                            |
| CAL-06    | e2e: edit and reschedule show at once and survive a reload; unit: moves, edits, clearing a detail                               |
| CAL-07    | e2e: canceled, time freed, record kept; unit: twice is harmless, a cancel racing a move                                         |
| CAL-08    | e2e: refresh and sign out/in; unit on real SQL: new process and new session, same instants                                      |
| CAL-09    | e2e: the same clock time from Auckland and Los Angeles; unit: zone seeding, change and refusal                                  |
| CAL-10    | unit only: spring forward (23 h), fall back (25 h), repeated hour, half-hour zones (the e2e clock is real)                      |
| CAL-11    | e2e: a taken time is 409, bad times 400; unit: buffers, hours, notice, holidays, move, technician busy; **new** seed tests      |
| CAL-12    | e2e: three clicks one request, same key five times one row, five people one winner; unit on real SQL; **new** seed tests        |
| CAL-13    | e2e: 503 shown as a failure, retry books once, load failure offers Retry; unit on real SQL: nothing stored                      |
| CAL-14    | e2e and unit: another business, a lower plan and no session are all refused                                                     |
| CAL-15    | e2e: fits a 390 px phone, tap targets, no sideways scroll, axe clean                                                            |
| i18n      | e2e: French copy, no `MISSING_MESSAGE`                                                                                          |

| Check                                   | Result                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| `tsc --noEmit`                          | clean                                                                                  |
| `npm run lint` (`--max-warnings=0`)     | clean                                                                                  |
| `npm run format:check`                  | clean (four route files the work had left unformatted were formatted; whitespace only) |
| `npm run check:i18n`                    | OK, 3082 keys, English and French the same                                             |
| `npm run check:secrets`                 | OK, 1646 files                                                                         |
| `npm run test:unit`                     | 2941 tests: 2937 pass, **1 fail**, 3 skipped                                           |
| e2e `appointment-calendar.spec.ts`      | 15 of 15 (CAL-01 to CAL-09, CAL-11 to CAL-15, French copy)                             |
| e2e the same spec, 5 repeats, 4 workers | 75 of 75, no flaky test                                                                |
| e2e `schedule-picker.spec.ts`           | 4 of 4, including "Move Me"                                                            |
| e2e `plan-sync.spec.ts`                 | 15 of 15                                                                               |

The one unit failure is the known one and is not part of this work:
`tests/unit/call-activity.test.ts:676` ("shows the stored UTC time in the business's
own zone") expects `America/Vancouver` to read `7:05` for `2026-11-17T14:05Z` (the test
assumes British Columbia's permanent UTC-7 time from November 2026) and gets
`6:05 a.m.`: the time-zone data of the Node on this machine still has UTC-8 there. It
depends on the machine's data, not on the calendar, and that file is untouched.

The e2e runs use a temporary config (webpack build, the system Chrome, a 90 s test
timeout) that was deleted afterwards, as were the probes mentioned above. The last
e2e run is after every code change in this document, including the demo seed and the
formatting of the four routes.

What changed for the four tests that failed in the first run:

- CAL-12 and CAL-11 failed before the seed fix (four 201s and one 409 for five people
  on one time) and pass in the final run and in all five repeats.
- CAL-15 failed the axe scan on `label-content-name-mismatch` twice (the order, then
  the missing spaces) and is clean on the third version.
- CAL-06 timed out waiting for a day button on the stale month and is stable.

## Not verified here

- **Real multi-connection contention.** PGlite has one connection, so the advisory
  lock on the Postgres store is never contended; the real-Postgres suites need a
  `*_TEST_DATABASE_URL` and there is no Postgres or Docker on this machine. The first
  setup is idempotent by construction (fixed ids), but two instances racing on a real
  database were not run.
- **Businesses already affected.** A business that was first opened by several requests
  at once before this fix may already have several "On-call technician" and duplicate
  services in its data. The fix prevents new copies; it does not remove old ones. A
  one-off clean-up (keep one technician, merge services by name) needs a look at
  production data first and was not attempted.
- **Anything against a live service.** Google Calendar and Cal.com providers were not
  exercised; the e2e harness uses the simulated calendar and the in-memory stores.
- **The late-in-the-week "Move Me" case on a real Friday.** It was exercised by booking
  next week's first free time, not by waiting for the calendar to reach that day.

## Decisions for the user

- **Existing duplicate technicians** (see above): decide whether to clean them up.
- **The `call-activity` unit test** that fails on this machine depends on the Node
  time-zone data (British Columbia's permanent UTC-7). Either update the Node used
  here or make the test not depend on that data; it was left alone because it has
  nothing to do with the calendar.
