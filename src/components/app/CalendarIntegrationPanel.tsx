"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { InlineStatus } from "@/components/ui/Spinner";

import { timedFetch } from "@/lib/client/timed-fetch";
import { useGuarded } from "@/lib/client/use-single-flight";
type Status = {
  status: string;
  calendarId?: string;
  calendarSummary?: string;
  accountEmail?: string;
  lastError?: string;
  eventDetail?: "minimal" | "standard";
  cancelPolicy?: "remove" | "mark_canceled";
};

type Sync = {
  lastSuccessfulSyncAt?: string;
  lastError?: string;
  pending: number;
  failed: number;
  needsAttention: {
    appointmentId: string;
    state: "external_modified" | "external_deleted";
    startAt?: string;
  }[];
  overlaps: { appointmentId: string; startAt: string }[];
  push: "active" | "unavailable" | "expiring" | "off";
};

type CalendarOption = { id: string; summary: string };

type Busy = null | "connect" | "disconnect" | "sync" | "save" | "choose";

/** What Google Calendar's own redirect tells the owner when they come back. */
const RESULT_KEYS = {
  connected: "gcalResultConnected",
  choose: "gcalResultChoose",
  denied: "gcalResultDenied",
  scope: "gcalResultScope",
  expired: "gcalResultExpired",
  forbidden: "gcalResultForbidden",
  pilot_required: "gcalResultPilot",
  error: "gcalResultError",
} as const;
type ResultCode = keyof typeof RESULT_KEYS;

const PROBLEM_KEYS: Record<string, string> = {
  google_access_revoked: "gcalErrAccessRevoked",
  google_rate_limited: "gcalErrRateLimited",
  google_unavailable: "gcalErrUnavailable",
  google_permission_denied: "gcalErrPermission",
  google_rejected_request: "gcalErrRejected",
  google_event_missing: "gcalErrEventMissing",
  google_conflict: "gcalErrConflict",
};

const PUSH_KEYS = {
  active: "gcalPushActive",
  expiring: "gcalPushExpiring",
  off: "gcalPushOff",
  unavailable: "gcalPushUnavailable",
} as const;

function formatTime(iso: string | undefined, locale: string, timeZone: string) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const buttonPrimary =
  "rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50";
const buttonSecondary =
  "rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold text-navy disabled:opacity-50";

export function CalendarIntegrationPanel({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = useTranslations("app.schedule");
  const feedback = useTranslations("feedback");
  const locale = useLocale();
  const base = `/api/businesses/${organizationId}/calendar`;

  const [calendar, setCalendar] = useState<Status | null>(null);
  const [sync, setSync] = useState<Sync | null>(null);
  const [timezone, setTimezone] = useState("UTC");
  const [availability, setAvailability] = useState<{
    googlePilot: boolean;
    configured: boolean;
  } | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [changing, setChanging] = useState(false);
  // null = not loaded yet; the chooser shows a loading line meanwhile.
  const [calendars, setCalendars] = useState<CalendarOption[] | null>(null);
  const [calendarsFailed, setCalendarsFailed] = useState(false);
  const [selected, setSelected] = useState("");
  const [eventDetail, setEventDetail] = useState<"minimal" | "standard">("minimal");
  const [cancelPolicy, setCancelPolicy] = useState<"remove" | "mark_canceled">("remove");
  const hint = useRef<string | null>(null);

  const applyStatus = useCallback(
    (nextCalendar: Status | null, nextSync: Sync | null) => {
      setCalendar(nextCalendar);
      setSync(nextSync);
      setEventDetail(nextCalendar?.eventDetail ?? "minimal");
      setCancelPolicy(nextCalendar?.cancelPolicy ?? "remove");
    },
    [],
  );

  const load = useCallback(
    () =>
      timedFetch(`${base}/status`)
        .then(async (response) => ({
          response,
          data: (await response.json()) as {
            calendar?: Status;
            sync?: Sync | null;
            timezone?: string;
            availability?: { googlePilot: boolean; configured: boolean };
          },
        }))
        .then(({ response, data }) => {
          if (!response.ok || !data.availability) {
            throw new Error("Calendar unavailable");
          }
          setAvailability(data.availability);
          setTimezone(data.timezone || "UTC");
          applyStatus(data.calendar ?? null, data.sync ?? null);
        }),
    [base, applyStatus],
  );

  /** Reads the result Google's redirect left in the address, then removes it so a refresh starts clean. */
  const consumeRedirectResult = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("calendar");
    if (!code || !(code in RESULT_KEYS)) return;
    hint.current = params.get("calendarId");
    params.delete("calendar");
    params.delete("calendarId");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
    setMessage({
      text: t(RESULT_KEYS[code as ResultCode]),
      error: code !== "connected" && code !== "choose",
    });
  }, [t]);

  useEffect(() => {
    void load()
      .then(consumeRedirectResult)
      .catch(() => setMessage({ text: t("connectionError"), error: true }));
  }, [load, consumeRedirectResult, t]);

  const needsChoice =
    calendar?.status === "error" && calendar.lastError === "select_calendar";
  const choosing = needsChoice || changing;

  // Fetch the account's calendars whenever the chooser is open and has none yet.
  useEffect(() => {
    if (!choosing || calendars !== null || calendarsFailed) return;
    let live = true;
    void timedFetch(`${base}/calendars`)
      .then(async (response) => ({
        ok: response.ok,
        data: (await response.json()) as { calendars?: CalendarOption[] },
      }))
      .then(({ ok, data }) => {
        if (!live) return;
        if (!ok) {
          setCalendarsFailed(true);
          return;
        }
        const list = data.calendars ?? [];
        setCalendars(list);
        const preferred =
          list.find((entry) => entry.id === hint.current) ??
          list.find((entry) => entry.id === calendar?.calendarId) ??
          list[0];
        setSelected((current) => current || preferred?.id || "");
      })
      .catch(() => {
        if (live) setCalendarsFailed(true);
      });
    return () => {
      live = false;
    };
  }, [choosing, calendars, calendarsFailed, base, calendar?.calendarId]);

  const run = useGuarded(async (kind: Exclude<Busy, null>, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    setMessage(null);
    try {
      await action();
    } catch {
      setMessage({ text: t("connectionError"), error: true });
    } finally {
      setBusy(null);
    }
  });

  const connect = () =>
    run("connect", async () => {
      const res = await timedFetch(`${base}/connect`, { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setMessage({ text: data.error || t("notConfigured"), error: true });
    });

  const disconnect = () =>
    run("disconnect", async () => {
      const res = await timedFetch(`${base}/disconnect`, { method: "POST" });
      if (!res.ok) throw new Error("Disconnect failed");
      setConfirmDisconnect(false);
      setChanging(false);
      setCalendars(null);
      await load();
      setMessage({ text: t("gcalDisconnected"), error: false });
    });

  const syncNow = () =>
    run("sync", async () => {
      const res = await timedFetch(`${base}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
      });
      const data = (await res.json()) as { sync?: Sync };
      if (!res.ok || !data.sync) throw new Error("Sync failed");
      setSync(data.sync);
      await load();
      setMessage({ text: t("gcalSyncDone"), error: false });
    });

  const saveSettings = () =>
    run("save", async () => {
      const res = await timedFetch(`${base}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "settings", eventDetail, cancelPolicy }),
      });
      if (!res.ok) {
        setMessage({ text: t("error"), error: true });
        return;
      }
      await load();
      setMessage({ text: t("saved"), error: false });
    });

  const chooseCalendar = () =>
    run("choose", async () => {
      const res = await timedFetch(`${base}/calendars`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarId: selected }),
      });
      if (!res.ok) {
        setMessage({ text: t("error"), error: true });
        return;
      }
      setChanging(false);
      setCalendars(null);
      setSelected("");
      await load();
      setMessage({ text: t("saved"), error: false });
    });

  if (!availability) {
    return (
      <p role={message?.error ? "alert" : "status"}>
        {message?.text ?? t("calendarLoading")}
      </p>
    );
  }
  if (!availability.googlePilot || !availability.configured) {
    return (
      <section
        data-testid="calendar-availability"
        className="flex max-w-xl flex-col gap-4 rounded-xl border border-navy/10 bg-white p-5 shadow-[0_1px_2px_rgb(12_20_30/0.04)] sm:p-6"
      >
        <h2 className="font-semibold">{t("calendarPilotTitle")}</h2>
        <p>{t("calendarPilotNotice")}</p>
        <p className="text-sm">{t("calendarSimulationNotice")}</p>
        {availability.googlePilot && !availability.configured ? (
          <p>{t("notConfigured")}</p>
        ) : null}
      </section>
    );
  }

  const status = calendar?.status ?? "disconnected";
  const isConnected = status === "connected";
  const hasConnection = status !== "simulated" && status !== "disconnected";
  const statusLabel = needsChoice
    ? t("gcalStatusChoose")
    : status === "error"
      ? t("gcalStatusError")
      : status === "connected" ||
          status === "disconnected" ||
          status === "expired" ||
          status === "simulated"
        ? t(status)
        : t("disconnected");
  const problemCode = needsChoice ? undefined : (sync?.lastError ?? calendar?.lastError);
  const problemText = problemCode
    ? t((PROBLEM_KEYS[problemCode] ?? "gcalErrGeneric") as "gcalErrGeneric")
    : null;
  const when = (iso?: string) => formatTime(iso, locale, timezone);
  const settingsChanged =
    eventDetail !== (calendar?.eventDetail ?? "minimal") ||
    cancelPolicy !== (calendar?.cancelPolicy ?? "remove");

  return (
    <div
      data-testid="calendar-availability"
      className="flex max-w-xl flex-col gap-5 rounded-xl border border-navy/10 bg-white p-5 shadow-[0_1px_2px_rgb(12_20_30/0.04)] sm:p-6"
    >
      {busy ? <InlineStatus>{feedback("working")}</InlineStatus> : null}
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">{t("calendarPilotTitle")}</h2>
        <p className="text-sm text-navy/70">{t("calendarIntro")}</p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-navy">
        <dt className="text-navy/70">{t("status")}</dt>
        <dd>
          <strong data-testid="gcal-status">{statusLabel}</strong>
        </dd>
        {calendar?.accountEmail ? (
          <>
            <dt className="text-navy/70">{t("gcalAccount")}</dt>
            <dd data-testid="gcal-account" className="break-all">
              {calendar.accountEmail}
            </dd>
          </>
        ) : null}
        {isConnected && calendar?.calendarSummary ? (
          <>
            <dt className="text-navy/70">{t("gcalCalendar")}</dt>
            <dd data-testid="gcal-calendar-name">{calendar.calendarSummary}</dd>
          </>
        ) : null}
        {isConnected ? (
          <>
            <dt className="text-navy/70">{t("gcalLastSync")}</dt>
            <dd data-testid="gcal-last-sync">
              {sync?.lastSuccessfulSyncAt
                ? when(sync.lastSuccessfulSyncAt)
                : t("gcalNeverSynced")}
            </dd>
          </>
        ) : null}
      </dl>

      {message ? (
        <p
          data-testid="gcal-banner"
          role={message.error ? "alert" : "status"}
          className={
            message.error
              ? "rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
              : "rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900"
          }
        >
          {message.text}
        </p>
      ) : null}

      {isConnected && sync ? (
        <div className="flex flex-col gap-2 text-sm">
          {sync.failed > 0 ? (
            <p role="alert" className="text-red-700" data-testid="gcal-failed">
              {t("gcalFailed", { count: sync.failed })}
            </p>
          ) : null}
          {sync.pending > 0 ? (
            <p data-testid="gcal-pending">{t("gcalPending", { count: sync.pending })}</p>
          ) : null}
          {sync.pending === 0 && sync.failed === 0 && !problemText ? (
            <p className="text-navy/70" data-testid="gcal-uptodate">
              {t("gcalAllSynced")}
            </p>
          ) : null}
          <p className="text-navy/70">{t(PUSH_KEYS[sync.push])}</p>
        </div>
      ) : null}

      {problemText ? (
        <p
          role="alert"
          data-testid="gcal-problem"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <strong>{t("gcalProblemTitle")}: </strong>
          {problemText}
        </p>
      ) : null}

      {isConnected && sync && sync.needsAttention.length > 0 ? (
        <section data-testid="gcal-attention" className="flex flex-col gap-2 text-sm">
          <h3 className="font-semibold">{t("gcalAttentionTitle")}</h3>
          <p className="text-navy/70">{t("gcalAttentionHelp")}</p>
          <ul className="list-disc pl-5">
            {sync.needsAttention.map((item) => (
              <li key={item.appointmentId}>
                {t(
                  item.state === "external_deleted"
                    ? "gcalAttentionDeleted"
                    : "gcalAttentionModified",
                  { time: when(item.startAt) },
                )}
              </li>
            ))}
          </ul>
          <Link href="/app/bookings" className="font-semibold text-navy underline">
            {t("gcalAttentionOpen")}
          </Link>
        </section>
      ) : null}

      {isConnected && sync && sync.overlaps.length > 0 ? (
        <section data-testid="gcal-overlaps" className="flex flex-col gap-2 text-sm">
          <h3 className="font-semibold">{t("gcalOverlapTitle")}</h3>
          <ul className="list-disc pl-5">
            {sync.overlaps.map((item) => (
              <li key={item.appointmentId}>
                {t("gcalOverlapItem", { time: when(item.startAt) })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!hasConnection ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void connect()}
            className={buttonPrimary}
            data-testid="gcal-connect"
          >
            {t("connect")}
          </button>
        ) : null}
        {isConnected ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void syncNow()}
            className={buttonPrimary}
            data-testid="gcal-sync-now"
          >
            {busy === "sync" ? t("gcalSyncing") : t("gcalSyncNow")}
          </button>
        ) : null}
        {hasConnection ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void connect()}
            className={status === "expired" ? buttonPrimary : buttonSecondary}
            data-testid="gcal-reconnect"
          >
            {t("gcalReconnect")}
          </button>
        ) : null}
        {isConnected && !changing ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => setChanging(true)}
            className={buttonSecondary}
            data-testid="gcal-change"
          >
            {t("gcalChange")}
          </button>
        ) : null}
        {hasConnection && !confirmDisconnect ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => setConfirmDisconnect(true)}
            className={buttonSecondary}
            data-testid="gcal-disconnect"
          >
            {t("disconnect")}
          </button>
        ) : null}
      </div>

      {confirmDisconnect ? (
        <div
          role="group"
          aria-label={t("disconnect")}
          className="flex flex-col gap-3 rounded-md border border-navy/15 bg-navy/5 p-3 text-sm"
          data-testid="gcal-disconnect-confirm"
        >
          <p>{t("gcalDisconnectConfirm")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void disconnect()}
              className={buttonPrimary}
              data-testid="gcal-disconnect-yes"
            >
              {t("gcalDisconnectYes")}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirmDisconnect(false)}
              className={buttonSecondary}
            >
              {t("gcalKeep")}
            </button>
          </div>
        </div>
      ) : null}

      {choosing ? (
        <section className="flex flex-col gap-3" data-testid="gcal-chooser">
          <h3 className="text-sm font-semibold">{t("gcalPickTitle")}</h3>
          {calendarsFailed ? (
            <p role="alert" className="text-sm text-red-700">
              {t("error")}
            </p>
          ) : calendars === null ? (
            <p role="status" className="text-sm text-navy/70">
              {t("gcalPickLoading")}
            </p>
          ) : calendars.length === 0 ? (
            <p role="status" className="text-sm">
              {t("gcalNoCalendars")}
            </p>
          ) : (
            <>
              <label className="text-sm">
                {t("gcalPickLabel")}
                <select
                  value={selected}
                  onChange={(event) => setSelected(event.target.value)}
                  className="mt-1 w-full rounded-md border border-navy/15 bg-white px-2 py-1.5"
                  data-testid="gcal-calendar-select"
                >
                  {calendars.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.summary}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-navy/70">{t("gcalPickHelp")}</p>
              {changing ? (
                <p className="text-xs text-navy/70">{t("gcalChangeNote")}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy !== null || !selected}
                  onClick={() => void chooseCalendar()}
                  className={buttonPrimary}
                  data-testid="gcal-choose"
                >
                  {t("choose")}
                </button>
                {changing ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      setChanging(false);
                      setCalendars(null);
                      setSelected("");
                    }}
                    className={buttonSecondary}
                  >
                    {t("gcalKeep")}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </section>
      ) : null}

      {isConnected ? (
        <section className="flex flex-col gap-4" data-testid="gcal-settings">
          <h3 className="text-sm font-semibold">{t("gcalSettingsTitle")}</h3>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">{t("gcalDetailLabel")}</legend>
            {(["minimal", "standard"] as const).map((value) => (
              <label key={value} className="flex items-start gap-2">
                <input
                  type="radio"
                  name="gcal-event-detail"
                  value={value}
                  checked={eventDetail === value}
                  onChange={() => setEventDetail(value)}
                  className="mt-1"
                />
                <span>
                  {t(value === "minimal" ? "gcalDetailMinimal" : "gcalDetailStandard")}
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">{t("gcalCancelLabel")}</legend>
            {(["remove", "mark_canceled"] as const).map((value) => (
              <label key={value} className="flex items-start gap-2">
                <input
                  type="radio"
                  name="gcal-cancel-policy"
                  value={value}
                  checked={cancelPolicy === value}
                  onChange={() => setCancelPolicy(value)}
                  className="mt-1"
                />
                <span>
                  {t(value === "remove" ? "gcalCancelRemove" : "gcalCancelMark")}
                </span>
              </label>
            ))}
          </fieldset>
          <div>
            <button
              type="button"
              disabled={busy !== null || !settingsChanged}
              onClick={() => void saveSettings()}
              className={buttonSecondary}
              data-testid="gcal-settings-save"
            >
              {t("gcalSettingsSave")}
            </button>
          </div>
        </section>
      ) : null}

      <p className="text-xs text-navy/70">{t("gcalPermissions")}</p>
    </div>
  );
}
