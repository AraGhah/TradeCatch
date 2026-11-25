import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signInAs, workspaceSession } from "./support/workspace-session";

/**
 * KAN-19, the appointment calendar on /app/bookings (Professional plan), against the
 * real API and the harness's in-memory stores. Times depend on the real clock, so the
 * tests read the free days and times from the availability API instead of hard-coding
 * dates, and compute what the grid must show with Intl in the business's own zone.
 *
 * CAL-09 (time zones) and CAL-10 (daylight saving) also have exact, clock-independent
 * coverage in tests/unit/appointment-calendar*.test.ts and tests/unit/calendar-layout.test.ts.
 */

const freshIp = () =>
  `2001:db8:${randomUUID().replaceAll("-", "").match(/.{4}/g)!.slice(0, 6).join(":")}`;
const test = base.extend({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": freshIp() });
  },
});

const BOOKINGS = "/app/bookings";
const HOUR_PX = 56;
const MIN_EVENT_PX = 22;

type Booked = { id: string; startAt: string; endAt: string; status: string };
/** `today`: the slot is on the business's current local day (see roomyDay). */
type Slot = { dayKey: string; startAt: string; today: boolean };

/* ----------------------------------------------------------------------------- */
/* Clock helpers: what the business's wall clock says                            */
/* ----------------------------------------------------------------------------- */

function localParts(iso: string, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) =>
    parts.find((part) => part.type === type)!.value;
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

const weekStartKey = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
};

/** "1:30" for 13:30, whatever the locale's AM/PM spelling. */
const clockText = (hour: number, minute: number) =>
  `${((hour + 11) % 12) + 1}:${String(minute).padStart(2, "0")}`;

/* ----------------------------------------------------------------------------- */
/* Session and API helpers                                                       */
/* ----------------------------------------------------------------------------- */

async function openWorkspace(page: Page, locale: "en" | "fr" = "en") {
  const session = await workspaceSession(page, locale, "professional");
  const me = (await (await page.request.get("/api/app/me")).json()) as {
    organization: { id: string };
  };
  const id = me.organization.id;
  const listing = (await (
    await page.request.get(`/api/businesses/${id}/appointments`)
  ).json()) as { timezone: string };
  return { ...session, id, zone: listing.timezone };
}

async function freeSlots(page: Page, id: string): Promise<Slot[]> {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const months = [
    now.toISOString().slice(0, 7),
    next.toISOString().slice(0, 7),
  ];
  const slots: Slot[] = [];
  for (const month of months) {
    const body = (await (
      await page.request.get(`/api/businesses/${id}/availability?month=${month}`)
    ).json()) as { today: string; days: Record<string, { startAt: string }[]> };
    for (const [dayKey, list] of Object.entries(body.days))
      for (const slot of list)
        slots.push({ dayKey, startAt: slot.startAt, today: dayKey === body.today });
  }
  return slots.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}

/**
 * The first day with enough room for two appointments hours apart, never the business's
 * current day. Today's free times shrink while the tests run (two hours' minimum notice,
 * advancing with the clock), so a day picked from today's list could lose its first times
 * before they are booked: on weekdays between about 10:30 and noon Toronto time CAL-04
 * found only three of its four back-to-back times and failed. A later day is the same
 * at any hour.
 */
function roomyDay(slots: Slot[]) {
  const byDay = new Map<string, Slot[]>();
  for (const slot of slots)
    if (!slot.today) byDay.set(slot.dayKey, [...(byDay.get(slot.dayKey) ?? []), slot]);
  for (const [dayKey, list] of byDay) {
    const first = list[0]!;
    const last = list[list.length - 1]!;
    if (
      list.length >= 4 &&
      Date.parse(last.startAt) - Date.parse(first.startAt) >= 3 * 3_600_000
    )
      return { dayKey, first: first.startAt, last: last.startAt };
  }
  throw new Error("no free day with room for two appointments in the next two months");
}

async function book(
  page: Page,
  id: string,
  startAt: string,
  customerName: string,
  extra: Record<string, unknown> = {},
): Promise<Booked> {
  const res = await page.request.post(`/api/businesses/${id}/appointments`, {
    data: { startAt, customerName, ...extra },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { appointment: Booked }).appointment;
}

async function stored(page: Page, id: string) {
  const listing = (await (
    await page.request.get(`/api/businesses/${id}/appointments`)
  ).json()) as {
    appointments: (Booked & { customerName?: string; serviceAddress?: string })[];
  };
  return listing.appointments;
}

/* ----------------------------------------------------------------------------- */
/* Page helpers                                                                  */
/* ----------------------------------------------------------------------------- */

const grid = (page: Page) => page.getByTestId("calendar-grid");
const details = (page: Page) => page.getByTestId("appointment-details");
const eventOf = (page: Page, name: string) =>
  page.getByTestId("calendar-event").filter({ hasText: name });

async function openBookings(page: Page) {
  await page.goto(BOOKINGS);
  await expect(grid(page)).toBeVisible();
}

async function chooseView(page: Page, view: "Day" | "Week" | "Month") {
  await page.getByRole("button", { name: view, exact: true }).click();
  await expect(grid(page)).toHaveAttribute("data-view", view.toLowerCase());
}

/** Pages forward until the given business-local day is on screen. */
async function reveal(page: Page, dayKey: string, next = "Next dates") {
  // While the calendar is still loading it shows a skeleton and no day cells: wait for it, rather than
  // mistaking "not loaded yet" for "not in this range" and paging away.
  await expect(grid(page)).toBeVisible();
  const cell = page.locator(
    `[data-testid="calendar-day"][data-date="${dayKey}"]`,
  );
  for (let step = 0; step < 14 && (await cell.count()) === 0; step += 1)
    await page.getByRole("button", { name: next }).click();
  await expect(cell.first()).toBeVisible();
  return cell.first();
}

/** The event starts at this instant (compared as moments, not as text). */
async function expectStart(event: Locator, iso: string) {
  await expect
    .poll(async () => Date.parse((await event.getAttribute("data-start")) ?? ""))
    .toBe(Date.parse(iso));
}

/**
 * Pages the picker to the month holding the day, then chooses it.
 *
 * The picker keeps drawing the old month until the next one arrives. A day
 * clicked in that gap belongs to a month that is about to go, and the choice
 * is dropped with it. So each month is looked at only once it has settled
 * (`aria-busy="false"`); counting buttons straight after the page opens, or
 * straight after "Next month", would read a month that is still loading.
 */
async function pickDay(picker: Locator, dayKey: string) {
  const settled = picker.locator("[aria-busy='false']");
  const button = picker.locator(`button[data-date="${dayKey}"]`);
  await expect(settled).toBeVisible();
  for (let step = 0; step < 3 && (await button.count()) === 0; step += 1) {
    await picker.getByRole("button", { name: /Next month/ }).click();
    await expect(settled).toBeVisible();
  }
  await button.click();
}

/** The event sits at its real start and has its real length on the hour grid. */
async function expectPlaced(
  page: Page,
  event: Locator,
  appointment: { startAt: string; endAt: string },
  zone: string,
) {
  const { day, hour, minute } = localParts(appointment.startAt, zone);
  await expect(
    event.locator("xpath=ancestor::*[@data-testid='calendar-day']"),
  ).toHaveAttribute("data-date", day);
  const line = grid(page).locator(
    `[data-testid="calendar-hour-line"][data-hour="${hour}"]`,
  );
  const lineBox = (await line.boundingBox())!;
  const eventBox = (await event.boundingBox())!;
  const minutes =
    (Date.parse(appointment.endAt) - Date.parse(appointment.startAt)) / 60_000;
  expect(
    Math.abs(eventBox.y - lineBox.y - (minute / 60) * HOUR_PX),
    `starts ${hour}:${minute}`,
  ).toBeLessThanOrEqual(1.5);
  expect(
    Math.abs(eventBox.height - Math.max(MIN_EVENT_PX, (minutes / 60) * HOUR_PX)),
    `${minutes} minutes long`,
  ).toBeLessThanOrEqual(1.5);
}

/** Books through the calendar picker, as a person does. */
async function bookInPicker(page: Page, customer: string) {
  const picker = page.getByTestId("schedule-picker");
  await expect(picker.locator("button[data-date]").first()).toBeVisible();
  let day = picker.locator("button[data-date]:not([disabled])").first();
  if ((await day.count()) === 0) {
    await picker.getByRole("button", { name: /Next month/ }).click();
    day = picker.locator("button[data-date]:not([disabled])").first();
  }
  await expect(day).toBeVisible();
  await day.click();
  const slot = picker.locator("button[data-slot]").first();
  await expect(slot).toBeVisible();
  const startAt = (await slot.getAttribute("data-slot"))!;
  await slot.click();
  await page
    .getByRole("textbox", { name: "Customer", exact: true })
    .fill(customer);
  return startAt;
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/* ----------------------------------------------------------------------------- */

test("CAL-01: the calendar opens on this week, with today marked, the business's time zone named, and date navigation", async ({
  page,
}) => {
  const { zone } = await openWorkspace(page);
  await openBookings(page);

  await expect(grid(page)).toHaveAttribute("data-view", "week");
  await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // A real Sunday-to-Saturday week.
  const days = page.locator('[data-testid="calendar-day"]');
  await expect(days).toHaveCount(7);
  const first = (await days.first().getAttribute("data-date"))!;
  expect(new Date(`${first}T00:00:00Z`).getUTCDay()).toBe(0);

  // Today is marked, and it is today in the business's zone.
  const today = localParts(new Date().toISOString(), zone).day;
  await expect(page.locator("[aria-current='date'][data-date]").first()).toHaveAttribute(
    "data-date",
    today,
  );
  // During the working day a line marks the current time in today's column.
  const clock = localParts(new Date().toISOString(), zone);
  if (clock.hour >= 9 && clock.hour < 17)
    await expect(page.getByTestId("calendar-now")).toHaveCount(1);

  // Every time is read in the business's zone, and the page says which.
  await expect(page.getByTestId("schedule-zone")).toContainText("Times are shown in");
  // The grid is a labelled, keyboard-reachable region.
  await expect(grid(page)).toHaveAttribute("role", "region");
  await expect(grid(page)).toHaveAttribute("aria-label", /Appointment calendar/);

  // Navigation: forward, back, and back to today.
  const range = page.getByTestId("schedule-range");
  const thisWeek = await range.innerText();
  await page.getByRole("button", { name: "Next dates" }).click();
  await expect(range).not.toHaveText(thisWeek);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(range).toHaveText(thisWeek);
  await page.getByRole("button", { name: "Previous dates" }).click();
  await expect(range).not.toHaveText(thisWeek);

  // Nothing scrolls sideways on a desktop screen.
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("CAL-02: Day view puts each appointment at its real start on the hour grid, with its real length", async ({
  page,
}) => {
  const { id, zone } = await openWorkspace(page);
  const open = roomyDay(await freeSlots(page, id));
  const alpha = await book(page, id, open.first, "Alpha Customer");
  const beta = await book(page, id, open.last, "Beta Customer");

  await openBookings(page);
  await chooseView(page, "Day");
  await reveal(page, open.dayKey);

  const alphaEvent = eventOf(page, "Alpha Customer");
  const betaEvent = eventOf(page, "Beta Customer");
  await expect(alphaEvent).toHaveCount(1);
  await expect(betaEvent).toHaveCount(1);
  await expectPlaced(page, alphaEvent, alpha, zone);
  await expectPlaced(page, betaEvent, beta, zone);

  // The distance between the two is the distance between their times.
  const a = localParts(alpha.startAt, zone);
  const b = localParts(beta.startAt, zone);
  const apart = b.hour * 60 + b.minute - (a.hour * 60 + a.minute);
  const aBox = (await alphaEvent.boundingBox())!;
  const bBox = (await betaEvent.boundingBox())!;
  expect(Math.abs(bBox.y - aBox.y - (apart / 60) * HOUR_PX)).toBeLessThanOrEqual(1.5);

  // Title, customer, time range and status are on the block (and read by assistive technology).
  await expect(alphaEvent).toContainText("Alpha Customer");
  await expect(alphaEvent).toHaveAttribute(
    "aria-label",
    new RegExp(
      `Alpha Customer, .*${clockText(a.hour, a.minute)}.*Confirmed`,
    ),
  );
  await expect(alphaEvent).toHaveAttribute("data-status", "confirmed");
});

test("CAL-03: Week view puts each appointment in its own day column at its real time", async ({
  page,
}) => {
  const { id, zone } = await openWorkspace(page);
  const open = roomyDay(await freeSlots(page, id));
  const booked = await book(page, id, open.first, "Week Customer");

  await openBookings(page);
  await chooseView(page, "Week");
  await reveal(page, open.dayKey);

  // Seven columns, Sunday first, and the one holding the appointment is the right one.
  const days = page.locator('[data-testid="calendar-day"]');
  await expect(days).toHaveCount(7);
  expect(await days.first().getAttribute("data-date")).toBe(
    weekStartKey(open.dayKey),
  );
  const event = eventOf(page, "Week Customer");
  await expect(event).toHaveCount(1);
  await expectPlaced(page, event, booked, zone);

  // A day heading opens that day on its own.
  await page
    .locator(`[data-date="${open.dayKey}"] >> role=button`)
    .first()
    .click();
  await expect(grid(page)).toHaveAttribute("data-view", "day");
  await expect(eventOf(page, "Week Customer")).toHaveCount(1);
});

test("CAL-04: Month view shows each appointment on its day, with a count past three, and opens it", async ({
  page,
}) => {
  const { id } = await openWorkspace(page);
  const open = roomyDay(await freeSlots(page, id));

  // Four appointments, one after another, on the same day.
  const names = ["Month One", "Month Two", "Month Three", "Month Four"];
  let from = 0;
  let booked = 0;
  for (const name of names) {
    const next = (await freeSlots(page, id)).find(
      (slot) => slot.dayKey === open.dayKey && Date.parse(slot.startAt) >= from,
    );
    if (!next) break;
    const made = await book(page, id, next.startAt, name);
    from = Date.parse(made.endAt);
    booked += 1;
  }
  expect(booked, "room for four appointments on the busiest day").toBe(4);

  await openBookings(page);
  await chooseView(page, "Month");
  const cell = await reveal(page, open.dayKey);

  // Whole weeks: a multiple of seven cells.
  expect((await page.getByTestId("calendar-day").count()) % 7).toBe(0);
  // Three on the day, then "+1 more".
  await expect(cell.getByTestId("calendar-event")).toHaveCount(3);
  await expect(cell.getByText("+1 more")).toBeVisible();

  // A chip opens the appointment's full details.
  await cell.getByTestId("calendar-event").first().click();
  await expect(details(page)).toBeVisible();
  await expect(details(page)).toContainText("Month One");

  // The month moves on.
  const range = page.getByTestId("schedule-range");
  const month = await range.innerText();
  await page.getByRole("button", { name: "Next dates" }).click();
  await expect(range).not.toHaveText(month);
});

test("CAL-05: a new appointment appears on the calendar at once, without reloading the page", async ({
  page,
}) => {
  const { id } = await openWorkspace(page);
  await openBookings(page);
  await page.evaluate(() => {
    (window as unknown as { __samePage: string }).__samePage = "yes";
  });

  const startAt = await bookInPicker(page, "Fresh Customer");
  await page.getByRole("button", { name: "Confirm Appointment" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Appointment confirmed for" }),
  ).toBeVisible();
  const event = eventOf(page, "Fresh Customer");
  await expect(event).toHaveCount(1);
  await expectStart(event, startAt);

  // The same page, not a reload.
  expect(
    await page.evaluate(
      () => (window as unknown as { __samePage?: string }).__samePage,
    ),
  ).toBe("yes");
  // And it is really stored.
  expect((await stored(page, id)).map((row) => row.customerName)).toContain(
    "Fresh Customer",
  );
});

test("CAL-06: details can be edited and an appointment rescheduled, both showing at once and staying after a reload", async ({
  page,
}) => {
  const { id } = await openWorkspace(page);
  const open = roomyDay(await freeSlots(page, id));
  const booked = await book(page, id, open.first, "Before Edit");

  await openBookings(page);
  await reveal(page, open.dayKey);
  await page.evaluate(() => {
    (window as unknown as { __samePage: string }).__samePage = "yes";
  });
  await eventOf(page, "Before Edit").click();
  await expect(details(page)).toContainText("Before Edit");

  // Edit the customer's details.
  await details(page).getByRole("button", { name: "Edit details" }).click();
  await details(page).getByLabel("Customer").fill("After Edit");
  await details(page).getByLabel("Phone").fill("514 555 0123");
  await details(page).getByLabel("Address").fill("12 Rue Principale");
  await details(page).getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Details updated." }),
  ).toBeVisible();
  await expect(details(page)).toContainText("After Edit");
  await expect(details(page).getByRole("link", { name: /514.?555.?0123/ })).toHaveAttribute(
    "href",
    /^tel:\+1.*5145550123$/,
  );
  await expect(details(page)).toContainText("12 Rue Principale");
  await expect(eventOf(page, "After Edit")).toHaveCount(1);
  await expect(eventOf(page, "Before Edit")).toHaveCount(0);

  // Reschedule it to the last time of that day.
  await details(page).getByRole("button", { name: "Reschedule", exact: true }).click();
  await expect(
    details(page).getByRole("heading", { name: "Choose a new date and time" }),
  ).toBeVisible();
  const picker = details(page).getByTestId("schedule-picker");
  await pickDay(picker, open.dayKey);
  const target = picker.locator("button[data-slot]").last();
  const movedTo = (await target.getAttribute("data-slot"))!;
  expect(Date.parse(movedTo)).not.toBe(Date.parse(booked.startAt));
  await target.click();
  await details(page).getByRole("button", { name: "Confirm New Time" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Appointment moved to" }),
  ).toBeVisible();
  await expectStart(eventOf(page, "After Edit"), movedTo);
  // Neither the edit nor the move reloaded the page.
  expect(
    await page.evaluate(
      () => (window as unknown as { __samePage?: string }).__samePage,
    ),
  ).toBe("yes");

  // Stored, and still there after a reload; the old time is free again.
  const row = (await stored(page, id)).find((item) => item.id === booked.id)!;
  expect(Date.parse(row.startAt)).toBe(Date.parse(movedTo));
  expect(row.customerName).toBe("After Edit");
  expect(row.serviceAddress).toBe("12 Rue Principale");
  const free = (await freeSlots(page, id)).map((slot) => Date.parse(slot.startAt));
  expect(free).toContain(Date.parse(booked.startAt));
  await page.reload();
  await expect(grid(page)).toBeVisible();
  await reveal(page, open.dayKey);
  await expectStart(eventOf(page, "After Edit"), movedTo);
});

test("CAL-07: canceling marks the appointment canceled, frees its time, and keeps the record", async ({
  page,
}) => {
  const { id } = await openWorkspace(page);
  const open = roomyDay(await freeSlots(page, id));
  const booked = await book(page, id, open.first, "Cancel Me");

  await openBookings(page);
  await reveal(page, open.dayKey);
  await eventOf(page, "Cancel Me").click();
  await details(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await details(page).getByLabel("Reason (optional)").fill("Customer called");
  await details(page).getByRole("button", { name: "Yes, cancel it" }).click();

  await expect(page.getByTestId("details-status")).toHaveText("Canceled");
  // A canceled appointment leaves the grid, and its time is bookable again...
  await expect(eventOf(page, "Cancel Me")).toHaveCount(0);
  const free = (await freeSlots(page, id)).map((slot) => Date.parse(slot.startAt));
  expect(free).toContain(Date.parse(booked.startAt));
  // ...but the record is kept, with its status, and can be shown.
  const row = (await stored(page, id)).find((item) => item.id === booked.id)!;
  expect(row.status).toBe("canceled");
  await page.getByLabel("Show canceled").check();
  await expect(eventOf(page, "Cancel Me")).toHaveAttribute("data-status", "canceled");
});

test("CAL-08: appointments are exactly where they were after a refresh, and after signing out and in", async ({
  page,
}) => {
  const { id, zone, email, clientIp } = await openWorkspace(page);
  const open = roomyDay(await freeSlots(page, id));
  const booked = await book(page, id, open.first, "Stays Put");

  await openBookings(page);
  await reveal(page, open.dayKey);
  const label = await eventOf(page, "Stays Put").getAttribute("aria-label");
  expect(label).toBeTruthy();

  const same = async (when: string) => {
    await reveal(page, open.dayKey);
    const event = eventOf(page, "Stays Put");
    await expect(event, when).toHaveCount(1);
    await expectStart(event, booked.startAt);
    await expect(event).toHaveAttribute("aria-label", label!);
    await expectPlaced(page, event, booked, zone);
  };

  await page.reload();
  await expect(grid(page)).toBeVisible();
  await same("after a refresh");

  // Sign out, sign back in as the same person: a new session, the same calendar.
  await page.context().clearCookies();
  await signInAs(page, email, clientIp);
  await openBookings(page);
  await same("after signing in again");
});

test("CAL-09: the same appointment reads the same clock time from any browser time zone", async ({
  page,
  browser,
}) => {
  const { id, zone, email, clientIp } = await openWorkspace(page);
  const open = roomyDay(await freeSlots(page, id));
  const booked = await book(page, id, open.first, "Zone Check");
  const { hour, minute } = localParts(booked.startAt, zone);

  const labels: string[] = [];
  for (const timezoneId of ["Pacific/Auckland", "America/Los_Angeles"]) {
    const context = await browser.newContext({
      timezoneId,
      extraHTTPHeaders: { "x-forwarded-for": freshIp() },
    });
    const other = await context.newPage();
    await signInAs(other, email, clientIp);
    await openBookings(other);
    await reveal(other, open.dayKey);
    const event = eventOf(other, "Zone Check");
    await expect(event).toHaveCount(1);
    await expectPlaced(other, event, booked, zone);
    const label = (await event.getAttribute("aria-label"))!;
    // The business's clock, not the browser's.
    expect(label).toContain(clockText(hour, minute));
    labels.push(label);
    await context.close();
  }
  expect(labels[0]).toBe(labels[1]);
});

test("CAL-11: a taken time is refused, and the calendar never shows two appointments in one time", async ({
  page,
}) => {
  const { id } = await openWorkspace(page);
  const open = roomyDay(await freeSlots(page, id));
  const booked = await book(page, id, open.first, "First In");

  const clash = await page.request.post(`/api/businesses/${id}/appointments`, {
    data: { startAt: open.first, customerName: "Second In" },
  });
  expect(clash.status()).toBe(409);
  expect(await clash.json()).toMatchObject({ ok: false, confirmed: false, reason: "conflict" });

  // A time that is not a real moment, or has no offset, is refused rather than guessed.
  for (const startAt of ["2026-13-45T10:00:00Z", "2026-12-01T10:00:00", "soon"]) {
    const bad = await page.request.post(`/api/businesses/${id}/appointments`, {
      data: { startAt, customerName: "Bad Time" },
    });
    expect(bad.status(), startAt).toBe(400);
  }
  // A backwards range is refused.
  const backwards = await page.request.get(
    `/api/businesses/${id}/appointments?from=2026-12-02T00:00:00Z&to=2026-12-01T00:00:00Z`,
  );
  expect(backwards.status()).toBe(400);

  const names = (await stored(page, id)).map((row) => row.customerName);
  expect(names).toEqual(["First In"]);
  await openBookings(page);
  await reveal(page, open.dayKey);
  await expect(page.getByTestId("calendar-event")).toHaveCount(1);
  expect(booked.status).toBe("confirmed");
});

test("CAL-12: a double click, a retry and parallel requests make one appointment", async ({
  page,
}) => {
  const { id } = await openWorkspace(page);
  await openBookings(page);

  // Three quick clicks on Confirm: one request, one appointment.
  const posts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/businesses\/[^/]+\/appointments$/.test(request.url())
    )
      posts.push(request.url());
  });
  await bookInPicker(page, "Click Twice");
  await page
    .getByRole("button", { name: "Confirm Appointment" })
    .click({ clickCount: 3 });
  await expect(
    page.getByRole("status").filter({ hasText: "Appointment confirmed for" }),
  ).toBeVisible();
  expect(posts).toHaveLength(1);
  await expect(eventOf(page, "Click Twice")).toHaveCount(1);
  expect((await stored(page, id)).filter((row) => row.customerName === "Click Twice")).toHaveLength(1);

  // The same request sent five times at once (a retry storm) is one appointment.
  const open = roomyDay(await freeSlots(page, id));
  const key = randomUUID();
  const sameKey = await Promise.all(
    Array.from({ length: 5 }, () =>
      page.request.post(`/api/businesses/${id}/appointments`, {
        data: { startAt: open.first, customerName: "Same Key", idempotencyKey: key },
      }),
    ),
  );
  const ids = new Set<string>();
  for (const response of sameKey) {
    expect([200, 201]).toContain(response.status());
    ids.add(((await response.json()) as { appointment: Booked }).appointment.id);
  }
  expect(ids.size).toBe(1);
  expect((await stored(page, id)).filter((row) => row.customerName === "Same Key")).toHaveLength(1);

  // Five different people grabbing one time at once: exactly one gets it.
  const race = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      page.request.post(`/api/businesses/${id}/appointments`, {
        data: { startAt: open.last, customerName: `Racer ${index}` },
      }),
    ),
  );
  const statuses = race.map((response) => response.status()).sort();
  expect(statuses).toEqual([201, 409, 409, 409, 409]);
  expect((await stored(page, id)).filter((row) => /^Racer/.test(row.customerName ?? ""))).toHaveLength(1);
});

test("CAL-13: when the service fails the person is told, nothing is shown as saved, and a retry books once", async ({
  page,
}) => {
  const { id, zone } = await openWorkspace(page);
  await openBookings(page);
  const startAt = await bookInPicker(page, "Outage Customer");
  const dayKey = localParts(startAt, zone).day;

  const outage = "**/api/businesses/*/appointments";
  await page.route(outage, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({
      status: 503,
      json: {
        ok: false,
        error: "The calendar is temporarily unavailable, so this was not completed. Please try again in a moment.",
        code: "service_unavailable",
      },
    });
  });
  await page.getByRole("button", { name: "Confirm Appointment" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /temporarily unavailable.*not completed/ }),
  ).toBeVisible();
  // No false success: nothing on the calendar, nothing stored, no "confirmed" message.
  await expect(eventOf(page, "Outage Customer")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "confirmed" })).toHaveCount(0);
  expect(await stored(page, id)).toEqual([]);
  // The chosen time is kept, so Confirm again is a plain retry.
  await expect(page.getByTestId("confirm-panel")).toBeVisible();
  await page.unroute(outage);
  await page.getByRole("button", { name: "Confirm Appointment" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Appointment confirmed for" }),
  ).toBeVisible();
  await expect(eventOf(page, "Outage Customer")).toHaveCount(1);
  expect(await stored(page, id)).toHaveLength(1);

  // Loading the calendar can fail too: say so, offer a retry, then recover.
  await page.route(outage, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 503, json: { ok: false, code: "service_unavailable" } });
  });
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not reach the scheduling service" }),
  ).toBeVisible();
  await page.unroute(outage);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await reveal(page, dayKey);
  await expect(eventOf(page, "Outage Customer")).toHaveCount(1);
});

test("CAL-14: another business cannot see, change, cancel or book into this calendar", async ({
  browser,
}) => {
  const contextA = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const contextB = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const a = await openWorkspace(pageA);
  const b = await openWorkspace(pageB);
  expect(a.id).not.toBe(b.id);
  const open = roomyDay(await freeSlots(pageA, a.id));
  const mine = await book(pageA, a.id, open.first, "Private To A");

  const origin = new URL(pageA.url()).origin;
  const base = `/api/businesses/${a.id}`;
  const attempts = [
    pageB.request.get(`${base}/appointments`),
    pageB.request.get(`${base}/appointments/${mine.id}`),
    pageB.request.get(`${base}/availability?month=${open.dayKey.slice(0, 7)}`),
    pageB.request.post(`${base}/appointments`, {
      data: { startAt: open.last, customerName: "Intruder" },
      headers: { origin },
    }),
    pageB.request.patch(`${base}/appointments/${mine.id}`, {
      data: { customerName: "Hijacked" },
      headers: { origin },
    }),
    pageB.request.post(`${base}/appointments/${mine.id}/cancel`, {
      data: {},
      headers: { origin },
    }),
    pageB.request.post(`${base}/appointments/${mine.id}/reschedule`, {
      data: { startAt: open.last },
      headers: { origin },
    }),
  ];
  for (const response of await Promise.all(attempts))
    expect(response.status(), response.url()).toBe(403);

  // Signed out, nothing answers either.
  const anonymous = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  expect([401, 403]).toContain((await anonymous.request.get(`${base}/appointments`)).status());
  await anonymous.close();

  // A's appointment is untouched, B's own calendar does not show it, and A's own still works.
  const own = (await stored(pageA, a.id)).find((row) => row.id === mine.id)!;
  expect(own.customerName).toBe("Private To A");
  expect(own.status).toBe("confirmed");
  expect(await stored(pageB, b.id)).toEqual([]);
  await openBookings(pageB);
  await expect(pageB.getByTestId("calendar-event")).toHaveCount(0);
  await contextA.close();
  await contextB.close();
});

test("CAL-15: on a phone the calendar fits the screen and every view can be used", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { id, zone } = await openWorkspace(page);
  const open = roomyDay(await freeSlots(page, id));
  const booked = await book(page, id, open.first, "Phone Customer", {
    customerPhoneE164: "+15145550123",
  });

  await openBookings(page);
  // The one-day view is the phone's starting point.
  await expect(grid(page)).toHaveAttribute("data-view", "day");
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // Day: the appointment is on the hour grid, big enough to tap, and opens its details.
  await reveal(page, open.dayKey);
  const event = eventOf(page, "Phone Customer");
  await expect(event).toHaveCount(1);
  await expectPlaced(page, event, booked, zone);
  const box = (await event.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(120);
  expect(box.height).toBeGreaterThanOrEqual(MIN_EVENT_PX);
  await event.click();
  await expect(details(page)).toBeVisible();
  const panel = (await details(page).boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(390 + 0.5);
  for (const name of ["Edit details", "Reschedule", "Cancel"]) {
    const button = details(page).getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(24);
  }
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // Week: the columns scroll inside the calendar, never the page.
  await chooseView(page, "Week");
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(
    await grid(page).evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(true);
  await reveal(page, open.dayKey);
  await expect(eventOf(page, "Phone Customer")).toHaveCount(1);

  // Month: a count on each busy day, tapping it opens that day.
  await chooseView(page, "Month");
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  const cell = await reveal(page, open.dayKey);
  const badge = cell.getByRole("button", { name: "1 appointment", exact: true });
  await expect(badge).toBeVisible();
  const badgeBox = (await badge.boundingBox())!;
  expect(badgeBox.width).toBeGreaterThanOrEqual(24);
  expect(badgeBox.height).toBeGreaterThanOrEqual(24);
  await badge.click();
  await expect(grid(page)).toHaveAttribute("data-view", "day");
  await expect(eventOf(page, "Phone Customer")).toHaveCount(1);

  // No accessibility violations in the calendar or the details.
  const violations = (
    await new AxeBuilder({ page })
      .include("[data-testid='calendar-grid']")
      .include("[data-testid='appointment-details']")
      .analyze()
  ).violations;
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
});

test("the calendar is fully translated (fr) and times stay in the business's zone", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (/MISSING_MESSAGE|INVALID_MESSAGE/.test(message.text()))
      problems.push(message.text());
  });
  const { id } = await openWorkspace(page, "fr");
  const open = roomyDay(await freeSlots(page, id));
  await book(page, id, open.first, "Client Calendrier");
  await page.goto("/fr/app/bookings");
  await expect(grid(page)).toBeVisible();
  await reveal(page, open.dayKey, "Dates suivantes");
  await expect(page.getByRole("button", { name: "Semaine", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("schedule-zone")).toContainText("Les heures sont affichées");
  await eventOf(page, "Client Calendrier").click();
  await expect(details(page).getByRole("button", { name: "Modifier les détails" })).toBeVisible();
  for (const [name, view] of [
    ["Jour", "day"],
    ["Mois", "month"],
  ] as const) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(grid(page)).toHaveAttribute("data-view", view);
  }
  expect(problems).toEqual([]);
});
