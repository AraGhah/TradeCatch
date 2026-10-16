import type { AutomationConfig } from "./types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

export function zonedParts(now: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  let hour = Number(pick("hour"));
  if (hour === 24) hour = 0;
  const weekday = WEEKDAYS.indexOf(pick("weekday") as (typeof WEEKDAYS)[number]);
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
  config: Pick<AutomationConfig, "windowStartHour" | "windowEndHour" | "weekendSending">,
): boolean {
  const parts = zonedParts(now, timeZone);
  const weekend = parts.weekday === 0 || parts.weekday === 6;
  if (weekend && !config.weekendSending) return false;
  const minutes = parts.hour * 60 + parts.minute;
  return minutes >= config.windowStartHour * 60 && minutes < config.windowEndHour * 60;
}

/** Next instant inside the contractor's window. Uses the IANA zone, so DST shifts are included. */
export function nextWindowStart(
  from: Date,
  timeZone: string,
  config: Pick<AutomationConfig, "windowStartHour" | "windowEndHour" | "weekendSending">,
): Date {
  if (isInsideSendingWindow(from, timeZone, config)) return from;
  for (let i = 1; i <= 8 * 24 * 12; i++) {
    const candidate = new Date(from.getTime() + i * 5 * 60 * 1000);
    if (isInsideSendingWindow(candidate, timeZone, config)) return candidate;
  }
  return new Date(from.getTime() + 24 * 60 * 60 * 1000);
}
