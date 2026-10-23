import type { AutomationConfig } from "./types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

type SendingWindow = Pick<
  AutomationConfig,
  "windowStartHour" | "windowEndHour" | "weekendSending"
> & {
  startMinute?: number;
  endMinute?: number;
};

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

export function zonedParts(now: Date, timeZone: string): ZonedParts {
  return partsWithFormatter(now, formatter(timeZone));
}

function formatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
}

function partsWithFormatter(now: Date, fmt: Intl.DateTimeFormat): ZonedParts {
  const parts = fmt.formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  let hour = Number(pick("hour"));
  if (hour === 24) hour = 0;
  const weekday = WEEKDAYS.indexOf(
    pick("weekday") as (typeof WEEKDAYS)[number],
  );
  return {
    year: Number(pick("year")),
    month: Number(pick("month")),
    day: Number(pick("day")),
    hour,
    minute: Number(pick("minute")),
    weekday: weekday < 0 ? 0 : weekday,
  };
}

export function isInsideSendingWindow(
  now: Date,
  timeZone: string,
  config: SendingWindow,
): boolean {
  return insideWindow(zonedParts(now, timeZone), config);
}

function insideWindow(parts: ZonedParts, config: SendingWindow): boolean {
  const weekend = parts.weekday === 0 || parts.weekday === 6;
  if (weekend && !config.weekendSending) return false;
  const minutes = parts.hour * 60 + parts.minute;
  const start = config.windowStartHour * 60 + (config.startMinute ?? 0);
  const end = config.windowEndHour * 60 + (config.endMinute ?? 0);
  return start > end
    ? minutes >= start || minutes < end
    : minutes >= start && minutes < end;
}

/** Next instant inside the contractor's window. Uses the IANA zone, so DST shifts are included. */
export function nextWindowStart(
  from: Date,
  timeZone: string,
  config: SendingWindow,
): Date {
  const fmt = formatter(timeZone);
  if (insideWindow(partsWithFormatter(from, fmt), config)) return from;
  const minute = Math.floor(from.getTime() / 60_000) * 60_000;
  for (let i = 1; i <= 8 * 24 * 60; i++) {
    const candidate = new Date(minute + i * 60_000);
    if (insideWindow(partsWithFormatter(candidate, fmt), config))
      return candidate;
  }
  return new Date(from.getTime() + 24 * 60 * 60 * 1000);
}
