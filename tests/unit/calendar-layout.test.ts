/**
 * KAN-19, the part of the calendar that decides WHERE things go. Pure
 * functions, no React: the hourly grid, the week and month membership, and
 * daylight-saving days.
 *
 *   CAL-02  day view: hourly positions from the real start and end
 *   CAL-03  week view: the right day column, in the business's own zone
 *   CAL-04  month view: every cell, with its appointments
 *   CAL-10  DST transitions
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  eventBox,
  eventsByDay,
  hourWindow,
  localMinutes,
  monthDays,
  openRange,
  placeDay,
  rangeToInstants,
  visibleDays,
  visibleRange,
  weekStart,
  zonedDayStart,
} from "../../src/components/app/calendar-layout";

type Item = { id: string; startAt: string; endAt: string; status: string };
const item = (id: string, startAt: string, endAt: string, status = "confirmed"): Item => ({ id, startAt, endAt, status });

const TORONTO = "America/Toronto";
const VANCOUVER = "America/Vancouver";

const HOURS = {
  "0": null,
  "1": { open: "08:00", close: "17:00" },
  "2": { open: "08:00", close: "17:00" },
  "3": { open: "08:00", close: "17:00" },
  "4": { open: "08:00", close: "17:00" },
  "5": { open: "08:00", close: "17:00" },
  "6": null,
};

describe("CAL-02 the hourly grid", () => {
  it("CAL-02 puts a job at its real start and gives it its real length", () => {
    // 2026-10-19 is a Monday; EDT is UTC-4, so 14:00Z is 10:00 and 15:30Z is 11:30.
    const placed = placeDay([item("a", "2026-10-19T14:00:00.000Z", "2026-10-19T15:30:00.000Z")], "2026-10-19", TORONTO);
    assert.equal(placed.length, 1);
    assert.equal(placed[0]!.startMin, 600);
    assert.equal(placed[0]!.endMin, 690);
    // The grid starts at 08:00 and an hour is 56px tall.
    assert.deepEqual(eventBox(placed[0]!, 8 * 60, 56), { top: 112, height: 84 });
  });

  it("CAL-02 the same instant sits at a different hour in a different business zone", () => {
    const row = item("a", "2026-10-19T14:00:00.000Z", "2026-10-19T15:00:00.000Z");
    assert.equal(placeDay([row], "2026-10-19", TORONTO)[0]!.startMin, 10 * 60);
    assert.equal(placeDay([row], "2026-10-19", VANCOUVER)[0]!.startMin, 7 * 60);
    // 07:00 in Vancouver is still the 19th there, and is not on the 18th or 20th.
    assert.equal(placeDay([row], "2026-10-18", VANCOUVER).length, 0);
    assert.equal(placeDay([row], "2026-10-20", VANCOUVER).length, 0);
  });

  it("CAL-02 puts two overlapping jobs side by side and a later job back at full width", () => {
    const placed = placeDay(
      [
        item("a", "2026-10-19T14:00:00.000Z", "2026-10-19T16:00:00.000Z"),
        item("b", "2026-10-19T15:00:00.000Z", "2026-10-19T16:30:00.000Z"),
        item("c", "2026-10-19T17:00:00.000Z", "2026-10-19T18:00:00.000Z"),
      ],
      "2026-10-19",
      TORONTO,
    );
    const by = Object.fromEntries(placed.map((p) => [p.item.id, p]));
    assert.deepEqual([by.a!.lane, by.a!.lanes], [0, 2]);
    assert.deepEqual([by.b!.lane, by.b!.lanes], [1, 2]);
    assert.deepEqual([by.c!.lane, by.c!.lanes], [0, 1]);
  });

  it("CAL-02 keeps a short job tall enough to read and clips a job to the day it is on", () => {
    const placed = placeDay([item("a", "2026-10-19T14:00:00.000Z", "2026-10-19T14:10:00.000Z")], "2026-10-19", TORONTO);
    assert.equal(placed[0]!.endMin - placed[0]!.startMin, 10, "the real length is kept");
    assert.ok(eventBox(placed[0]!, 8 * 60, 56).height >= 20, "but it can still be clicked");
    // A job that runs past midnight is cut at the end of its first day and starts the next at 00:00.
    const late = item("l", "2026-10-20T01:00:00.000Z", "2026-10-20T05:00:00.000Z"); // 21:00 to 01:00 Toronto
    assert.equal(placeDay([late], "2026-10-19", TORONTO)[0]!.endMin, 24 * 60);
    assert.equal(placeDay([late], "2026-10-20", TORONTO)[0]!.startMin, 0);
    assert.equal(placeDay([late], "2026-10-20", TORONTO)[0]!.endMin, 60);
  });

  it("CAL-02 the grid follows the business's hours and stretches for a job outside them", () => {
    const days = ["2026-10-19"]; // a Monday: 08:00-17:00
    assert.deepEqual(hourWindow({ hours: HOURS, days, placed: [] }), { startHour: 8, endHour: 17 });
    const early = placeDay([item("a", "2026-10-19T10:30:00.000Z", "2026-10-19T11:30:00.000Z")], "2026-10-19", TORONTO); // 06:30
    const late = placeDay([item("b", "2026-10-19T22:00:00.000Z", "2026-10-19T23:30:00.000Z")], "2026-10-19", TORONTO); // 18:00-19:30
    assert.deepEqual(hourWindow({ hours: HOURS, days, placed: [...early, ...late] }), { startHour: 6, endHour: 20 });
    // A closed day, or hours nobody has set, still gets a usable grid.
    assert.deepEqual(hourWindow({ hours: HOURS, days: ["2026-10-18"], placed: [] }), { startHour: 8, endHour: 18 });
    assert.deepEqual(hourWindow({ hours: undefined, days, placed: [] }), { startHour: 8, endHour: 18 });
  });

  it("CAL-02 knows which part of a day is open", () => {
    assert.deepEqual(openRange("2026-10-19", HOURS), { openMin: 480, closeMin: 1020 });
    assert.equal(openRange("2026-10-18", HOURS), null, "Sunday is closed");
    assert.equal(openRange("2026-10-19", undefined), null);
  });
});

describe("CAL-03 the week", () => {
  it("CAL-03 a week is Sunday to Saturday around the day you are on", () => {
    assert.equal(weekStart("2026-10-21"), "2026-10-18"); // Wednesday -> Sunday
    assert.equal(weekStart("2026-10-18"), "2026-10-18");
    assert.equal(weekStart("2026-10-24"), "2026-10-18"); // Saturday
    assert.deepEqual(visibleDays("week", "2026-10-21"), [
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
    ]);
    assert.deepEqual(visibleRange("week", "2026-10-21"), { from: "2026-10-18", to: "2026-10-24" });
    assert.deepEqual(visibleDays("day", "2026-10-21"), ["2026-10-21"]);
  });

  it("CAL-03 a week can cross a month and a year", () => {
    assert.deepEqual(visibleRange("week", "2026-12-30"), { from: "2026-12-27", to: "2027-01-02" });
    assert.deepEqual(visibleRange("week", "2026-03-01"), { from: "2026-03-01", to: "2026-03-07" });
  });

  it("CAL-03 an appointment lands in the column of its own local day, not its UTC day", () => {
    // 02:30Z on the 20th is still 22:30 on the 19th in Toronto.
    const row = item("a", "2026-10-20T02:30:00.000Z", "2026-10-20T03:30:00.000Z");
    const week = visibleDays("week", "2026-10-21");
    const byDay = eventsByDay([row], week, TORONTO);
    assert.deepEqual([...byDay.entries()].filter(([, list]) => list.length).map(([day]) => day), ["2026-10-19"]);
  });

  it("CAL-03 asks the server for exactly the days on screen, in the business's zone", () => {
    const range = rangeToInstants(visibleRange("week", "2026-10-21"), TORONTO);
    assert.equal(range.from, "2026-10-18T04:00:00.000Z"); // 00:00 EDT on Sunday
    assert.equal(range.to, "2026-10-25T04:00:00.000Z"); // 00:00 EDT the Sunday after
  });
});

describe("CAL-04 the month", () => {
  it("CAL-04 fills whole weeks, with the neighbouring days dimmed", () => {
    const days = monthDays("2026-10"); // 1 Oct 2026 is a Thursday, 31 Oct a Saturday
    assert.equal(days.length % 7, 0);
    assert.equal(days.length, 35);
    assert.deepEqual(days[0], { key: "2026-09-27", inMonth: false });
    assert.deepEqual(days[4], { key: "2026-10-01", inMonth: true });
    assert.deepEqual(days.at(-1), { key: "2026-10-31", inMonth: true });
    assert.equal(days.filter((day) => day.inMonth).length, 31);
  });

  it("CAL-04 a month that needs six rows gets six, and February can need only four", () => {
    assert.equal(monthDays("2026-11").length, 35); // 1 Nov 2026 is a Sunday and it has 30 days
    assert.equal(monthDays("2027-05").length, 42); // 1 May 2027 is a Saturday and it has 31 days
    assert.equal(monthDays("2026-02").length, 28); // 1 Feb 2026 is a Sunday and it has 28 days
  });

  it("CAL-04 the month's range covers its first and last cell", () => {
    assert.deepEqual(visibleRange("month", "2026-10-15"), { from: "2026-09-27", to: "2026-10-31" });
  });

  it("CAL-04 each cell lists its own appointments in time order", () => {
    const rows = [
      item("late", "2026-10-19T18:00:00.000Z", "2026-10-19T19:00:00.000Z"),
      item("early", "2026-10-19T13:00:00.000Z", "2026-10-19T14:00:00.000Z"),
      item("other", "2026-10-21T13:00:00.000Z", "2026-10-21T14:00:00.000Z"),
    ];
    const byDay = eventsByDay(rows, monthDays("2026-10").map((day) => day.key), TORONTO);
    assert.deepEqual(byDay.get("2026-10-19")!.map((row) => row.id), ["early", "late"]);
    assert.deepEqual(byDay.get("2026-10-21")!.map((row) => row.id), ["other"]);
    assert.deepEqual(byDay.get("2026-10-20"), []);
  });
});

describe("CAL-10 daylight saving", () => {
  it("CAL-10 the day the clocks go forward is 23 hours long and the next one starts an hour earlier in UTC", () => {
    // Toronto, 8 March 2026: 02:00 EST becomes 03:00 EDT.
    assert.equal(zonedDayStart("2026-03-08", TORONTO).toISOString(), "2026-03-08T05:00:00.000Z");
    assert.equal(zonedDayStart("2026-03-09", TORONTO).toISOString(), "2026-03-09T04:00:00.000Z");
    const range = rangeToInstants({ from: "2026-03-08", to: "2026-03-08" }, TORONTO);
    assert.equal((Date.parse(range.to) - Date.parse(range.from)) / 3_600_000, 23);
  });

  it("CAL-10 the day the clocks go back is 25 hours long", () => {
    // Toronto, 1 November 2026: 02:00 EDT becomes 01:00 EST.
    assert.equal(zonedDayStart("2026-11-01", TORONTO).toISOString(), "2026-11-01T04:00:00.000Z");
    assert.equal(zonedDayStart("2026-11-02", TORONTO).toISOString(), "2026-11-02T05:00:00.000Z");
    const range = rangeToInstants({ from: "2026-11-01", to: "2026-11-01" }, TORONTO);
    assert.equal((Date.parse(range.to) - Date.parse(range.from)) / 3_600_000, 25);
  });

  it("CAL-10 10:00 is 10:00 on both sides of the change, though it is a different UTC time", () => {
    const winter = item("w", "2026-03-06T15:00:00.000Z", "2026-03-06T16:00:00.000Z"); // 10:00 EST
    const summer = item("s", "2026-03-09T14:00:00.000Z", "2026-03-09T15:00:00.000Z"); // 10:00 EDT
    assert.equal(placeDay([winter], "2026-03-06", TORONTO)[0]!.startMin, 600);
    assert.equal(placeDay([summer], "2026-03-09", TORONTO)[0]!.startMin, 600);
  });

  it("CAL-10 a job on the spring-forward morning sits at its wall-clock time", () => {
    // 03:00 EDT on 8 March does not follow 02:00: there is no 02:00 that day.
    const row = item("a", "2026-03-08T07:00:00.000Z", "2026-03-08T08:00:00.000Z");
    const placed = placeDay([row], "2026-03-08", TORONTO)[0]!;
    assert.equal(placed.startMin, 180);
    assert.equal(placed.endMin, 240);
    assert.equal(localMinutes("2026-03-08T06:59:00.000Z", TORONTO), 119, "01:59 EST is the last minute before the jump");
    assert.equal(localMinutes("2026-03-08T07:00:00.000Z", TORONTO), 180);
  });

  it("CAL-10 the repeated hour on the fall-back morning shows both jobs, side by side", () => {
    const first = item("edt", "2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"); // 01:30 EDT
    const second = item("est", "2026-11-01T06:30:00.000Z", "2026-11-01T07:30:00.000Z"); // 01:30 EST
    const placed = placeDay([first, second], "2026-11-01", TORONTO);
    assert.equal(placed.length, 2, "neither is lost");
    assert.equal(placed[0]!.startMin, 90);
    assert.equal(placed[1]!.startMin, 90);
    // The wall clock reads 01:30 at both ends of the first job. It is still an hour long.
    assert.equal(placed[0]!.endMin - placed[0]!.startMin, 60);
    assert.equal(placed[1]!.endMin - placed[1]!.startMin, 60);
    assert.equal(placed[0]!.lanes, 2);
  });

  it("CAL-10 a job that spans the clock change keeps its real length", () => {
    // 01:00 EST to 04:00 EDT on 8 March is two hours of real time (01:00-02:00, then 03:00-04:00).
    const row = item("a", "2026-03-08T06:00:00.000Z", "2026-03-08T08:00:00.000Z");
    const placed = placeDay([row], "2026-03-08", TORONTO)[0]!;
    assert.equal(placed.startMin, 60);
    assert.equal(placed.endMin - placed.startMin, 120);
  });

  it("CAL-10 a zone with a half-hour offset and no DST still lines up", () => {
    assert.equal(zonedDayStart("2026-03-08", "Asia/Kolkata").toISOString(), "2026-03-07T18:30:00.000Z");
    assert.equal(localMinutes("2026-03-08T04:30:00.000Z", "Asia/Kolkata"), 600);
  });
});
