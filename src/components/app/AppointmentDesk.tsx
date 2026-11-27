"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppointmentCalendar } from "./AppointmentCalendar";
import {
  rangeToInstants,
  visibleRange,
  weekStart,
  type CalendarView,
  type OpeningHours,
} from "./calendar-layout";
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
  timezoneLabel,
} from "./schedule-picker-utils";

import { useGuarded } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
import { BusyLabel } from "@/components/ui/Spinner";
import { LoadingRegion, Skeleton, SkeletonCalendar } from "@/components/ui/Skeleton";

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
  bookingSource?: string;
  calendarEventId?: string;
  cancelReason?: string;
  createdAt?: string;
};

type HistoryEvent = { kind: string; detail?: string; at: string };

/** Event kinds the engine records that have a plain-language label. */
const HISTORY_LABELS = {
  confirmed: "historyConfirmed",
  canceled: "historyCanceled",
  completed: "historyCompleted",
  rescheduled: "historyRescheduled",
  calendar_failed: "historyCalendarFailed",
  provider_canceled: "historyProviderCanceled",
} as const;

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

/** A phone-sized screen, followed as it changes (rotation, resizing). */
const SMALL_SCREEN = "(max-width: 639px)";
const watchSmallScreen = (notify: () => void) => {
  const query = window.matchMedia(SMALL_SCREEN);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const isSmallScreen = () => window.matchMedia(SMALL_SCREEN).matches;

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
  // Until a view is picked: the one-day view on a phone, the week on anything wider.
  const smallScreen = useSyncExternalStore(
    watchSmallScreen,
    isSmallScreen,
    () => false,
  );
  const [pickedView, setPickedView] = useState<CalendarView | null>(null);
  const view: CalendarView = pickedView ?? (smallScreen ? "day" : "week");
  // Any business-local day inside what is shown; null follows today.
  const [anchor, setAnchor] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  // The open appointment is looked up in `rows`, so it always shows the latest saved copy.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCanceled, setShowCanceled] = useState(false);
  const [hours, setHours] = useState<OpeningHours | undefined>(undefined);
  const [calendarMode, setCalendarMode] = useState("");
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [historyKey, setHistoryKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editTechnicianId, setEditTechnicianId] = useState("");
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
  // False until the appointment list has answered (or failed): the skeleton shows meanwhile.
  const [loaded, setLoaded] = useState(false);
  const inFlight = useRef(false);
  const attemptKey = useRef("");

  const load = useCallback(
    () =>
      // Never a cached copy: a calendar that is out of date is a wrong calendar.
      timedFetch(`/api/businesses/${organizationId}/appointments`, {
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Appointments unavailable");
          return {
            response,
            data: (await response.json()) as {
              appointments?: Appointment[];
              technicians?: Technician[];
              timezone?: string;
              hours?: OpeningHours;
              calendarMode?: string;
            },
          };
        })
        .then(({ data }) => {
          setRows(data.appointments ?? []);
          setTechnicians(data.technicians ?? []);
          // The business's own zone and hours come with the appointments, so
          // the very first paint is already in the right zone.
          setTimezone((current) => data.timezone || current);
          setHours(data.hours);
          setCalendarMode(data.calendarMode ?? "");
          setLoadError(false);
        })
        .catch(() => setLoadError(true))
        // Answered or not, the first load is over: the skeleton must never outlive it.
        .finally(() => setLoaded(true)),
    [organizationId, setTimezone],
  );

  function retryLoad() {
    setLoadError(false);
    setLoaded(false);
    void load();
  }

  /** What the server just saved goes on the calendar at once; the reload that follows only confirms it. */
  const upsert = useCallback((saved: Appointment | undefined) => {
    if (!saved?.id) return;
    setRows((current) =>
      current.some((row) => row.id === saved.id)
        ? current.map((row) => (row.id === saved.id ? saved : row))
        : [...current, saved],
    );
  }, []);

  const loadServices = useCallback(
    () =>
      timedFetch(`/api/businesses/${organizationId}/service-types`, {
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
  // Everything the view draws: a whole Sunday-to-Saturday week, or the whole
  // month grid including the neighbouring days it shows dimmed.
  const range = useMemo(() => visibleRange(view, first), [view, first]);
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
          ? shiftDayKey(weekStart(first), delta * 7)
          : `${shiftMonth(first.slice(0, 7), delta)}-01`,
    );
  }

  /** Switching view keeps you on today when today is on screen, and on your date otherwise. */
  function changeView(next: CalendarView) {
    if (anchor) {
      const keep = visibleRange(view, first);
      setAnchor(todayKey >= keep.from && todayKey <= keep.to ? null : anchor);
    }
    setPickedView(next);
  }

  /** A day was picked in the week or the month: look at that day on its own. */
  function showDay(day: string) {
    setAnchor(day === todayKey ? null : day);
    setPickedView("day");
  }

  const visible = useMemo(() => {
    const wanted = searchKey(query.trim());
    // A job is on screen when any of it falls inside the days shown, so one
    // that runs past midnight is never cut off at the edge.
    const span = rangeToInstants(range, zone);
    const from = Date.parse(span.from);
    const to = Date.parse(span.to);
    return rows.filter((row) => {
      // A canceled appointment frees its time: it is kept on record, but only
      // drawn when asked for.
      if (row.status === "canceled" && !showCanceled && status !== "canceled")
        return false;
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
      return Date.parse(row.endAt) > from && Date.parse(row.startAt) < to;
    });
  }, [rows, status, technicianId, query, range, zone, showCanceled]);

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

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
    // The calendar is re-read after the answer, but NOT while the button is
    // still locked: a slow reload must not keep "Saving…" on screen.
    let refreshAfter = false;
    try {
      const res = await timedFetch(
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
        appointment?: Appointment;
      };
      if (res.status >= 500 || data.code === "service_unavailable") {
        // Nothing was saved. The chosen time and its idempotency key stay, so
        // pressing confirm again is the same booking and still books once.
        setMessageError(true);
        setMessage(t("unavailable"));
      } else if (res.status === 409 || data.reason === "conflict") {
        setStartAt("");
        timeTaken();
      } else if (data.reason === "calendar_error" && data.appointment) {
        // The calendar would not confirm it, so it was kept as a request
        // rather than lost. Say exactly that, never "confirmed".
        upsert(data.appointment);
        setMessageError(true);
        setMessage(t("calendarRequestSaved"));
        setServiceId("");
        setStartAt("");
        setName("");
        setPhone("");
        setAddress("");
        setReloadKey((n) => n + 1);
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
        upsert(data.appointment);
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
      refreshAfter = true;
    } catch {
      // No answer (timeout, dropped connection): the booking may have been
      // saved. Say so instead of "failed", keep the chosen time and its
      // idempotency key (confirming again books it once), and re-read the
      // appointment list so the person can see which it was. The time picker
      // is deliberately NOT refreshed: if the booking did go through, its own
      // slot would read as "taken" and replace this message with a misleading one.
      setMessageError(true);
      setMessage(t("bookUnconfirmed"));
      refreshAfter = true;
    } finally {
      inFlight.current = false;
      setBusy(false);
      if (refreshAfter) void load();
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
    let refreshAfter = false;
    try {
      const url =
        path === "complete"
          ? `/api/businesses/${organizationId}/appointments/${selected.id}`
          : `/api/businesses/${organizationId}/appointments/${selected.id}/${path}`;
      const res = await timedFetch(url, {
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
        appointment?: Appointment;
      };
      if (
        path === "reschedule" &&
        (data.reason === "unavailable" || data.reason === "conflict")
      ) {
        setNewStart("");
        timeTaken();
      } else if (res.ok && data.ok) {
        // The saved appointment is on the calendar at once; the reload below only confirms it.
        upsert(data.appointment);
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
        // Moved to a day that is not on screen: follow it, so it never seems to vanish.
        if (path === "reschedule" && newStart) {
          const movedDay = dateKeyInZone(newStart, zone);
          if (movedDay < range.from || movedDay > range.to)
            setAnchor(
              view === "month" ? `${movedDay.slice(0, 7)}-01` : movedDay,
            );
        }
        // The appointment stays open, showing what it is now (a canceled one says so).
        setRescheduling(false);
        setNewStart("");
        setReason("");
        setHistoryKey((n) => n + 1);
        // Freed or newly taken times must show in the calendar straight away.
        setReloadKey((n) => n + 1);
      } else {
        setMessageError(true);
        setMessage(failureText(path, res.status, data));
      }
      refreshAfter = true;
    } catch {
      // No answer: the change may have been saved. Never "failed", never "saved".
      // Only the appointment list is re-read (see book()): refreshing the time
      // picker could report the change's own new time as taken.
      setMessageError(true);
      setMessage(t("changeUnconfirmed"));
      refreshAfter = true;
    } finally {
      inFlight.current = false;
      setBusy(false);
      if (refreshAfter) void load();
    }
  }

  /** What went wrong, in words the person can act on. Never a success message. */
  function failureText(
    path: Action | "edit",
    status: number,
    data: { reason?: string; code?: string },
  ): string {
    if (data.code === "already_completed") return t("alreadyCompleted");
    if (data.code === "technician_busy") return t("technicianBusy");
    if (data.code === "invalid_phone") return t("phoneInvalid");
    if (data.code === "not_started") return t("notStarted");
    if (path === "approve" && data.reason === "conflict")
      return t("approveConflict");
    if (path === "approve" && data.reason === "past") return t("approvePast");
    if (data.reason?.startsWith("calendar") || status === 502)
      return path === "approve" ? t("approveCalendar") : t("calendarError");
    if (status >= 500) return t("unavailable");
    return t("error");
  }

  const saveEdit = useGuarded(saveEditHandler);
  async function saveEditHandler() {
    if (!selected || inFlight.current || !editName.trim()) return;
    const typedPhone = editPhone.trim();
    if (typedPhone && !looksLikePhone(typedPhone)) {
      setMessageError(true);
      setMessage(t("phoneInvalid"));
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    setMessageError(false);
    let refreshAfter = false;
    try {
      const res = await timedFetch(
        `/api/businesses/${organizationId}/appointments/${selected.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName: editName.trim(),
            // An empty box removes the number.
            customerPhoneE164: typedPhone,
            serviceAddress: editAddress.trim(),
            technicianId:
              editTechnicianId && editTechnicianId !== selected.technicianId
                ? editTechnicianId
                : undefined,
          }),
        },
      );
      if (res.status === 429) {
        const wait = Math.max(1, Math.ceil(Number(res.headers.get("retry-after")) || 5));
        setMessageError(true);
        setMessage(tLimit("requestsLimited", { seconds: wait }));
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        code?: string;
        reason?: string;
        appointment?: Appointment;
      };
      if (res.ok && data.ok) {
        upsert(data.appointment);
        setEditing(false);
        setMessageError(false);
        setMessage(t("edited"));
        setHistoryKey((n) => n + 1);
      } else {
        setMessageError(true);
        setMessage(failureText("edit", res.status, data));
      }
      refreshAfter = true;
    } catch {
      setMessageError(true);
      setMessage(t("changeUnconfirmed"));
      refreshAfter = true;
    } finally {
      inFlight.current = false;
      setBusy(false);
      if (refreshAfter) void load();
    }
  }

  function openAppointment(row: Appointment | null) {
    setSelectedId(row?.id ?? null);
    setHistory([]);
    setEditing(false);
    setRescheduling(false);
    setNewStart("");
    setConfirmingCancel(false);
    setReason("");
  }

  function startEditing() {
    if (!selected) return;
    setEditName(selected.customerName ?? "");
    setEditPhone(selected.customerPhoneE164 ?? "");
    setEditAddress(selected.serviceAddress ?? "");
    setEditTechnicianId(selected.technicianId ?? "");
    setEditing(true);
  }

  // The appointment's own record: its history, and the freshest copy of it.
  useEffect(() => {
    if (!selectedId) return;
    let live = true;
    timedFetch(`/api/businesses/${organizationId}/appointments/${selectedId}`, {
      cache: "no-store",
    })
      .then(async (res) =>
        res.ok
          ? ((await res.json()) as {
              appointment?: Appointment;
              history?: HistoryEvent[];
            })
          : null,
      )
      .then((data) => {
        if (!live || !data) return;
        setHistory(data.history ?? []);
        upsert(data.appointment);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [organizationId, selectedId, historyKey, upsert]);

  // Opening an appointment brings its details into view and moves focus there.
  const detailsHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!selectedId) return;
    detailsHeading.current?.focus({ preventScroll: true });
    detailsHeading.current?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

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

  /** Whether the appointment is on the business's outside calendar, when it has one. */
  const syncLine =
    selected &&
    (selected.status === "confirmed" || selected.status === "completed") &&
    (calendarMode === "google" || calendarMode === "calcom")
      ? selected.calendarEventId
        ? t("syncedYes")
        : t("syncedNo")
      : null;

  const detailsPanel = selected ? (
    <section
      aria-labelledby="appointment-details-title"
      data-testid="appointment-details"
      className="rounded-xl border border-navy/10 bg-white p-5 shadow-[0_1px_2px_rgb(12_20_30/0.04)] sm:p-6 lg:sticky lg:top-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2
          id="appointment-details-title"
          ref={detailsHeading}
          tabIndex={-1}
          className="m-0 font-semibold text-navy outline-none"
        >
          {t("details")}
        </h2>
        <span
          data-testid="details-status"
          className="rounded-full bg-navy/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-navy"
        >
          {selected.simulated ? `${t("practice")} · ` : ""}
          {t(selected.status as "pending")}
        </span>
      </div>

      {editing ? (
        <div className="mt-3 flex flex-col gap-2">
          <label className="text-sm text-navy">
            {t("customer")}
            <input
              required
              value={editName}
              maxLength={160}
              onChange={(event) => setEditName(event.target.value)}
              className="mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm text-navy">
            {t("phone")}
            <input
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={40}
              value={editPhone}
              onChange={(event) => setEditPhone(event.target.value)}
              className="mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm text-navy">
            {t("address")}
            <input
              value={editAddress}
              maxLength={300}
              onChange={(event) => setEditAddress(event.target.value)}
              className="mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5 text-sm"
            />
          </label>
          {technicians.length > 1 && selected.status === "confirmed" ? (
            <label className="text-sm text-navy">
              {t("technician")}
              <select
                value={editTechnicianId}
                onChange={(event) => setEditTechnicianId(event.target.value)}
                className="mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5 text-sm"
              >
                {technicians.map((tech) => (
                  <option key={tech.id} value={tech.id}>
                    {tech.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button aria-busy={busy}
              type="button"
              disabled={busy || !editName.trim()}
              onClick={() => void saveEdit()}
              className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              <BusyLabel pending={busy} busyLabel={t("saving")}>{t("saveChanges")}</BusyLabel>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
              className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-semibold text-navy disabled:opacity-50"
            >
              {t("discard")}
            </button>
          </div>
        </div>
      ) : (
        <dl className="m-0 mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm text-navy">
          <dt className="text-navy/70">{t("customer")}</dt>
          <dd className="m-0 font-semibold">{selected.customerName || "—"}</dd>
          <dt className="text-navy/70">{t("date")}</dt>
          <dd className="m-0">
            {formatSlotDate(selected.startAt, zone, locale)}
          </dd>
          <dt className="text-navy/70">{t("time")}</dt>
          <dd className="m-0">
            {formatSlotTime(selected.startAt, zone, locale)} –{" "}
            {formatSlotTime(selected.endAt, zone, locale)}
          </dd>
          <dt className="text-navy/70">{t("service")}</dt>
          <dd className="m-0">
            {selected.serviceName} · {kindLabel(selected.appointmentKind)}
          </dd>
          {selected.technicianName ? (
            <>
              <dt className="text-navy/70">{t("technician")}</dt>
              <dd className="m-0">{selected.technicianName}</dd>
            </>
          ) : null}
          <dt className="text-navy/70">{t("phone")}</dt>
          <dd className="m-0">
            {selected.customerPhoneE164 ? (
              <a
                href={`tel:${selected.customerPhoneE164}`}
                className="font-semibold underline"
              >
                {selected.customerPhoneE164}
              </a>
            ) : (
              "—"
            )}
          </dd>
          <dt className="text-navy/70">{t("address")}</dt>
          <dd className="m-0">{selected.serviceAddress || "—"}</dd>
          {selected.status === "canceled" &&
          selected.cancelReason &&
          selected.cancelReason !== "canceled" ? (
            <>
              <dt className="text-navy/70">{t("cancelReasonLabel")}</dt>
              <dd className="m-0">{selected.cancelReason}</dd>
            </>
          ) : null}
          {syncLine ? (
            <>
              <dt className="text-navy/70">{t("calendarSync")}</dt>
              <dd className="m-0" data-testid="details-sync">
                {syncLine}
              </dd>
            </>
          ) : null}
        </dl>
      )}

      {selected.status === "pending" ? (
        <p className="mt-2 text-sm text-navy/70">{t("pendingHint")}</p>
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
        {selectedOpen && !editing ? (
          <button
            type="button"
            disabled={busy}
            onClick={startEditing}
            className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-semibold text-navy disabled:opacity-50"
          >
            {t("edit")}
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
          className="text-sm text-navy/70 disabled:opacity-50"
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

      {history.length > 0 ? (
        <div className="mt-4 border-t border-navy/10 pt-3">
          <h3 className="m-0 text-sm font-semibold text-navy">{t("history")}</h3>
          <ol className="m-0 mt-2 list-none space-y-1 p-0 text-sm text-navy">
            {history.map((event, index) => (
              <li key={`${event.at}-${index}`} className="flex flex-wrap gap-x-2">
                <span className="text-navy/70">{whenLabel(event.at)}</span>
                <span>
                  {event.kind in HISTORY_LABELS
                    ? t(
                        HISTORY_LABELS[
                          event.kind as keyof typeof HISTORY_LABELS
                        ],
                      )
                    : event.kind.replace(/_/g, " ")}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  ) : null;

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
            onClick={retryLoad}
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
            className="rounded-xl border border-navy/10 bg-white p-5 shadow-[0_1px_2px_rgb(12_20_30/0.04)] sm:p-6"
          >
            <p className="text-xs uppercase tracking-wide text-navy/50">
              {label}
            </p>
            {loaded ? (
              <p className="text-2xl font-extrabold text-navy">{value}</p>
            ) : (
              // A skeleton, not "0": zero would be a claim about a calendar not read yet.
              <div className="py-1">
                <Skeleton className="h-6 w-10" />
              </div>
            )}
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
            onClick={() => changeView(item)}
            className={`rounded-md border border-navy/15 px-3 py-1.5 text-sm font-semibold ${view === item ? "bg-navy text-white" : "bg-white text-navy"}`}
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
          aria-label={t("search")}
          className="rounded-md border border-navy/15 px-2 py-1.5 text-sm"
        />
        <label className="flex items-center gap-1.5 text-sm text-navy">
          <input
            type="checkbox"
            checked={showCanceled}
            onChange={(event) => setShowCanceled(event.target.checked)}
          />
          {t("showCanceled")}
        </label>
      </div>

      {/* Every time on the calendar is read in the business's own zone, so say which. */}
      <p className="m-0 text-xs text-navy/70" data-testid="schedule-zone">
        {t("timezoneNote", { zone: timezoneLabel(zone, locale) })}
      </p>

      {message ? (
        <p
          role={messageError ? "alert" : "status"}
          className="m-0 text-sm text-navy"
        >
          {message}
        </p>
      ) : null}

      <div
        className={
          selected
            ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start"
            : "grid gap-4"
        }
      >
        <div className="flex min-w-0 flex-col gap-2" aria-busy={!loaded}>
          {loaded ? (
            <>
              <AppointmentCalendar
                view={view}
                anchor={first}
                rows={visible}
                zone={zone}
                locale={locale}
                todayKey={todayKey}
                now={now}
                hours={hours}
                selectedId={selectedId}
                caption={rangeLabel}
                onSelect={openAppointment}
                onPickDay={showDay}
              />
              {visible.length === 0 ? (
                <p className="m-0 text-center text-sm text-navy/70">{t("empty")}</p>
              ) : null}
            </>
          ) : (
            <LoadingRegion label={t("loadingAppointments")}>
              <SkeletonCalendar />
            </LoadingRegion>
          )}
        </div>
        {selected ? detailsPanel : null}
      </div>

      <section
        className="grid gap-3 rounded-xl border border-navy/10 bg-white p-5 shadow-[0_1px_2px_rgb(12_20_30/0.04)] sm:p-6 sm:grid-cols-2"
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
    </div>
  );
}
