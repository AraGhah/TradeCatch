"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { pickerLocale } from "./schedule-picker-utils";

type Day = { open: string; close: string } | null;
type Rules = {
  timezone: string;
  days: Record<string, Day>;
  defaultDurationMinutes: number;
  bufferMinutes: number;
  travelBufferMinutes: number;
  minimumNoticeMinutes: number;
  maxAdvanceDays: number;
  maxDailyBookings?: number;
  holidays: string[];
};

type Problem =
  | "invalid_timezone"
  | "invalid_hours"
  | "invalid_holiday"
  | "invalid_values";

// Monday first; the stored key is the JavaScript weekday (0 = Sunday).
const DAY_KEYS = ["1", "2", "3", "4", "5", "6", "0"];
const HH_MM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const CANADA_ZONES = [
  "America/St_Johns",
  "America/Halifax",
  "America/Moncton",
  "America/Toronto",
  "America/Winnipeg",
  "America/Regina",
  "America/Edmonton",
  "America/Vancouver",
  "America/Whitehorse",
];
const NUMBER_FIELDS = [
  ["defaultDurationMinutes", "duration", 15, 480],
  ["bufferMinutes", "buffer", 0, 240],
  ["travelBufferMinutes", "travel", 0, 240],
  ["minimumNoticeMinutes", "notice", 0, 10_080],
  ["maxAdvanceDays", "advance", 1, 365],
] as const;
const PROBLEM_MESSAGE = {
  invalid_timezone: "errorTimezone",
  invalid_hours: "errorHours",
  invalid_holiday: "errorHoliday",
  invalid_values: "errorValues",
} as const;
const INPUT = "mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5";

function isZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function otherZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone").filter(
      (zone) => !CANADA_ZONES.includes(zone),
    );
  } catch {
    return [];
  }
}

function isRealDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

export function AvailabilityEditor({ organizationId }: { organizationId: string }) {
  const t = useTranslations("app.schedule");
  const locale = pickerLocale(useLocale());
  const [rules, setRules] = useState<Rules | null>(null);
  // Typed freely and read on save: splitting on every keystroke ate the comma.
  const [holidaysText, setHolidaysText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageError, setMessageError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);

  const dayNames = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      weekday: "long",
    });
    // 2023-01-01 was a Sunday.
    return Object.fromEntries(
      DAY_KEYS.map((key) => [
        key,
        format.format(new Date(Date.UTC(2023, 0, 1 + Number(key)))),
      ]),
    );
  }, [locale]);
  const zones = useMemo(() => otherZones(), []);

  function fetchRules() {
    return fetch(`/api/businesses/${organizationId}/availability`)
      .then((res) => {
        if (!res.ok) throw new Error("Availability unavailable");
        return res.json();
      })
      .then((data) => {
        const next = (data as { rules?: Rules }).rules ?? null;
        setRules(next);
        setHolidaysText((next?.holidays ?? []).join(", "));
        setLoadError(false);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }

  function retry() {
    setLoading(true);
    setLoadError(false);
    void fetchRules();
  }

  useEffect(() => {
    void fetchRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  if (loadError) {
    return (
      <div role="alert" className="max-w-xl text-sm text-red-700">
        <p>{t("connectionError")}</p>
        <button
          type="button"
          className="mt-1 font-semibold underline"
          onClick={retry}
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  if (loading || !rules) return <p role="status">{t("calendarLoading")}</p>;

  function fail(problem: Problem) {
    setMessageError(true);
    setMessage(t(PROBLEM_MESSAGE[problem]));
  }

  async function save() {
    if (!rules || busy) return;
    setMessage(null);
    setMessageError(false);
    const holidays = holidaysText
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!isZone(rules.timezone)) return fail("invalid_timezone");
    const badHours = DAY_KEYS.some((key) => {
      const hours = rules.days[key];
      return (
        hours &&
        !(
          HH_MM.test(hours.open) &&
          HH_MM.test(hours.close) &&
          hours.open < hours.close
        )
      );
    });
    if (badHours) return fail("invalid_hours");
    if (!holidays.every(isRealDay)) return fail("invalid_holiday");
    setBusy(true);
    try {
      const res = await fetch(
        `/api/businesses/${organizationId}/availability`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...rules, holidays }),
        },
      );
      if (res.ok) {
        setRules({ ...rules, holidays });
        setHolidaysText(holidays.join(", "));
        setMessage(t("saved"));
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { code?: string };
      setMessageError(true);
      setMessage(
        data.code && data.code in PROBLEM_MESSAGE
          ? t(PROBLEM_MESSAGE[data.code as Problem])
          : t("error"),
      );
    } catch {
      setMessageError(true);
      setMessage(t("error"));
    } finally {
      setBusy(false);
    }
  }

  function setDay(key: string, day: Day) {
    if (!rules) return;
    setRules({ ...rules, days: { ...rules.days, [key]: day } });
  }

  const knownZone =
    CANADA_ZONES.includes(rules.timezone) || zones.includes(rules.timezone);

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="text-sm text-navy/70">{t("hoursIntro")}</p>
      <div className="grid gap-2">
        {DAY_KEYS.map((key) => {
          const hours = rules.days[key];
          const name = dayNames[key];
          return (
            <div
              key={key}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-navy"
            >
              <label className="flex min-h-9 w-32 shrink-0 items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={Boolean(hours)}
                  onChange={(event) =>
                    setDay(
                      key,
                      event.target.checked
                        ? (hours ?? { open: "08:00", close: "18:00" })
                        : null,
                    )
                  }
                />
                <span className="capitalize">{name}</span>
              </label>
              {hours ? (
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="time"
                    required
                    aria-label={`${name}: ${t("opens")}`}
                    value={hours.open}
                    onChange={(event) =>
                      setDay(key, { open: event.target.value, close: hours.close })
                    }
                    className="min-w-0 flex-1 rounded-md border border-navy/15 px-2 py-1"
                  />
                  <span aria-hidden="true">–</span>
                  <input
                    type="time"
                    required
                    aria-label={`${name}: ${t("closes")}`}
                    value={hours.close}
                    onChange={(event) =>
                      setDay(key, { open: hours.open, close: event.target.value })
                    }
                    className="min-w-0 flex-1 rounded-md border border-navy/15 px-2 py-1"
                  />
                </span>
              ) : (
                <span className="text-navy/60">{t("closed")}</span>
              )}
            </div>
          );
        })}
      </div>
      <label className="text-sm">
        {t("timezone")}
        <select
          value={rules.timezone}
          onChange={(event) =>
            setRules({ ...rules, timezone: event.target.value })
          }
          className={INPUT}
        >
          {knownZone ? null : (
            <option value={rules.timezone}>{rules.timezone}</option>
          )}
          <optgroup label={t("timezoneCanada")}>
            {CANADA_ZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
          </optgroup>
          {zones.length > 0 ? (
            <optgroup label={t("timezoneOther")}>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, " ")}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </label>
      {NUMBER_FIELDS.map(([field, label, min, max]) => (
        <label key={field} className="text-sm">
          {t(label)}
          <input
            type="number"
            required
            min={min}
            max={max}
            step={1}
            value={Number.isFinite(rules[field]) ? rules[field] : ""}
            onChange={(event) =>
              setRules({
                ...rules,
                [field]: event.target.value === "" ? NaN : Number(event.target.value),
              })
            }
            className={INPUT}
          />
        </label>
      ))}
      <label className="text-sm">
        {t("daily")}
        <input
          type="number"
          min={1}
          max={100}
          step={1}
          value={rules.maxDailyBookings ?? ""}
          onChange={(event) =>
            setRules({
              ...rules,
              maxDailyBookings: event.target.value
                ? Number(event.target.value)
                : undefined,
            })
          }
          className={INPUT}
        />
      </label>
      <label className="text-sm">
        {t("holidays")}
        <input
          value={holidaysText}
          onChange={(event) => setHolidaysText(event.target.value)}
          placeholder="2026-12-25, 2027-01-01"
          className={INPUT}
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? t("saving") : t("save")}
      </button>
      {message ? (
        <p
          role={messageError ? "alert" : "status"}
          className={`text-sm ${messageError ? "text-red-700" : "text-navy"}`}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
