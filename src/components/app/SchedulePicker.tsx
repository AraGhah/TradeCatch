"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { MonthAvailability } from "@/product/scheduling/types";
import {
  dateKeyInZone,
  formatDayKey,
  formatMonth,
  formatSlotTime,
  monthGrid,
  partOfDay,
  pickerLocale,
  shiftMonth,
  timezoneLabel,
  weekdayNames,
} from "./schedule-picker-utils";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy";

type PickerProps = {
  organizationId: string;
  serviceId?: string;
  serviceAddress?: string;
  /** Reschedule: this appointment's own time must not count as busy. */
  excludeAppointmentId?: string;
  /** ISO start of the chosen time, or "". */
  value: string;
  onChange: (startAt: string) => void;
  /** The chosen time stopped being free after a refresh (service or data changed). */
  onLost?: () => void;
  /** Called with the business timezone once the first availability arrives. */
  onTimezone?: (timeZone: string) => void;
  /** Change this number to reload (for example after "no longer available"). */
  reloadKey?: number;
};

/**
 * Month calendar, then the times for the chosen day grouped Morning/Afternoon.
 * Everything shown comes from the scheduling engine (`/availability?month=`):
 * business hours, holidays, existing appointments, buffers, notice, the
 * advance limit and Google Calendar busy blocks. A day with no free time is
 * disabled, so nothing offered here is already taken.
 */
export function SchedulePicker({
  organizationId,
  serviceId,
  serviceAddress,
  excludeAppointmentId,
  value,
  onChange,
  onLost,
  onTimezone,
  reloadKey = 0,
}: PickerProps) {
  const t = useTranslations("app.schedule");
  const locale = pickerLocale(useLocale());
  const uid = useId();
  const [requested, setRequested] = useState("");
  const [shown, setShown] = useState<MonthAvailability | null>(null);
  const [outcome, setOutcome] = useState<{
    key: string;
    failed: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [date, setDate] = useState("");

  // The address only changes travel time: wait for the typing to pause.
  const [address, setAddress] = useState(serviceAddress ?? "");
  useEffect(() => {
    const timer = window.setTimeout(
      () => setAddress(serviceAddress ?? ""),
      600,
    );
    return () => window.clearTimeout(timer);
  }, [serviceAddress]);

  const latest = useRef({ value, onTimezone, onLost });
  useEffect(() => {
    latest.current = { value, onTimezone, onLost };
  });

  const requestKey = [
    requested,
    serviceId ?? "",
    address,
    excludeAppointmentId ?? "",
    reloadKey,
    attempt,
  ].join("|");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (requested) params.set("month", requested);
    else params.set("days", "1");
    if (serviceId) params.set("serviceId", serviceId);
    if (address.trim()) params.set("address", address.trim());
    if (excludeAppointmentId) params.set("exclude", excludeAppointmentId);
    fetch(`/api/businesses/${organizationId}/availability?${params}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`availability ${res.status}`);
        return (await res.json()) as MonthAvailability;
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        setShown(json);
        setOutcome({ key: requestKey, failed: false });
        latest.current.onTimezone?.(json.timezone);
        const picked = latest.current.value;
        if (picked) {
          const day = dateKeyInZone(picked, json.timezone);
          const stillFree =
            !day.startsWith(`${json.month}-`) ||
            (json.days[day] ?? []).some((slot) => slot.startAt === picked);
          if (!stillFree) latest.current.onLost?.();
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setOutcome({ key: requestKey, failed: true });
      });
    return () => controller.abort();
    // requestKey is derived from the other values and changes with them.
  }, [
    organizationId,
    requested,
    serviceId,
    address,
    excludeAppointmentId,
    requestKey,
  ]);

  const loading = outcome?.key !== requestKey;
  const failed = !loading && outcome?.failed === true;
  const month = shown?.month ?? "";
  const today = shown?.today ?? "";
  const canPrev = Boolean(shown) && month > today.slice(0, 7);
  const canNext =
    Boolean(shown) &&
    `${shiftMonth(month, 1)}-01` <= (shown?.lastBookableDate ?? "");
  const daysWithTimes = shown ? Object.keys(shown.days).length : 0;

  function go(delta: number) {
    if (!shown) return;
    setRequested(shiftMonth(shown.month, delta));
    setDate("");
  }

  const daySlots =
    shown && date.startsWith(`${month}-`) ? (shown.days[date] ?? []) : [];
  const groups = (["morning", "afternoon"] as const)
    .map((part) => ({
      part,
      slots: daySlots.filter((slot) => partOfDay(slot.time) === part),
    }))
    .filter((group) => group.slots.length > 0);

  return (
    <div className="flex flex-col gap-4" data-testid="schedule-picker">
      <section aria-labelledby={`${uid}-date`}>
        <h3
          id={`${uid}-date`}
          className="m-0 text-sm font-semibold text-navy"
        >
          {t("pickDate")}
        </h3>

        {failed ? (
          <div
            role="alert"
            className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            <p className="m-0">{t("timesError")}</p>
            <button
              type="button"
              className={`mt-1 font-semibold underline ${FOCUS}`}
              onClick={() => setAttempt((n) => n + 1)}
            >
              {t("retry")}
            </button>
          </div>
        ) : null}

        {!shown && !failed ? (
          <p role="status" className="mt-2 text-sm text-navy/60">
            {t("loadingTimes")}
          </p>
        ) : null}

        {shown ? (
          <div
            className={`mt-2 rounded-md border border-navy/15 bg-white p-3 ${loading ? "opacity-60" : ""}`}
            aria-busy={loading}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                aria-label={t("prevMonth")}
                disabled={!canPrev || loading}
                onClick={() => go(-1)}
                className={`flex h-11 w-11 items-center justify-center rounded-md border border-navy/15 text-lg text-navy hover:bg-navy/5 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`}
              >
                <span aria-hidden="true">‹</span>
              </button>
              <p
                className="m-0 text-center text-base font-semibold capitalize text-navy"
                aria-live="polite"
              >
                {formatMonth(month, locale)}
              </p>
              <button
                type="button"
                aria-label={t("nextMonth")}
                disabled={!canNext || loading}
                onClick={() => go(1)}
                className={`flex h-11 w-11 items-center justify-center rounded-md border border-navy/15 text-lg text-navy hover:bg-navy/5 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`}
              >
                <span aria-hidden="true">›</span>
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center">
              {weekdayNames(locale).map((name, index) => (
                <span
                  key={index}
                  className="py-1 text-xs font-semibold uppercase tracking-wide text-navy/60"
                >
                  {name}
                </span>
              ))}
              {monthGrid(month).map((cell, index) => {
                if (!cell) return <span key={`blank-${index}`} />;
                const free = (shown.days[cell.key]?.length ?? 0) > 0;
                const selected = cell.key === date;
                const isToday = cell.key === today;
                const label = `${formatDayKey(cell.key, locale)}${free ? "" : `, ${t("dayNoTimes")}`}`;
                return (
                  <button
                    key={cell.key}
                    type="button"
                    disabled={!free}
                    data-date={cell.key}
                    aria-label={label}
                    aria-pressed={selected}
                    aria-current={isToday ? "date" : undefined}
                    onClick={() => setDate(cell.key)}
                    className={[
                      "flex h-11 items-center justify-center rounded-md text-sm",
                      FOCUS,
                      selected
                        ? "bg-navy font-semibold text-white"
                        : free
                          ? "border border-navy/20 bg-white font-semibold text-navy hover:bg-navy/5"
                          : "cursor-not-allowed text-navy/30",
                      isToday && !selected ? "ring-2 ring-navy/40" : "",
                    ].join(" ")}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>

            {!loading && daysWithTimes === 0 ? (
              <p className="m-0 mt-3 text-sm text-navy/70">
                {t("noTimesMonth")}
              </p>
            ) : (
              <p className="m-0 mt-3 text-xs text-navy/60">{t("pickHint")}</p>
            )}
          </div>
        ) : null}
      </section>

      {shown && date.startsWith(`${month}-`) ? (
        <section aria-labelledby={`${uid}-time`}>
          <h3
            id={`${uid}-time`}
            className="m-0 text-sm font-semibold text-navy"
          >
            {t("pickTime")} · {formatDayKey(date, locale)}
          </h3>
          {groups.length === 0 ? (
            <p className="m-0 mt-2 text-sm text-navy/70">{t("noTimesDay")}</p>
          ) : (
            groups.map((group) => (
              <div key={group.part} className="mt-2">
                <p className="m-0 mb-1 text-xs font-semibold uppercase tracking-wide text-navy/60">
                  {t(group.part)}
                </p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  {group.slots.map((slot) => {
                    const selected = slot.startAt === value;
                    return (
                      <button
                        key={slot.startAt}
                        type="button"
                        data-slot={slot.startAt}
                        aria-pressed={selected}
                        onClick={() => onChange(slot.startAt)}
                        className={[
                          "min-h-11 rounded-md border px-2 py-2 text-sm font-semibold",
                          FOCUS,
                          selected
                            ? "border-navy bg-navy text-white"
                            : "border-navy/20 bg-white text-navy hover:bg-navy/5",
                        ].join(" ")}
                      >
                        {formatSlotTime(slot.startAt, shown.timezone, locale)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
          <p className="m-0 mt-2 text-xs text-navy/60">
            {t("timezoneNote", {
              zone: timezoneLabel(shown.timezone, locale),
            })}
          </p>
        </section>
      ) : null}
    </div>
  );
}

/**
 * The last step: what is about to be booked, with one button to confirm and
 * one to go back and pick another date or time.
 */
export function SlotConfirmPanel({
  title,
  rows,
  confirmLabel,
  busy,
  busyLabel,
  disabled,
  hint,
  onConfirm,
  onChange,
}: {
  title: string;
  rows: [label: string, value: string | undefined][];
  confirmLabel: string;
  busy: boolean;
  busyLabel: string;
  disabled?: boolean;
  hint?: string;
  onConfirm: () => void;
  onChange: () => void;
}) {
  const t = useTranslations("app.schedule");
  const uid = useId();
  return (
    <section
      aria-labelledby={`${uid}-title`}
      className="rounded-md border border-navy/20 bg-navy/5 p-4"
      data-testid="confirm-panel"
    >
      <h3
        id={`${uid}-title`}
        className="m-0 text-base font-semibold text-navy"
      >
        {title}
      </h3>
      <dl className="m-0 mt-3 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[7rem_1fr]">
        {rows
          .filter(([, value]) => Boolean(value))
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-navy/60">{label}</dt>
              <dd className="m-0 break-words font-medium text-navy">
                {value}
              </dd>
            </div>
          ))}
      </dl>
      {hint ? <p className="m-0 mt-3 text-sm text-navy/70">{hint}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || disabled}
          onClick={onConfirm}
          className={`min-h-11 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
        >
          {busy ? busyLabel : confirmLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onChange}
          className={`min-h-11 rounded-md border border-navy/25 bg-white px-4 py-2 text-sm font-semibold text-navy disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
        >
          {t("changeTime")}
        </button>
      </div>
    </section>
  );
}
