"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

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

const DAY_KEYS = ["1", "2", "3", "4", "5", "6", "0"];

export function AvailabilityEditor({ organizationId }: { organizationId: string }) {
  const t = useTranslations("app.schedule");
  const [rules, setRules] = useState<Rules | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageError, setMessageError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);

  function fetchRules() {
    return fetch(`/api/businesses/${organizationId}/availability`)
      .then((res) => {
        if (!res.ok) throw new Error("Availability unavailable");
        return res.json();
      })
      .then((data) => {
        setRules((data as { rules?: Rules }).rules ?? null);
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

  async function save() {
    if (!rules || busy) return;
    setBusy(true);
    setMessage(null);
    setMessageError(false);
    try {
      const res = await fetch(
        `/api/businesses/${organizationId}/availability`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rules),
        },
      );
      setMessageError(!res.ok);
      setMessage(res.ok ? t("saved") : t("error"));
    } catch {
      setMessageError(true);
      setMessage(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="text-sm text-navy/70">{t("hoursIntro")}</p>
      {DAY_KEYS.map((key) => (
        <label key={key} className="flex items-center gap-2 text-sm text-navy">
          <input
            type="checkbox"
            checked={Boolean(rules.days[key])}
            onChange={(event) =>
              setRules({
                ...rules,
                days: {
                  ...rules.days,
                  [key]: event.target.checked ? rules.days[key] ?? { open: "08:00", close: "18:00" } : null,
                },
              })
            }
          />
          <span className="w-8">{key}</span>
          <input
            value={rules.days[key]?.open ?? ""}
            disabled={!rules.days[key]}
            onChange={(event) =>
              setRules({ ...rules, days: { ...rules.days, [key]: { open: event.target.value, close: rules.days[key]?.close ?? "18:00" } } })
            }
            className="rounded-md border border-navy/15 px-2 py-1"
          />
          <input
            value={rules.days[key]?.close ?? ""}
            disabled={!rules.days[key]}
            onChange={(event) =>
              setRules({ ...rules, days: { ...rules.days, [key]: { open: rules.days[key]?.open ?? "08:00", close: event.target.value } } })
            }
            className="rounded-md border border-navy/15 px-2 py-1"
          />
        </label>
      ))}
      <label className="text-sm">{t("timezone")}
        <input value={rules.timezone} onChange={(event) => setRules({ ...rules, timezone: event.target.value })} className="mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5" />
      </label>
      {([
        ["defaultDurationMinutes", "duration"],
        ["bufferMinutes", "buffer"],
        ["travelBufferMinutes", "travel"],
        ["minimumNoticeMinutes", "notice"],
        ["maxAdvanceDays", "advance"],
      ] as const).map(([field, label]) => (
        <label key={field} className="text-sm">{t(label)}
          <input
            type="number"
            value={rules[field]}
            onChange={(event) => setRules({ ...rules, [field]: Number(event.target.value) })}
            className="mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5"
          />
        </label>
      ))}
      <label className="text-sm">{t("daily")}
        <input
          type="number"
          value={rules.maxDailyBookings ?? ""}
          onChange={(event) => setRules({ ...rules, maxDailyBookings: event.target.value ? Number(event.target.value) : undefined })}
          className="mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5"
        />
      </label>
      <label className="text-sm">{t("holidays")}
        <input
          value={rules.holidays.join(", ")}
          onChange={(event) => setRules({ ...rules, holidays: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}
          className="mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5"
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
        <p role={messageError ? "alert" : "status"} className="text-sm">
          {message}
        </p>
      ) : null}
    </form>
  );
}
