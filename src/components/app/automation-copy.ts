import type { AutomationRecord } from "@/product/sms-automation/types";
import { splitMinutes } from "@/product/sms-automation/status";

/**
 * Wording that depends on an automation's real settings, so what the screen says about
 * timing is what the scheduler does. Plain functions of `t` (a translator scoped to
 * `app.automations`), used by server pages and client components alike. Nothing here
 * reads the clock or the browser's locale: the same input gives the same words on the
 * server and in the browser.
 */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** "1 day", "2 hours and 30 minutes". Zero parts are left out. */
export function formatDuration(totalMinutes: number, t: Translate): string {
  const { days, hours, minutes } = splitMinutes(totalMinutes);
  const parts: string[] = [];
  if (days > 0) parts.push(t("duration.days", { count: days }));
  if (hours > 0) parts.push(t("duration.hours", { count: hours }));
  if (minutes > 0 || parts.length === 0) parts.push(t("duration.minutes", { count: minutes }));
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return t("duration.and2", { a: parts[0]!, b: parts[1]! });
  return t("duration.and3", { a: parts[0]!, b: parts[1]!, c: parts[2]! });
}

/**
 * A date and time written for the business's own time zone and the person's language, or
 * null when there is none. The zone is always given, so the server and the browser, and a
 * server running in UTC, all show the owner's local time.
 */
export function formatWhen(iso: string | undefined | null, locale: string, timeZone: string): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(at);
}

/** An hour of the day (0 to 24) the way the language writes it: "8 a.m.", "20 h", "noon". */
export function formatHour(hour: number, locale: string, t: Translate): string {
  const h = Number.isFinite(hour) ? Math.min(Math.max(Math.trunc(hour), 0), 24) : 0;
  if (h === 0 || h === 24) return t("time.midnight");
  if (h === 12) return t("time.noon");
  if (locale === "fr") return t("time.hour24", { hour: h });
  return t(h < 12 ? "time.am" : "time.pm", { hour: h % 12 });
}

/**
 * The "When it runs" lines for an automation, from its stored settings:
 *  - missed-call: the delay, and what quiet hours do;
 *  - quote reminders: the real reminder times, and the sending hours that hold them back;
 *  - appointments: the fixed confirmation and reminder, and the sending hours.
 * The two automations that are not available yet have none.
 */
export function describeSchedule(
  automation: Pick<AutomationRecord, "type" | "config">,
  t: Translate,
  locale: string,
): string[] {
  const { config } = automation;
  const hours = {
    start: formatHour(config.windowStartHour, locale, t),
    end: formatHour(config.windowEndHour, locale, t),
    weekends: config.weekendSending ? "yes" : "no",
  };

  switch (automation.type) {
    case "missed_call_recovery": {
      const delay = config.initialDelayMinutes;
      return [
        delay > 0
          ? t("when.missedAfter", { delay: formatDuration(delay, t) })
          : t("when.missedNow"),
        config.respectQuietHours === true ? t("when.quietOn", hours) : t("when.quietOff"),
      ];
    }
    case "quote_followup": {
      const first = config.initialDelayMinutes;
      const second = config.secondDelayMinutes ?? first + 2 * 24 * 60;
      // The scheduler plans one step, or two when two or more attempts are allowed.
      const two = config.maxAttempts >= 2;
      const kind = first > 0 ? "later" : "now";
      return [
        two
          ? t("when.quoteTwo", {
              kind,
              first: formatDuration(first, t),
              second: formatDuration(second, t),
            })
          : t("when.quoteOne", { kind, first: formatDuration(first, t) }),
        t("when.hoursWait", hours),
      ];
    }
    case "appointment_reminder":
      return [t("when.appointment"), t("when.hoursWait", hours)];
    default:
      return [];
  }
}
