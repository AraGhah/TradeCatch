"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

type Appointment = {
  id: string;
  customerName?: string;
  customerPhoneE164?: string;
  serviceName: string;
  serviceAddress?: string;
  technicianId?: string;
  technicianName?: string;
  startAt: string;
  endAt: string;
  status: string;
  timezone: string;
  appointmentKind: string;
};

type Slot = { startAt: string; endAt: string; localLabel: string };
type Service = { id: string; name: string; bookingMode: string };
type Technician = { id: string; name: string };

export function AppointmentDesk({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = useTranslations("app.schedule");
  const [rows, setRows] = useState<Appointment[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [status, setStatus] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [slot, setSlot] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageError, setMessageError] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);

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

  useEffect(() => {
    void load();
    void fetch(`/api/businesses/${organizationId}/service-types`)
      .then((res) => res.json())
      .then((data) =>
        setServices((data as { services?: Service[] }).services ?? []),
      )
      .catch(() => setServices([]));
  }, [load, organizationId]);

  useEffect(() => {
    const params = new URLSearchParams({ slots: "1" });
    if (serviceId) params.set("serviceId", serviceId);
    void fetch(`/api/businesses/${organizationId}/availability?${params}`)
      .then((res) => res.json())
      .then((data) => setSlots((data as { slots?: Slot[] }).slots ?? []))
      .catch(() => setSlots([]));
  }, [organizationId, serviceId]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const visible = useMemo(() => {
    const horizon =
      view === "day"
        ? 86_400_000
        : view === "week"
          ? 7 * 86_400_000
          : 31 * 86_400_000;
    return rows.filter((row) => {
      if (status && row.status !== status) return false;
      if (technicianId && row.technicianId !== technicianId) return false;
      if (
        query &&
        !`${row.customerName ?? ""} ${row.serviceName}`
          .toLowerCase()
          .includes(query.toLowerCase())
      ) {
        return false;
      }
      const start = Date.parse(row.startAt);
      if (view === "month") {
        const current = new Date(now);
        const when = new Date(row.startAt);
        return (
          when.getMonth() === current.getMonth() &&
          when.getFullYear() === current.getFullYear()
        );
      }
      return start >= now - 86_400_000 && start <= now + horizon;
    });
  }, [rows, status, technicianId, query, view, now]);

  const counts = {
    today: rows.filter(
      (row) =>
        new Date(row.startAt).toDateString() === new Date(now).toDateString() &&
        row.status !== "canceled",
    ).length,
    upcoming: rows.filter(
      (row) =>
        Date.parse(row.startAt) > now &&
        row.status !== "canceled" &&
        row.status !== "completed",
    ).length,
    pending: rows.filter((row) => row.status === "pending").length,
  };

  async function book() {
    if (busy) return;
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
            startAt: slot,
            customerName: name,
            customerPhoneE164: phone || undefined,
            serviceAddress: address || undefined,
          }),
        },
      );
      const data = (await res.json()) as {
        confirmed?: boolean;
        error?: string;
      };
      setMessageError(!data.confirmed);
      setMessage(data.confirmed ? t("saved") : data.error || t("notConfirmed"));
      if (data.confirmed) {
        setServiceId("");
        setSlot("");
        setName("");
        setPhone("");
        setAddress("");
      }
      await load();
    } catch {
      setMessageError(true);
      setMessage(t("error"));
    } finally {
      setBusy(false);
    }
  }

  async function act(path: "reschedule" | "cancel" | "complete") {
    if (!selected || busy) return;
    setBusy(true);
    setMessage(null);
    setMessageError(false);
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
              : { startAt: slot },
        ),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      setMessageError(!data.ok);
      setMessage(data.ok ? t("saved") : data.error || t("error"));
      setSelected(null);
      await load();
    } catch {
      setMessageError(true);
      setMessage(t("error"));
    } finally {
      setBusy(false);
    }
  }

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

      <div className="flex flex-wrap gap-2">
        {(["day", "week", "month"] as const).map((item) => (
          <button
            key={item}
            type="button"
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
                onClick={() => setSelected(row)}
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
                    {new Date(row.startAt).toLocaleString()}
                  </span>
                </span>
                <span className="text-xs uppercase tracking-wide text-navy/50">
                  {t(row.status as "pending")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="grid gap-3 rounded-md border border-navy/10 bg-white p-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void book();
        }}
      >
        <h2 className="sm:col-span-2 font-semibold text-navy">{t("add")}</h2>
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
        <label className="text-sm text-navy">
          {t("slot")}
          <select
            required
            value={slot}
            onChange={(event) => setSlot(event.target.value)}
            className="mt-1 w-full rounded-md border border-navy/15 px-2 py-1.5"
          >
            <option value="">{t("slot")}</option>
            {slots.map((item) => (
              <option key={item.startAt} value={item.startAt}>
                {item.localLabel}
              </option>
            ))}
          </select>
        </label>
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("customer")}
          className="rounded-md border border-navy/15 px-2 py-1.5 text-sm"
        />
        <input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder={t("phone")}
          className="rounded-md border border-navy/15 px-2 py-1.5 text-sm"
        />
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder={t("address")}
          className="rounded-md border border-navy/15 px-2 py-1.5 text-sm sm:col-span-2"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white sm:col-span-2 disabled:opacity-50"
        >
          {t("book")}
        </button>
      </form>

      {selected ? (
        <section className="rounded-md border border-navy/10 bg-white p-4">
          <h2 className="font-semibold text-navy">{t("details")}</h2>
          <p className="mt-2 text-sm text-navy/80">
            {selected.customerName} · {selected.serviceName} ·{" "}
            {selected.serviceAddress || "—"} · {selected.appointmentKind}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("reschedule")}
              className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              {t("reschedule")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("complete")}
              className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              {t("complete")}
            </button>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("reason")}
              className="rounded-md border border-navy/15 px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("cancel")}
              className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setSelected(null)}
              className="text-sm text-navy/60 disabled:opacity-50"
            >
              {t("close")}
            </button>
          </div>
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
