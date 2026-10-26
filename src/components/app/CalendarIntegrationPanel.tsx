"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Status = {
  status: string;
  calendarId?: string;
  calendarSummary?: string;
  accountEmail?: string;
  lastError?: string;
};

export function CalendarIntegrationPanel({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = useTranslations("app.schedule");
  const [calendar, setCalendar] = useState<Status | null>(null);
  const [calendarId, setCalendarId] = useState("");
  const [summary, setSummary] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [availability, setAvailability] = useState<{
    googlePilot: boolean;
    configured: boolean;
  } | null>(null);

  const load = useCallback(
    () =>
      fetch(`/api/businesses/${organizationId}/calendar/status`)
        .then(async (response) => ({
          response,
          data: (await response.json()) as {
            calendar?: Status;
            availability?: { googlePilot: boolean; configured: boolean };
          },
        }))
        .then(({ response, data }) => {
          if (!response.ok || !data.availability)
            throw new Error("Calendar unavailable");
          setAvailability(data.availability);
          setCalendar(data.calendar ?? null);
          setCalendarId(data.calendar?.calendarId ?? "");
          setSummary(data.calendar?.calendarSummary ?? "");
        }),
    [organizationId],
  );

  useEffect(() => {
    void load().catch(() => {
      setIsError(true);
      setMessage(t("connectionError"));
    });
  }, [load, t]);

  async function connect() {
    if (busy) return;
    setBusy(true);
    setIsError(false);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/businesses/${organizationId}/calendar/connect`,
        { method: "POST" },
      );
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setIsError(true);
      setMessage(data.error || t("notConfigured"));
    } catch {
      setIsError(true);
      setMessage(t("connectionError"));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    setIsError(false);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/businesses/${organizationId}/calendar/disconnect`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Disconnect failed");
      await load();
    } catch {
      setIsError(true);
      setMessage(t("connectionError"));
    } finally {
      setBusy(false);
    }
  }

  async function chooseCalendar() {
    if (busy) return;
    setBusy(true);
    setIsError(false);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/businesses/${organizationId}/calendar/calendars`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            calendarId,
            summary: summary || calendarId,
          }),
        },
      );
      setIsError(!res.ok);
      setMessage(res.ok ? t("saved") : t("error"));
      await load();
    } catch {
      setIsError(true);
      setMessage(t("connectionError"));
    } finally {
      setBusy(false);
    }
  }

  const statusKey =
    calendar?.status === "connected" ||
    calendar?.status === "disconnected" ||
    calendar?.status === "expired" ||
    calendar?.status === "simulated"
      ? calendar.status
      : "disconnected";

  if (!availability)
    return (
      <p role={isError ? "alert" : "status"}>
        {message ?? t("calendarLoading")}
      </p>
    );
  if (!availability.googlePilot || !availability.configured)
    return (
      <section
        data-testid="calendar-availability"
        className="flex max-w-xl flex-col gap-4 rounded-md border border-navy/10 bg-white p-4"
      >
        <h2 className="font-semibold">{t("calendarPilotTitle")}</h2>
        <p>{t("calendarPilotNotice")}</p>
        <p className="text-sm">{t("calendarSimulationNotice")}</p>
        {availability.googlePilot && !availability.configured ? (
          <p>{t("notConfigured")}</p>
        ) : null}
      </section>
    );

  return (
    <div
      data-testid="calendar-availability"
      className="flex max-w-xl flex-col gap-4 rounded-md border border-navy/10 bg-white p-4"
    >
      <p className="text-sm font-semibold">{t("calendarPilotTitle")}</p>
      <p className="text-sm text-navy/70">{t("calendarIntro")}</p>
      <p className="text-sm text-navy">
        {t("status")}: <strong>{t(statusKey)}</strong>
        {calendar?.accountEmail ? ` · ${calendar.accountEmail}` : ""}
        {calendar?.calendarSummary ? ` · ${calendar.calendarSummary}` : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void connect()}
          className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {t("connect")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void disconnect()}
          className="rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {t("disconnect")}
        </button>
      </div>
      <label className="text-sm">
        {t("calendarId")}
        <input
          value={calendarId}
          onChange={(event) => setCalendarId(event.target.value)}
          className="mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5"
        />
      </label>
      <label className="text-sm">
        {t("summary")}
        <input
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          className="mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5"
        />
      </label>
      <button
        type="button"
        disabled={busy}
        className="rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold disabled:opacity-50"
        onClick={() => void chooseCalendar()}
      >
        {t("choose")}
      </button>
      {message ? (
        <p role={isError ? "alert" : "status"} className="text-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
}
