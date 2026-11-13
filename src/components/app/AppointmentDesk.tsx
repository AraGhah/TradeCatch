"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { SchedulePicker, SlotConfirmPanel } from "./SchedulePicker";
import {
  dateKeyInZone,
  formatDayKey,
  formatMonth,
  formatShortDayKey,
  formatSlotDate,
  formatSlotTime,
  pickerLocale,
  searchKey,
  shiftDayKey,
  shiftMonth,
  tidySentence,
} from "./schedule-picker-utils";

type Appointment = {
  id: string;
  customerName?: string;
  customerPhoneE164?: string;
  serviceId?: string;
  serviceName: string;
  serviceAddress?: string;
  technicianId?: string;
  technicianName?: string;
  startAt: string;
  endAt: string;
  status: string;
  timezone: string;
  appointmentKind: string;
  simulated?: boolean;
};

type Service = {
  id: string;
  name: string;
  bookingMode: string;
  active?: boolean;
};
type Action = "reschedule" | "cancel" | "complete" | "approve";

const PHONE_INPUT = /^\+?[\d\s().-]+$/;
/** What a person may type for a phone: ten digits or more, only digits and separators. */
function looksLikePhone(value: string): boolean {
  return PHONE_INPUT.test(value) && value.replace(/\D/g, "").length >= 10;
}
type Technician = { id: string; name: string };

export function AppointmentDesk({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = useTranslations("app.schedule");
  // The shared "too many requests" wording (same strings as the account buttons).
  const tLimit = useTranslations("app.account");
  const locale = pickerLocale(useLocale());
  const [rows, setRows] = useState<Appointment[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [status, setStatus] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"day" | "week" | "month">("week");
  // First day shown, as a business-local day key; null follows today.
  const [anchor, setAnchor] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [serviceId, setServiceId] = useState("");
  // The time chosen in the calendar: for a NEW appointment, and for a reschedule.
  const [startAt, setStartAt] = useState("");
  const [newStart, setNewStart] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const [timezone, setTimezone] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageError, setMessageError] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const inFlight = useRef(false);
  const attemptKey = useRef("");

  const load = useCallback(
    () =>
      fetch(`/api/businesses/${organizationId}/appointments`)
        .then(async (response) => {
          if (!response.ok) throw new Error("Appointments unavailable");
          return {
            response,
            data: (await response.json()) as {
              appointments?: Appointment[];
              technicians?: Technician[];
            },
          };
        })
        .then(({ data }) => {
          setRows(data.appointments ?? []);
          setTechnicians(data.technicians ?? []);
          setLoadError(false);
        })
        .catch(() => setLoadError(true)),
    [organizationId],
  );

  const loadServices = useCallback(
    () =>
      fetch(`/api/businesses/${organizationId}/service-types`, {
        cache: "no-store",
      })
        .then((res) => res.json())
        .then((data) =>
          setServices(
            // Only services that can still be booked are offered.
            ((data as { services?: Service[] }).services ?? []).filter(
              (service) => service.active !== false,
            ),
          ),
        )
        .catch(() => setServices([])),
    [organizationId],
  );

  useEffect(() => {
    void load();
    void loadServices();
  }, [load, loadServices]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Until the first availability arrives the browser's zone is only a label fallback.
  const zone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const whenLabel = (iso: string) =>
    `${formatSlotDate(iso, zone, locale)}, ${formatSlotTime(iso, zone, locale)}`;

  // Days are the business's own calendar days, never a rolling 24 hours.
  const todayKey = dateKeyInZone(new Date(now).toISOString(), zone);
  const first = anchor ?? todayKey;
  const range = useMemo(() => {
    if (view === "day") return { from: first, to: first };
    if (view === "week") return { from: first, to: shiftDayKey(first, 6) };
    const month = first.slice(0, 7);
    return { from: `${month}-01`, to: `${month}-31` };
  }, [view, first]);
  const rangeLabel =
    view === "day"
      ? formatDayKey(first, locale)
      : view === "week"
        ? `${formatShortDayKey(range.from, locale)} – ${formatShortDayKey(range.to, locale)}`
        : formatMonth(first.slice(0, 7), locale);

  function move(delta: -1 | 1) {
    setAnchor(
      view === "day"
        ? shiftDayKey(first, delta)
        : view === "week"
          ? shiftDayKey(first, delta * 7)
          : `${shiftMonth(first.slice(0, 7), delta)}-01`,
    );
  }

  const visible = useMemo(() => {
    const wanted = searchKey(query.trim());
    return rows.filter((row) => {
      if (status && row.status !== status) return false;
      if (technicianId && row.technicianId !== technicianId) return false;
      if (
        wanted &&
        !searchKey(
          `${row.customerName ?? ""} ${row.customerPhoneE164 ?? ""} ${row.serviceName}`,
        ).includes(wanted)
      ) {
        return false;
      }
      const day = dateKeyInZone(row.startAt, zone);
      return day >= range.from && day <= range.to;
    });
  }, [rows, status, technicianId, query, range, zone]);

  // Practice appointments from the test tools are listed, never counted.
  const real = rows.filter((row) => !row.simulated);
  const counts = {
    today: real.filter(
      (row) =>
        dateKeyInZone(row.startAt, zone) === todayKey &&
        row.status !== "canceled",
    ).length,
    upcoming: real.filter(
      (row) =>
        Date.parse(row.startAt) > now &&
        row.status !== "canceled" &&
        row.status !== "completed",
    ).length,
    pending: real.filter((row) => row.status === "pending").length,
  };

  /** A new time was picked: each attempt has its own key, so a double click or a retry books once. */
  function pickNewTime(iso: string) {
    attemptKey.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setStartAt(iso);
    setMessage(null);
  }

  /** The time was taken (or stopped being free): say so and show fresh availability. */
  function timeTaken() {
    setMessageError(true);
    setMessage(t("slotTaken"));
    setReloadKey((n) => n + 1);
  }

  async function book() {
    if (inFlight.current || !startAt || !name.trim()) return;
    if (phone.trim() && !looksLikePhone(phone.trim())) {
      setMessageError(true);
      setMessage(t("phoneInvalid"));
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    setMessageError(false);
    try {
      const res = await fetch(
        `/api/businesses/${organizationId}/appointments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serviceId: serviceId || undefined,
            startAt,
            customerName: name.trim(),
            customerPhoneE164: phone.trim() || undefined,
            serviceAddress: address.trim() || undefined,
            idempotencyKey: attemptKey.current || undefined,
          }),
        },
      );
      if (res.status === 429) {
        // Refused before anything ran (rate limit, or Cloudflare's own). Keep
        // the chosen time and its idempotency key: trying again after the wait
        // is the same booking, and still books once.
        const wait = Math.max(1, Math.ceil(Number(res.headers.get("retry-after")) || 5));
        setMessageError(true);
        setMessage(tLimit("requestsLimited", { seconds: wait }));
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        confirmed?: boolean;
        reason?: string;
        error?: string;
        code?: string;
      };
      if (res.status === 409 || data.reason === "conflict") {
        setStartAt("");
        timeTaken();
      } else if (data.code === "invalid_phone") {
        setMessageError(true);
        setMessage(t("phoneInvalid"));
      } else if (data.code === "service_inactive") {
        // Switched off since this page loaded: offer the current list again.
        setMessageError(true);
        setMessage(t("serviceInactive"));
        setServiceId("");
        setStartAt("");
        void loadServices();
      } else if (data.confirmed || data.ok) {
        setMessageError(false);
        setMessage(
          data.confirmed
            ? tidySentence(t("confirmedFor", { when: whenLabel(startAt) }))
            : t("requestSaved"),
        );
        // Show the new appointment even when it is outside the dates on screen.
        const bookedDay = dateKeyInZone(startAt, zone);
        if (bookedDay < range.from || bookedDay > range.to)
          setAnchor(
            view === "month" ? `${bookedDay.slice(0, 7)}-01` : bookedDay,
          );
        setServiceId("");
        setStartAt("");
        setName("");
        setPhone("");
        setAddress("");
        setReloadKey((n) => n + 1);
      } else {
        setMessageError(true);
        setMessage(t("notConfirmed"));
        setStartAt("");
        setReloadKey((n) => n + 1);
      }
      await load();
    } catch {
      setMessageError(true);
      setMessage(t("error"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function act(path: Action) {
    if (!selected || inFlight.current) return;
    if (path === "reschedule" && !newStart) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    setMessageError(false);
    setConfirmingCancel(false);
    try {
      const url =
        path === "complete"
          ? `/api/businesses/${organizationId}/appointments/${selected.id}`
          : `/api/businesses/${organizationId}/appointments/${selected.id}/${path}`;
      const res = await fetch(url, {
        method: path === "complete" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          path === "complete"
            ? { status: "completed" }
            : path === "cancel"
              ? { reason }
              : path === "approve"
                ? {}
                : { startAt: newStart },
        ),
      });
      if (res.status === 429) {
        const wait = Math.max(1, Math.ceil(Number(res.headers.get("retry-after")) || 5));
        setMessageError(true);
        setMessage(tLimit("requestsLimited", { seconds: wait }));
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        error?: string;
        code?: string;
      };
      if (
        path === "reschedule" &&
        (data.reason === "unavailable" || data.reason === "conflict")
      ) {
        setNewStart("");
        timeTaken();
      } else if (data.ok) {
        setMessageError(false);
        setMessage(
          path === "reschedule"
            ? tidySentence(t("rescheduledTo", { when: whenLabel(newStart) }))
            : path === "approve"
              ? tidySentence(
                  t("approved", { when: whenLabel(selected.startAt) }),
                )
              : t("saved"),
        );
        setSelected(null);
        setRescheduling(false);
        setNewStart("");
        setReason("");
        // Freed or newly taken times must show in the calendar straight away.
        setReloadKey((n) => n + 1);
      } else {
        setMessageError(true);
        setMessage(
          path === "approve" && data.reason === "conflict"
            ? t("approveConflict")
            : path === "approve" && data.reason === "past"
              ? t("approvePast")
              : path === "approve" && data.reason?.startsWith("calendar")
                ? t("approveCalendar")
                : data.code === "not_started"
                  ? t("notStarted")
                  : t("error"),
        );
      }
      await load();
    } catch {
      setMessageError(true);
      setMessage(t("error"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function openAppointment(row: Appointment | null) {
    setSelected(row);
    setRescheduling(false);
    setNewStart("");
    setConfirmingCancel(false);
    setReason("");
  }

  const kindLabel = (kind: string) =>
    kind === "consultation"
      ? t("consultation")
      : kind === "request"
        ? t("kindRequest")
        : t("kindJob");
  // What may still be done with the open appointment.
  const selectedOpen =
    selected?.status === "pending" || selected?.status === "confirmed";
  const selectedCanComplete =
    selected?.status === "confirmed" &&
    dateKeyInZone(selected.startAt, zone) <= todayKey;

  const chosenService = services.find((item) => item.id === serviceId);

  return (
    <div className="flex flex-col gap-6">
      {loadError ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <p>{t("connectionError")}</p>
          <button
            type="button"
            className="mt-1 font-semibold underline"
            onClick={() => void load()}
          >
            {t("retry")}
          </button>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [t("today"), counts.today],
          [t("upcoming"), counts.upcoming],
          [t("pending"), counts.pending],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-md border border-navy/10 bg-white px-4 py-3"
          >
            <p className="text-xs uppercase tracking-wide text-navy/50">
              {label}
            </p>
            <p className="text-2xl font-extrabold text-navy">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => move(-1)}
          aria-label={t("previous")}
          className="min-h-9 rounded-md border border-navy/15 bg-white px-3 py-1.5 text-sm font-semibold text-navy"
        >
          <span aria-hidden="true">‹</span>
        </button>
        <p
          aria-live="polite"
          data-testid="schedule-range"
          className="m-0 min-w-40 text-center text-sm font-semibold text-navy"
        >
          {rangeLabel}
        </p>
        <button
          type="button"
          onClick={() => move(1)}
          aria-label={t("next")}
          className="min-h-9 rounded-md border border-navy/15 bg-white px-3 py-1.5 text-sm font-semibold text-navy"
        >
          <span aria-hidden="true">›</span>
        </button>
        {anchor && anchor !== todayKey ? (
          <button
            type="button"
            onClick={() => setAnchor(null)}
            className="min-h-9 rounded-md border border-navy/15 bg-white px-3 py-1.5 text-sm font-semibold text-navy"
          >
            {t("today")}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {(["day", "week", "month"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={view === item}
            onClick={() => setView(item)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${view === item ? "bg-navy text-white" : "bg-white text-navy"}`}
          >
            {t(item)}
          </button>
        ))}
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-md border border-navy/15 px-2 py-1.5 text-sm"
        >
          <option value="">{t("all")}</option>
          {["pending", "confirmed", "completed", "canceled"].map((item) => (
            <option key={item} value={item}>
              {t(item as "pending")}
            </option>
          ))}
        </select>
        <select
          value={technicianId}
          onChange={(event) => setTechnicianId(event.target.value)}
          className="rounded-md border border-navy/15 px-2 py-1.5 text-sm"
        >
          <option value="">{t("technician")}</option>
          {technicians.map((tech) => (
            <option key={tech.id} value={tech.id}>
              {tech.name}
            </option>
          ))}
        </select>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("search")}
          className="rounded-md border border-navy/15 px-2 py-1.5 text-sm"
        />
      </div>

      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-navy/20 bg-white px-4 py-8 text-center text-navy/60">
          {t("empty")}
        </p>
      ) : (
        <ul className="divide-y divide-navy/10 overflow-hidden rounded-md border border-navy/10 bg-white">
          {visible.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => openAppointment(row)}
                className="flex w-full flex-wrap items-baseline justify-between gap-2 px-4 py-4 text-left hover:bg-navy/5"
              >
                <span>
                  <span className="block font-semibold text-navy">
                    {row.customerName || row.serviceName}
                  </span>
                  <span className="text-sm text-navy/70">
                    {row.serviceName}
                    {row.technicianName ? ` · ${row.technicianName}` : ""}
                    {" · "}
                    {whenLabel(row.startAt)}
                  </span>
                </span>
                <span className="text-xs uppercase tracking-wide text-navy/50">
                  {row.simulated ? `${t("practice")} · ` : ""}
                  {t(row.status as "pending")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <section
        className="grid gap-3 rounded-md border border-navy/10 bg-white p-4 sm:grid-cols-2"
        aria-labelledby="add-appointment-title"
      >
        <h2
          id="add-appointment-title"
          className="sm:col-span-2 font-semibold text-navy"
        >
          {t("add")}
        </h2>
        <label className="text-sm text-navy">
          {t("service")}
          <select
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
            className="mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5"
          >
            <option value="">{t("service")}</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
        <input
          required
          aria-label={t("customer")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("customer")}
          className="rounded-md border border-navy/15 px-2 py-1.5 text-sm"
        />
        <input
          type="tel"
          inputMode="tel"
          autoComplete="off"
          maxLength={40}
          aria-label={t("phone")}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder={t("phone")}
          className="rounded-md border border-navy/15 px-2 py-1.5 text-sm"
        />
        <input
          aria-label={t("address")}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder={t("address")}
          className="rounded-md border border-navy/15 px-2 py-1.5 text-sm"
        />

        <div className="flex flex-col gap-3 sm:col-span-2">
          {/* Stays mounted while the confirm panel shows, so "Change Date or Time" returns to the same month and day. */}
          <div hidden={Boolean(startAt)}>
            <SchedulePicker
              organizationId={organizationId}
              serviceId={serviceId || undefined}
              serviceAddress={address}
              value={startAt}
              onChange={pickNewTime}
              onLost={() => {
                setStartAt("");
                timeTaken();
              }}
              onTimezone={setTimezone}
              reloadKey={reloadKey}
            />
          </div>
          {startAt ? (
            <SlotConfirmPanel
              title={t("confirmTitle")}
              rows={[
                [t("customer"), name.trim() || undefined],
                [t("phone"), phone.trim() || undefined],
                [t("service"), chosenService?.name],
                [t("date"), formatSlotDate(startAt, zone, locale)],
                [t("time"), formatSlotTime(startAt, zone, locale)],
                [t("address"), address.trim() || undefined],
              ]}
              confirmLabel={t("confirmAppointment")}
              busy={busy}
              busyLabel={t("saving")}
              disabled={!name.trim()}
              hint={name.trim() ? undefined : t("customerRequired")}
              onConfirm={() => void book()}
              onChange={() => setStartAt("")}
            />
          ) : (
            <p className="m-0 text-sm text-navy/60">{t("noTimeSelected")}</p>
          )}
        </div>
      </section>

      {selected ? (
        <section className="rounded-md border border-navy/10 bg-white p-4">
          <h2 className="font-semibold text-navy">{t("details")}</h2>
          <p className="mt-2 text-sm text-navy/80">
            {selected.customerName || "—"} · {selected.serviceName} ·{" "}
            {selected.serviceAddress || "—"} ·{" "}
            {kindLabel(selected.appointmentKind)}
          </p>
          <p className="mt-1 text-sm text-navy/80">
            {whenLabel(selected.startAt)} ·{" "}
            <span className="font-semibold">
              {t(selected.status as "pending")}
            </span>
          </p>
          {selected.status === "pending" ? (
            <p className="mt-1 text-sm text-navy/70">{t("pendingHint")}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {selected.status === "pending" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act("approve")}
                className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {t("approve")}
              </button>
            ) : null}
            {selectedOpen ? (
              <button
                type="button"
                disabled={busy}
                aria-expanded={rescheduling}
                onClick={() => {
                  setRescheduling((open) => !open);
                  setNewStart("");
                }}
                className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
              >
                {t("reschedule")}
              </button>
            ) : null}
            {selectedCanComplete ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act("complete")}
                className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
              >
                {t("complete")}
              </button>
            ) : null}
            {selectedOpen && !confirmingCancel ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingCancel(true)}
                className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {t("cancel")}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => openAppointment(null)}
              className="text-sm text-navy/60 disabled:opacity-50"
            >
              {t("close")}
            </button>
          </div>
          {selectedOpen && confirmingCancel ? (
            <div
              role="group"
              aria-label={t("cancelConfirm")}
              className="mt-3 flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3"
            >
              <p className="m-0 text-sm text-red-900">{t("cancelConfirm")}</p>
              <input
                value={reason}
                maxLength={300}
                aria-label={t("reason")}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t("reason")}
                className="rounded-md border border-navy/15 bg-white px-2 py-1.5 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act("cancel")}
                  className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {t("cancelYes")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmingCancel(false)}
                  className="rounded-md border border-navy/20 bg-white px-3 py-1.5 text-sm font-semibold text-navy disabled:opacity-50"
                >
                  {t("cancelKeep")}
                </button>
              </div>
            </div>
          ) : null}
          {rescheduling && selectedOpen ? (
            <div className="mt-4 flex flex-col gap-3">
              <h3 className="m-0 text-sm font-semibold text-navy">
                {t("rescheduleTitle")}
              </h3>
              <div hidden={Boolean(newStart)}>
                <SchedulePicker
                  key={selected.id}
                  organizationId={organizationId}
                  serviceId={selected.serviceId}
                  serviceAddress={selected.serviceAddress}
                  excludeAppointmentId={selected.id}
                  value={newStart}
                  onChange={setNewStart}
                  onLost={() => {
                    setNewStart("");
                    timeTaken();
                  }}
                  onTimezone={setTimezone}
                  reloadKey={reloadKey}
                />
              </div>
              {newStart ? (
                <SlotConfirmPanel
                  title={t("confirmTitle")}
                  rows={[
                    [t("customer"), selected.customerName],
                    [t("service"), selected.serviceName],
                    [t("date"), formatSlotDate(newStart, zone, locale)],
                    [t("time"), formatSlotTime(newStart, zone, locale)],
                    [t("address"), selected.serviceAddress],
                  ]}
                  confirmLabel={t("confirmReschedule")}
                  busy={busy}
                  busyLabel={t("saving")}
                  onConfirm={() => void act("reschedule")}
                  onChange={() => setNewStart("")}
                />
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      {message ? (
        <p
          role={messageError ? "alert" : "status"}
          className="text-sm text-navy"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
