"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type {
  DashboardAppointmentRow,
  DashboardCallRow,
  DashboardLeadRow,
} from "@/product/saas/dashboard-overview";
import { formatDuration, formatWhen } from "@/components/app/dashboard/format";

const PAGE_SIZE = 8;
const APPOINTMENT_STATUSES = ["hold", "pending", "confirmed", "completed", "canceled", "cancelled"] as const;

function appointmentStatusLabel(
  t: (key: string) => string,
  status: string,
) {
  return (APPOINTMENT_STATUSES as readonly string[]).includes(status)
    ? t(`appointmentStatus.${status}`)
    : status;
}

type CallFilter = "all" | "answered" | "missed" | "open" | "ai" | "transferred" | "followUp";
type SortDir = "asc" | "desc";

function pagesFor(length: number) {
  return Math.max(1, Math.ceil(length / PAGE_SIZE));
}

function Pager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations("app.home");
  return (
    <div className="flex items-center justify-between gap-3 border-t border-navy/10 px-4 py-3 text-sm">
      <p className="text-navy/70">{t("page", { page: page + 1, pages })}</p>
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-md border border-navy/15 px-2.5 py-1 font-semibold text-navy disabled:opacity-40"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
        >
          {t("prev")}
        </button>
        <button
          type="button"
          className="rounded-md border border-navy/15 px-2.5 py-1 font-semibold text-navy disabled:opacity-40"
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
        >
          {t("next")}
        </button>
      </div>
    </div>
  );
}

export function CallsTable({
  rows,
  filter,
  onFilter,
  onOpen,
}: {
  rows: DashboardCallRow[];
  filter: CallFilter;
  onFilter: (filter: CallFilter) => void;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("app.home");
  const locale = useLocale() === "fr" ? "fr" : "en";
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<"at" | "caller" | "classification">("at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const next = rows.filter((row) => {
      if (filter === "ai" && !row.aiHandled) return false;
      if (filter === "transferred" && !row.transferred) return false;
      if (filter === "followUp" && !row.followUp) return false;
      if (filter === "answered" || filter === "missed" || filter === "open") {
        if (row.classification !== filter) return false;
      }
      if (!needle) return true;
      return `${row.caller} ${row.phone} ${row.outcome ?? ""} ${row.summary ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
    next.sort((a, b) => {
      const left = sortKey === "at" ? a.at : sortKey === "caller" ? a.caller : a.classification;
      const right = sortKey === "at" ? b.at : sortKey === "caller" ? b.caller : b.classification;
      const cmp = String(left).localeCompare(String(right));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return next;
  }, [rows, filter, query, sortKey, sortDir]);

  const pageCount = pagesFor(filtered.length);
  const safePage = Math.min(page, pageCount - 1);
  const slice = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function sort(key: typeof sortKey) {
    setPage(0);
    if (sortKey === key) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "at" ? "desc" : "asc");
    }
  }

  const filters: CallFilter[] = ["all", "answered", "missed", "open", "ai", "transferred", "followUp"];

  return (
    <section id="calls" className="overflow-hidden rounded-xl border border-navy/10 bg-white shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-3 border-b border-navy/10 px-4 py-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-archivo)] text-base font-extrabold text-navy">
            {t("sectionCalls")}
          </h2>
          <p className="mt-1 text-sm text-navy/70">
            {t("showing", { count: filtered.length })}
          </p>
        </div>
        <Link href="/app/calls" className="text-sm font-semibold text-ember-text hover:underline">
          {t("viewAll")}
        </Link>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-navy/70">
          {t("search")}
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            className="rounded-md border border-navy/15 px-3 py-2 text-sm font-normal text-navy"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-navy/70">
          {t("status")}
          <select
            value={filter}
            onChange={(event) => {
              onFilter(event.target.value as CallFilter);
              setPage(0);
            }}
            className="rounded-md border border-navy/15 px-3 py-2 text-sm font-normal text-navy"
          >
            {filters.map((item) => (
              <option key={item} value={item}>
                {t(`filters.${item}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {slice.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-navy/70">{t("emptyTable")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-navy/70">
              <tr>
                <th className="px-4 py-2">
                  <button type="button" onClick={() => sort("at")}>{t("cols.when")}</button>
                </th>
                <th className="px-4 py-2">
                  <button type="button" onClick={() => sort("caller")}>{t("cols.who")}</button>
                </th>
                <th className="px-4 py-2">
                  <button type="button" onClick={() => sort("classification")}>{t("cols.status")}</button>
                </th>
                <th className="px-4 py-2">{t("cols.duration")}</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((row) => (
                <tr key={row.id} className="border-t border-navy/10">
                  <td className="px-4 py-3 whitespace-nowrap text-navy/70">{formatWhen(row.at, locale)}</td>
                  <td className="px-4 py-3">
                    <button type="button" className="font-semibold text-navy hover:underline" onClick={() => onOpen(row.id)}>
                      {row.caller}
                    </button>
                    <p className="text-xs text-navy/70">{row.phone}</p>
                  </td>
                  <td className="px-4 py-3 text-navy/80">
                    {row.outcome ? t(`outcomes.${row.outcome}`) : t(`classification.${row.classification}`)}
                  </td>
                  <td className="px-4 py-3 text-navy/70">{formatDuration(row.durationSeconds ?? null, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={safePage} pages={pageCount} onPage={setPage} />
    </section>
  );
}

export function LeadsTable({
  rows,
  status,
  onStatus,
}: {
  rows: DashboardLeadRow[];
  status: string;
  onStatus: (status: string) => void;
}) {
  const t = useTranslations("app.home");
  const crm = useTranslations("app.crm");
  const locale = useLocale() === "fr" ? "fr" : "en";
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<"at" | "name" | "status">("at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const statuses = ["all", ...new Set(rows.map((row) => row.status))];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const next = rows.filter((row) => {
      if (status !== "all" && row.status !== status) return false;
      if (!needle) return true;
      return `${row.name} ${row.phone ?? ""} ${row.service ?? ""} ${row.source}`.toLowerCase().includes(needle);
    });
    next.sort((a, b) => {
      const left = a[sortKey] ?? "";
      const right = b[sortKey] ?? "";
      const cmp = String(left).localeCompare(String(right));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return next;
  }, [rows, status, query, sortKey, sortDir]);

  const pageCount = pagesFor(filtered.length);
  const safePage = Math.min(page, pageCount - 1);
  const slice = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function sort(key: typeof sortKey) {
    setPage(0);
    if (sortKey === key) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "at" ? "desc" : "asc");
    }
  }

  return (
    <section id="leads" className="overflow-hidden rounded-xl border border-navy/10 bg-white shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-3 border-b border-navy/10 px-4 py-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-archivo)] text-base font-extrabold text-navy">
            {t("sectionLeads")}
          </h2>
          <p className="mt-1 text-sm text-navy/70">{t("showing", { count: filtered.length })}</p>
        </div>
        <Link href="/app/leads" className="text-sm font-semibold text-ember-text hover:underline">
          {t("viewAll")}
        </Link>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-navy/70">
          {t("search")}
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            className="rounded-md border border-navy/15 px-3 py-2 text-sm font-normal text-navy"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-navy/70">
          {t("status")}
          <select
            value={status}
            onChange={(event) => {
              onStatus(event.target.value);
              setPage(0);
            }}
            className="rounded-md border border-navy/15 px-3 py-2 text-sm font-normal text-navy"
          >
            {statuses.map((item) => (
              <option key={item} value={item}>
                {item === "all" ? t("filters.all") : crm(`statuses.${item}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {slice.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-navy/70">{t("emptyTable")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-navy/70">
              <tr>
                <th className="px-4 py-2">
                  <button type="button" onClick={() => sort("at")}>{t("cols.when")}</button>
                </th>
                <th className="px-4 py-2">
                  <button type="button" onClick={() => sort("name")}>{t("cols.who")}</button>
                </th>
                <th className="px-4 py-2">
                  <button type="button" onClick={() => sort("status")}>{t("cols.status")}</button>
                </th>
                <th className="px-4 py-2">{t("cols.service")}</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((row) => (
                <tr key={row.id} className="border-t border-navy/10">
                  <td className="px-4 py-3 whitespace-nowrap text-navy/70">{formatWhen(row.at, locale)}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={{ pathname: "/app/leads/[id]", params: { id: row.id } }}
                      className="font-semibold text-navy hover:underline"
                    >
                      {row.name}
                    </Link>
                    {row.phone ? <p className="text-xs text-navy/70">{row.phone}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-navy/80">{crm(`statuses.${row.status}`)}</td>
                  <td className="px-4 py-3 text-navy/70">
                    {row.service || "—"}
                    <span className="mt-0.5 block text-xs text-navy/70">{crm(`sources.${row.source}`)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={safePage} pages={pageCount} onPage={setPage} />
    </section>
  );
}

export function AppointmentsTable({
  rows,
  status,
  onStatus,
  onOpen,
}: {
  rows: DashboardAppointmentRow[];
  status: string;
  onStatus: (status: string) => void;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("app.home");
  const locale = useLocale() === "fr" ? "fr" : "en";
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<"startAt" | "customerName" | "status">("startAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const statuses = ["all", ...new Set(rows.map((row) => row.status))];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const next = rows.filter((row) => {
      if (status !== "all" && row.status !== status) return false;
      if (!needle) return true;
      return `${row.customerName ?? ""} ${row.serviceName} ${row.serviceAddress ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
    next.sort((a, b) => {
      const left = sortKey === "customerName" ? a.customerName ?? "" : a[sortKey];
      const right = sortKey === "customerName" ? b.customerName ?? "" : b[sortKey];
      const cmp = String(left).localeCompare(String(right));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return next;
  }, [rows, status, query, sortKey, sortDir]);

  const pageCount = pagesFor(filtered.length);
  const safePage = Math.min(page, pageCount - 1);
  const slice = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function sort(key: typeof sortKey) {
    setPage(0);
    if (sortKey === key) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <section id="appointments" className="overflow-hidden rounded-xl border border-navy/10 bg-white shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-3 border-b border-navy/10 px-4 py-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-archivo)] text-base font-extrabold text-navy">
            {t("sectionAppointments")}
          </h2>
          <p className="mt-1 text-sm text-navy/70">{t("showing", { count: filtered.length })}</p>
        </div>
        <Link href="/app/bookings" className="text-sm font-semibold text-ember-text hover:underline">
          {t("viewAll")}
        </Link>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-navy/70">
          {t("search")}
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            className="rounded-md border border-navy/15 px-3 py-2 text-sm font-normal text-navy"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-navy/70">
          {t("status")}
          <select
            value={status}
            onChange={(event) => {
              onStatus(event.target.value);
              setPage(0);
            }}
            className="rounded-md border border-navy/15 px-3 py-2 text-sm font-normal text-navy"
          >
            {statuses.map((item) => (
              <option key={item} value={item}>
                {item === "all" ? t("filters.all") : appointmentStatusLabel(t, item)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {slice.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-navy/70">{t("emptyTable")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-paper text-xs uppercase tracking-wide text-navy/70">
              <tr>
                <th className="px-4 py-2">
                  <button type="button" onClick={() => sort("startAt")}>{t("cols.start")}</button>
                </th>
                <th className="px-4 py-2">
                  <button type="button" onClick={() => sort("customerName")}>{t("cols.who")}</button>
                </th>
                <th className="px-4 py-2">{t("cols.service")}</th>
                <th className="px-4 py-2">
                  <button type="button" onClick={() => sort("status")}>{t("cols.status")}</button>
                </th>
              </tr>
            </thead>
            <tbody>
              {slice.map((row) => (
                <tr key={row.id} className="border-t border-navy/10">
                  <td className="px-4 py-3 whitespace-nowrap text-navy/70">{formatWhen(row.startAt, locale)}</td>
                  <td className="px-4 py-3">
                    <button type="button" className="font-semibold text-navy hover:underline" onClick={() => onOpen(row.id)}>
                      {row.customerName || row.serviceName}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-navy/80">{row.serviceName}</td>
                  <td className="px-4 py-3 text-navy/70">{appointmentStatusLabel(t, row.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={safePage} pages={pageCount} onPage={setPage} />
    </section>
  );
}

export type { CallFilter };
