"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  eventBox,
  eventsByDay,
  hourWindow,
  localMinutes,
  monthDays,
  openRange,
  placeDay,
  visibleDays,
  type CalendarItem,
  type CalendarView,
  type OpeningHours,
  type PlacedItem,
} from "./calendar-layout";
import {
  formatDayKey,
  formatSlotTime,
  weekdayNames,
} from "./schedule-picker-utils";

export type CalendarAppointment = CalendarItem & {
  customerName?: string;
  serviceName: string;
  technicianName?: string;
  simulated?: boolean;
};

type Props<Row extends CalendarAppointment> = {
  view: CalendarView;
  /** Any day inside what is shown ("YYYY-MM-DD", business-local). */
  anchor: string;
  /** What to draw. The caller has already applied its filters. */
  rows: Row[];
  /** The business's zone: every hour on the grid is read in it. */
  zone: string;
  locale: string;
  todayKey: string;
  now: number;
  hours?: OpeningHours;
  selectedId?: string | null;
  /** The period's name for assistive technology, e.g. "October 2026". */
  caption: string;
  onSelect: (row: Row) => void;
  /** A day was chosen (its heading in the week, its number in the month): show it on its own. */
  onPickDay: (dayKey: string) => void;
};

/** How tall an hour is on the grid. */
const HOUR_PX = 56;
const GUTTER = "3.5rem";
const WEEK_COLUMN = "6.5rem";

const STATUS_STYLE: Record<string, string> = {
  confirmed: "border-navy bg-navy/10 text-navy",
  pending: "border-amber-600 bg-amber-50 text-amber-950",
  completed: "border-emerald-700 bg-emerald-50 text-emerald-950",
  canceled: "border-navy/40 bg-navy/5 text-navy/70 line-through",
};
const statusStyle = (status: string) =>
  STATUS_STYLE[status] ?? "border-navy/40 bg-navy/5 text-navy";

function hourLabel(hour: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    hour: "numeric",
  }).format(new Date(Date.UTC(2023, 0, 1, hour)));
}

function dayParts(day: string, locale: string) {
  const at = new Date(`${day}T00:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      weekday: "short",
    }).format(at),
    number: Number(day.slice(8, 10)),
  };
}

export function AppointmentCalendar<Row extends CalendarAppointment>(
  props: Props<Row>,
) {
  const days = useMemo(
    () => visibleDays(props.view, props.anchor),
    [props.view, props.anchor],
  );
  return props.view === "month" ? (
    <MonthView {...props} />
  ) : (
    <TimeGrid {...props} days={days} />
  );
}

/* -------------------------------------------------------------------------- */
/* Day and week: the hourly grid                                              */
/* -------------------------------------------------------------------------- */

function TimeGrid<Row extends CalendarAppointment>({
  view,
  days,
  rows,
  zone,
  locale,
  todayKey,
  now,
  hours,
  selectedId,
  caption,
  onSelect,
  onPickDay,
}: Props<Row> & { days: string[] }) {
  const t = useTranslations("app.schedule");
  const scroller = useRef<HTMLDivElement>(null);
  const week = view === "week";

  const placedByDay = useMemo(
    () => days.map((day) => placeDay(rows, day, zone)),
    [days, rows, zone],
  );
  const { startHour, endHour } = useMemo(
    () => hourWindow({ hours, days, placed: placedByDay.flat() }),
    [hours, days, placedByDay],
  );
  const windowStart = startHour * 60;
  const windowEnd = endHour * 60;
  const bodyHeight = (endHour - startHour) * HOUR_PX;

  // Bring the first job of the period into view when the grid is taller than the screen.
  const firstStart = useMemo(
    () =>
      placedByDay
        .flat()
        .reduce((least, entry) => Math.min(least, entry.startMin), Infinity),
    [placedByDay],
  );
  const dayKeys = days.join(",");
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = Number.isFinite(firstStart)
      ? ((firstStart - windowStart) / 60) * HOUR_PX - HOUR_PX
      : 0;
    el.scrollTop = Math.max(0, target);
  }, [dayKeys, firstStart, windowStart]);

  const template = `${GUTTER} repeat(${days.length}, minmax(${week ? WEEK_COLUMN : "0"}, 1fr))`;
  const nowMin = localMinutes(new Date(now), zone);
  const lines = Array.from(
    { length: endHour - startHour + 1 },
    (_, i) => startHour + i,
  );

  return (
    <div
      ref={scroller}
      role="region"
      tabIndex={0}
      aria-label={`${t("calendarGrid")}: ${caption}`}
      data-testid="calendar-grid"
      data-view={view}
      className="max-h-[70vh] overflow-auto rounded-xl border border-navy/10 bg-white focus-visible:outline-2 focus-visible:outline-navy"
    >
      <div
        style={{
          minWidth: week
            ? `calc(${GUTTER} + ${days.length} * ${WEEK_COLUMN})`
            : undefined,
        }}
      >
        {/* Day headings stay in view while the hours scroll. */}
        <div
          className="sticky top-0 z-30 grid border-b border-navy/10 bg-white"
          style={{ gridTemplateColumns: template }}
        >
          <div className="sticky left-0 z-40 bg-white" />
          {days.map((day) => {
            const parts = dayParts(day, locale);
            const today = day === todayKey;
            const closed = hours !== undefined && !openRange(day, hours);
            const label = week ? (
              <>
                <span className="block text-xs uppercase tracking-wide text-navy/70">
                  {parts.weekday}
                </span>
                {/* Invisible, but keeps "Sun" and "15" apart for a checker. */}
                {" "}
                <span
                  className={`mx-auto mt-0.5 inline-flex size-7 items-center justify-center rounded-full text-sm font-bold ${today ? "bg-navy text-white" : "text-navy"}`}
                >
                  {parts.number}
                </span>
              </>
            ) : (
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-bold ${today ? "bg-navy text-white" : "text-navy"}`}
              >
                {formatDayKey(day, locale)}
              </span>
            );
            return (
              <div
                key={day}
                data-date={day}
                aria-current={today ? "date" : undefined}
                className={`border-l border-navy/10 px-1 py-1.5 text-center ${today ? "bg-navy/5" : ""}`}
              >
                {week ? (
                  <button
                    type="button"
                    onClick={() => onPickDay(day)}
                    // The button shows "Sun 15": its spoken label starts with
                    // that, then gives the whole date.
                    aria-label={`${parts.weekday} ${parts.number}, ${formatDayKey(day, locale)}`}
                    className="w-full rounded-md focus-visible:outline-2 focus-visible:outline-navy"
                  >
                    {label}
                  </button>
                ) : (
                  label
                )}
                {closed ? (
                  <span className="mt-0.5 block text-[11px] text-navy/70">
                    {t("closed")}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        <div
          className="relative grid"
          style={{ gridTemplateColumns: template, height: bodyHeight }}
        >
          {/* Hour lines run across every column behind the jobs. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 z-0"
            style={{ left: GUTTER }}
          >
            {lines.slice(0, -1).map((hour) => (
              <div
                key={hour}
                data-testid="calendar-hour-line"
                data-hour={hour}
                className="absolute inset-x-0 border-t border-navy/10"
                style={{ top: (hour - startHour) * HOUR_PX }}
              />
            ))}
          </div>

          <div className="sticky left-0 z-20 bg-white" aria-hidden="true">
            {lines.slice(0, -1).map((hour) => (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-[11px] text-navy/70"
                style={{ top: (hour - startHour) * HOUR_PX + (hour === startHour ? 8 : 0) }}
              >
                {hourLabel(hour, locale)}
              </span>
            ))}
          </div>

          {days.map((day, index) => {
            const today = day === todayKey;
            const open = openRange(day, hours);
            const shade = (from: number, to: number) =>
              to > from ? (
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 bg-navy/[0.045]"
                  style={{
                    top: ((from - windowStart) / 60) * HOUR_PX,
                    height: ((to - from) / 60) * HOUR_PX,
                  }}
                />
              ) : null;
            return (
              <div
                key={day}
                data-date={day}
                data-testid="calendar-day"
                className={`relative z-10 border-l border-navy/10 ${today ? "bg-navy/[0.03]" : ""}`}
              >
                {hours === undefined
                  ? null
                  : open
                    ? (
                        <>
                          {shade(windowStart, Math.min(open.openMin, windowEnd))}
                          {shade(Math.max(open.closeMin, windowStart), windowEnd)}
                        </>
                      )
                    : shade(windowStart, windowEnd)}
                {placedByDay[index]!.map((placed) => (
                  <EventBlock
                    key={`${placed.item.id}:${day}`}
                    placed={placed}
                    windowStart={windowStart}
                    zone={zone}
                    locale={locale}
                    selected={placed.item.id === selectedId}
                    onSelect={onSelect}
                  />
                ))}
                {today && nowMin >= windowStart && nowMin <= windowEnd ? (
                  <div
                    aria-hidden="true"
                    data-testid="calendar-now"
                    className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-600"
                    style={{ top: ((nowMin - windowStart) / 60) * HOUR_PX }}
                  >
                    <span className="absolute -left-1 -top-[5px] size-2 rounded-full bg-red-600" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EventBlock<Row extends CalendarAppointment>({
  placed,
  windowStart,
  zone,
  locale,
  selected,
  onSelect,
}: {
  placed: PlacedItem<Row>;
  windowStart: number;
  zone: string;
  locale: string;
  selected: boolean;
  onSelect: (row: Row) => void;
}) {
  const t = useTranslations("app.schedule");
  const row = placed.item;
  const box = eventBox(placed, windowStart, HOUR_PX);
  const title = row.customerName || row.serviceName;
  const range = `${formatSlotTime(row.startAt, zone, locale)} – ${formatSlotTime(row.endAt, zone, locale)}`;
  const status = t(row.status as "pending");
  const practice = row.simulated ? `${t("practice")} · ` : "";
  const roomy = box.height >= 64;
  // The service has its own line only when the customer's name is the title.
  const serviceLine = roomy && Boolean(row.customerName);
  const share = 100 / placed.lanes;
  // WCAG 2.5.3 (Label in Name): what a person reads on the block is the start
  // of what assistive technology says, in the same order. The title and the
  // time come first; whatever the block has no room for follows.
  const spoken = [
    title,
    range,
    `${practice}${status}`,
    row.customerName ? row.serviceName : "",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
      aria-label={spoken}
      aria-current={selected ? "true" : undefined}
      data-testid="calendar-event"
      data-status={row.status}
      data-start={row.startAt}
      className={`absolute overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-xs leading-tight shadow-sm focus-visible:outline-2 focus-visible:outline-navy ${statusStyle(row.status)} ${selected ? "ring-2 ring-navy" : ""} ${row.simulated ? "italic" : ""}`}
      style={{
        top: box.top,
        height: box.height,
        left: `calc(${placed.lane * share}% + 1px)`,
        width: `calc(${share}% - 2px)`,
      }}
    >
      {/* The spaces between the lines are invisible (each line is a block), but
          they keep the words apart in the text a screen reader or a checker
          reads: without them "Customer" and "8:00" run together. */}
      <span className="block truncate font-semibold">{title}</span>{" "}
      <span className="block truncate text-[11px]">
        {box.height >= 40 ? `${range} · ${practice}${status}` : range}
      </span>
      {serviceLine ? (
        <>
          {" "}
          <span className="block truncate">{row.serviceName}</span>
        </>
      ) : null}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Month                                                                      */
/* -------------------------------------------------------------------------- */

const CHIPS_PER_DAY = 3;

function MonthView<Row extends CalendarAppointment>({
  anchor,
  rows,
  zone,
  locale,
  todayKey,
  selectedId,
  caption,
  onSelect,
  onPickDay,
}: Props<Row>) {
  const t = useTranslations("app.schedule");
  const cells = useMemo(() => monthDays(anchor.slice(0, 7)), [anchor]);
  const byDay = useMemo(
    () =>
      eventsByDay(
        rows,
        cells.map((cell) => cell.key),
        zone,
      ),
    [rows, cells, zone],
  );
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) =>
    cells.slice(i * 7, i * 7 + 7),
  );
  return (
    <div
      className="overflow-hidden rounded-xl border border-navy/10 bg-white"
      data-testid="calendar-grid"
      data-view="month"
    >
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">{`${t("calendarGrid")}: ${caption}`}</caption>
        <thead>
          <tr>
            {weekdayNames(locale).map((name) => (
              <th
                key={name}
                scope="col"
                className="border-b border-navy/10 py-1.5 text-xs font-semibold uppercase tracking-wide text-navy/70"
              >
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]!.key}>
              {week.map((cell) => {
                const list = byDay.get(cell.key) ?? [];
                const today = cell.key === todayKey;
                return (
                  <td
                    key={cell.key}
                    data-date={cell.key}
                    data-testid="calendar-day"
                    aria-current={today ? "date" : undefined}
                    className={`h-20 border-b border-l border-navy/10 p-1 align-top first:border-l-0 sm:h-28 ${cell.inMonth ? "" : "bg-navy/[0.03]"} ${today ? "bg-navy/5" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => onPickDay(cell.key)}
                      aria-label={`${formatDayKey(cell.key, locale)}${list.length ? `, ${t("eventsCount", { count: list.length })}` : ""}`}
                      className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold focus-visible:outline-2 focus-visible:outline-navy ${today ? "bg-navy text-white" : cell.inMonth ? "text-navy" : "text-navy/70"}`}
                    >
                      {Number(cell.key.slice(8, 10))}
                    </button>
                    <ul className="m-0 mt-1 hidden list-none space-y-0.5 p-0 sm:block">
                      {list.slice(0, CHIPS_PER_DAY).map((row) => (
                        <li key={row.id}>
                          <button
                            type="button"
                            onClick={() => onSelect(row)}
                            aria-label={[
                              // The chip shows the time, then the name: the
                              // spoken label starts the same way.
                              formatSlotTime(row.startAt, zone, locale),
                              row.customerName || row.serviceName,
                              t(row.status as "pending"),
                              row.customerName ? row.serviceName : "",
                            ]
                              .filter(Boolean)
                              .join(", ")}
                            aria-current={row.id === selectedId ? "true" : undefined}
                            data-testid="calendar-event"
                            data-status={row.status}
                            data-start={row.startAt}
                            className={`block w-full truncate rounded border-l-2 px-1 text-left text-[11px] leading-5 focus-visible:outline-2 focus-visible:outline-navy ${statusStyle(row.status)} ${row.id === selectedId ? "ring-2 ring-navy" : ""}`}
                          >
                            {formatSlotTime(row.startAt, zone, locale)}{" "}
                            {row.customerName || row.serviceName}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {list.length > CHIPS_PER_DAY ? (
                      <button
                        type="button"
                        onClick={() => onPickDay(cell.key)}
                        className="mt-0.5 hidden text-[11px] font-semibold text-navy underline sm:block"
                      >
                        {t("moreEvents", { count: list.length - CHIPS_PER_DAY })}
                      </button>
                    ) : null}
                    {/* A phone has no room for names: a count that opens the day. */}
                    {list.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => onPickDay(cell.key)}
                        aria-label={t("eventsCount", { count: list.length })}
                        className="mt-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full bg-navy px-2 text-[11px] font-bold text-white sm:hidden"
                      >
                        {list.length}
                      </button>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
