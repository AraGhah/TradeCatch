"use client";

import { useState } from "react";
import { BillingPortalButton } from "./BillingPortalButton";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { z } from "zod";
import type { AccountRequest } from "@/product/support/types";

import { useGuarded } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
import { BusyLabel } from "@/components/ui/Spinner";
import { APP_CARD } from "@/components/app/card-classes";
const requestSchema = z.object({
  id: z.string(),
  kind: z.enum(["suspension", "reactivation", "deletion"]),
  status: z.enum(["requested", "in_review", "completed", "withdrawn"]),
  createdAt: z.string(),
});
type RequestSummary = Pick<
  AccountRequest,
  "id" | "kind" | "status" | "createdAt"
>;

type MemberRole = "owner" | "admin" | "member" | "viewer";

const SETUP = [
  { href: "/app/settings/account", key: "setupProfile" },
  { href: "/app/bookings/availability", key: "setupHours" },
  { href: "/app/receptionist", key: "setupReceptionist" },
  { href: "/app/calls/settings", key: "setupPhone" },
  { href: "/app/settings/calendar", key: "setupCalendar" },
  { href: "/app/test-center", key: "setupTest" },
  { href: "/app/automations", key: "setupAutomations" },
] as const;

export function AccountManagement({
  organizationId,
  initialName,
  initialPhone,
  initialCity,
  initialServiceArea,
  initialIndustry,
  members,
  canManageBilling,
  canRequestAccountChange,
  initialRequests,
  requestHistoryError,
  locale = "en",
}: {
  organizationId: string;
  initialName: string;
  initialPhone: string;
  initialCity: string;
  initialServiceArea: string;
  initialIndustry: string;
  members: { name: string; email: string; role: MemberRole }[];
  canManageBilling: boolean;
  canRequestAccountChange: boolean;
  initialRequests: RequestSummary[];
  requestHistoryError: boolean;
  locale?: "en" | "fr";
}) {
  const t = useTranslations("app.account");
  const dateLocale = locale === "fr" ? "fr-CA" : "en-CA";
  function submittedAt(iso: string) {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return iso;
    return new Intl.DateTimeFormat(dateLocale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(at);
  }
  const [name, setName] = useState(initialName);
  // The name as stored: a deletion request is confirmed by typing it.
  const [savedName, setSavedName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [city, setCity] = useState(initialCity);
  const [serviceArea, setServiceArea] = useState(initialServiceArea);
  const [industry, setIndustry] = useState(initialIndustry);
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [requests, setRequests] = useState(initialRequests);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const roleLabel: Record<MemberRole, string> = {
    owner: t("roleOwner"),
    admin: t("roleAdmin"),
    member: t("roleMember"),
    viewer: t("roleViewer"),
  };

  const save = useGuarded(saveHandler);
  async function saveHandler(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaveError(false);
    setMessage("");
    try {
      const response = await timedFetch(
        `/api/businesses/${organizationId}/account/profile`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name,
            phoneE164: phone.trim(),
            city,
            serviceArea,
            industry,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        code?: string;
        organization?: { phoneE164?: string };
      };
      setSaveError(!response.ok);
      if (response.ok) {
        // Show the number the way it was saved.
        if (typeof payload.organization?.phoneE164 === "string")
          setPhone(payload.organization.phoneE164);
        setSavedName(name.trim());
        setMessage(t("saved"));
      } else {
        setMessage(
          payload.code === "invalid_phone"
            ? t("errorPhone")
            : payload.code === "invalid_name"
              ? t("errorName")
              : payload.code === "invalid_values"
                ? t("errorValues")
                : t("error"),
        );
      }
    } catch {
      setSaveError(true);
      setMessage(t("error"));
    } finally {
      setSaving(false);
    }
  }

  const request = useGuarded(requestHandler);
  async function requestHandler(kind: AccountRequest["kind"]) {
    if (requesting || !canRequestAccountChange) return;
    let confirm: string | undefined;
    if (kind === "deletion") {
      // Deletion is confirmed by typing the business name; the server checks it too.
      const typed = window.prompt(t("deletionConfirm", { name: savedName }));
      if (typed === null) return;
      if (typed.trim().toLowerCase() !== savedName.trim().toLowerCase()) {
        setRequestError(true);
        setMessage(t("deletionMismatch"));
        return;
      }
      confirm = typed;
    } else if (
      !window.confirm(t("requestConfirm", { kind: t(`requestKinds.${kind}`) }))
    )
      return;
    setRequesting(true);
    setRequestError(false);
    setExportError(false);
    setMessage("");
    try {
      const response = await timedFetch(
        `/api/businesses/${organizationId}/account/${kind === "deletion" ? "deletion-request" : "lifecycle"}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            confirm === undefined ? { kind } : { kind, confirm },
          ),
        },
      );
      if (!response.ok) throw new Error("Account request failed");
      const payload = z
        .object({ request: requestSchema })
        .parse(await response.json());
      if (payload.request.kind !== kind)
        throw new Error("Unexpected request kind");
      setRequests((previous) => [
        payload.request,
        ...previous.filter((row) => row.id !== payload.request.id),
      ]);
      setMessage(t("requestReceived"));
    } catch {
      setRequestError(true);
      setMessage(t("requestError"));
    } finally {
      setRequesting(false);
    }
  }

  const withdraw = useGuarded(withdrawHandler);
  async function withdrawHandler(requestId: string) {
    if (withdrawingId || requesting || !canRequestAccountChange) return;
    if (!window.confirm(t("requestWithdrawConfirm"))) return;
    setWithdrawingId(requestId);
    setRequestError(false);
    setMessage("");
    try {
      const response = await timedFetch(
        `/api/businesses/${organizationId}/account/requests/${requestId}/withdraw`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error("Withdraw failed");
      const payload = z
        .object({ request: requestSchema })
        .parse(await response.json());
      setRequests((previous) =>
        previous.map((row) =>
          row.id === payload.request.id ? payload.request : row,
        ),
      );
      setMessage(t("requestWithdrawn"));
    } catch {
      setRequestError(true);
      setMessage(t("requestWithdrawError"));
    } finally {
      setWithdrawingId(null);
    }
  }

  async function downloadExport() {
    if (exporting) return;
    setExporting(true);
    setExportError(false);
    setMessage("");
    try {
      const response = await timedFetch(
        `/api/businesses/${organizationId}/account/export`,
        { cache: "no-store" },
      );
      if (
        !response.ok ||
        !response.headers
          .get("content-type")
          ?.toLowerCase()
          .startsWith("application/zip")
      )
        throw new Error("Export unavailable");
      const blob = await response.blob();
      if (!blob.size) throw new Error("Empty archive");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        response.headers
          .get("content-disposition")
          ?.match(/filename="([a-zA-Z0-9_.-]+)"/)?.[1] ??
        "tradecatch-account-export.zip";
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      setMessage(
        response.headers.get("x-export-status") === "partial"
          ? t("exportPartial")
          : t("exportDownloaded"),
      );
    } catch {
      setExportError(true);
      setMessage(t("exportError"));
    } finally {
      setExporting(false);
    }
  }

  const field =
    "mt-1.5 w-full rounded-lg border border-navy/15 bg-white px-3 py-2.5 text-sm font-normal text-navy shadow-[inset_0_1px_1px_rgb(12_20_30/0.03)] focus:border-navy/40 focus:outline-none focus:ring-2 focus:ring-navy/15";
  const label = "block text-sm font-medium text-navy";
  const secondaryButton =
    "inline-flex min-h-10 items-center justify-center rounded-lg border border-navy/15 bg-white px-3.5 py-2 text-sm font-medium text-navy hover:bg-navy/[0.03] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/40";
  const cardTitle = "text-base font-semibold text-navy";
  const cardIntro = "mt-1 text-sm leading-relaxed text-navy/70";
  const failed = exportError || requestError || saveError;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start xl:gap-6">
      <div className="flex min-w-0 flex-col gap-5 xl:gap-6">
        <section className={APP_CARD} aria-labelledby="account-business">
          <h2 id="account-business" className={cardTitle}>
            {t("businessTitle")}
          </h2>
          <p className={cardIntro}>{t("password")}</p>
          <form
            className="mt-5 grid gap-x-5 gap-y-4 sm:grid-cols-2"
            onSubmit={(event) => void save(event)}
          >
            <label className={`${label} sm:col-span-2`}>
              {t("name")}
              <input
                className={field}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                minLength={2}
                maxLength={120}
              />
            </label>
            <label className={label}>
              {t("phone")}
              <input
                className={field}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={40}
                placeholder="514-555-0123"
              />
              <span className="mt-1.5 block text-xs font-normal text-navy/60">
                {t("phoneHint")}
              </span>
            </label>
            <label className={label}>
              {t("industry")}
              <input
                className={field}
                value={industry}
                maxLength={80}
                onChange={(event) => setIndustry(event.target.value)}
              />
            </label>
            <label className={label}>
              {t("city")}
              <input
                className={field}
                value={city}
                maxLength={80}
                onChange={(event) => setCity(event.target.value)}
              />
            </label>
            <label className={label}>
              {t("serviceArea")}
              <input
                className={field}
                value={serviceArea}
                maxLength={160}
                onChange={(event) => setServiceArea(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3 border-t border-navy/10 pt-4 sm:col-span-2">
              <button
                type="submit"
                disabled={saving}
                aria-busy={saving}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/50 focus-visible:ring-offset-2"
              >
                <BusyLabel pending={saving} busyLabel={t("saving")}>{t("save")}</BusyLabel>
              </button>
              {message ? (
                <p
                  role={failed ? "alert" : "status"}
                  aria-live="polite"
                  className={
                    failed
                      ? "text-sm font-medium text-red-800"
                      : "text-sm font-medium text-navy/80"
                  }
                >
                  {message}
                </p>
              ) : null}
            </div>
          </form>
        </section>

        <section className={APP_CARD} aria-labelledby="account-team">
          <h2 id="account-team" className={cardTitle}>
            {t("employees")}
          </h2>
          {members.length === 0 ? (
            <p className={cardIntro}>{t("noTeam")}</p>
          ) : (
            <ul className="mt-4 divide-y divide-navy/10 rounded-lg border border-navy/10">
              {members.map((member) => (
                <li
                  key={`${member.email}-${member.role}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-navy">
                      {member.name || member.email}
                    </span>
                    {member.email && member.name ? (
                      <span className="block truncate text-navy/60">{member.email}</span>
                    ) : null}
                  </span>
                  <span className="rounded-full bg-navy/[0.06] px-2.5 py-0.5 text-xs font-semibold text-navy/80">
                    {roleLabel[member.role]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={APP_CARD} aria-labelledby="account-requests">
          <h2 id="account-requests" className={cardTitle}>
            {t("requestHistory")}
          </h2>
          <p className={cardIntro}>{t("requestTiming")}</p>
          <p className="mt-2 text-sm text-navy/70">{t("phoneStays")}</p>
          {!canRequestAccountChange ? (
            <p className="mt-2 text-sm text-navy/70">{t("requestPermission")}</p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className={secondaryButton}
              disabled={exporting}
              aria-busy={exporting}
              onClick={() => void downloadExport()}
            >
              {exporting ? t("exportPreparing") : t("export")}
            </button>
            <button
              type="button"
              className={secondaryButton}
              disabled={requesting || !canRequestAccountChange}
              onClick={() => void request("suspension")}
            >
              {t("suspend")}
            </button>
            <button
              type="button"
              className={secondaryButton}
              disabled={requesting || !canRequestAccountChange}
              onClick={() => void request("reactivation")}
            >
              {t("reactivate")}
            </button>
          </div>
          {requesting ? (
            <p role="status" className="mt-3 text-sm text-navy/80">
              {t("requestSending")}
            </p>
          ) : null}
          {requestHistoryError ? (
            <p role="alert" className="mt-3 text-sm font-medium text-red-800">
              {t("requestHistoryError")}
            </p>
          ) : null}
          {requests.length ? (
            <ul className="mt-4 divide-y divide-navy/10 rounded-lg border border-navy/10 text-sm text-navy">
              {requests.map((row) => (
                <li key={row.id} className="flex flex-col gap-1 px-4 py-3">
                  <p className="font-semibold">
                    {t(`requestKinds.${row.kind}`)} ·{" "}
                    {t(`requestStatuses.${row.status}`)}
                  </p>
                  <p className="text-navy/70">{t("requestReference", { id: row.id })}</p>
                  <p className="text-navy/70">
                    {t("requestSubmitted")}{" "}
                    <time dateTime={row.createdAt}>
                      {submittedAt(row.createdAt)}
                    </time>
                  </p>
                  <p className="text-navy/70">
                    {row.status === "completed"
                      ? t("requestCompletedTiming")
                      : row.status === "withdrawn"
                        ? t("requestWithdrawnTiming")
                        : t("requestPendingTiming")}
                  </p>
                  {row.status === "requested" || row.status === "in_review" ? (
                    <button
                      type="button"
                      className="mt-1 w-fit rounded-lg border border-navy/15 px-2.5 py-1 text-xs font-medium"
                      disabled={withdrawingId !== null || requesting}
                      onClick={() => void withdraw(row.id)}
                    >
                      {withdrawingId === row.id
                        ? t("requestWithdrawing")
                        : t("requestWithdraw")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : canRequestAccountChange && !requestHistoryError ? (
            <p className="mt-4 text-sm text-navy/60">{t("requestNone")}</p>
          ) : null}

          <div className="mt-6 rounded-lg border border-red-200 bg-red-50/60 p-4">
            <p className="text-sm font-semibold text-red-900">{t("dangerTitle")}</p>
            <p className="mt-1 text-sm text-red-900/80">{t("deletionNote")}</p>
            <button
              type="button"
              className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-red-300 bg-white px-3.5 py-2 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600/50"
              disabled={requesting || !canRequestAccountChange}
              onClick={() => void request("deletion")}
            >
              {t("deletion")}
            </button>
          </div>
        </section>
      </div>

      <aside className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-6 xl:gap-6">
        <section className={APP_CARD} aria-labelledby="account-setup">
          <h2 id="account-setup" className={cardTitle}>
            {t("setupTitle")}
          </h2>
          <p className={cardIntro}>{t("setupIntro")}</p>
          <ol className="mt-4 flex list-none flex-col gap-2 p-0 text-sm">
            {SETUP.map((step, index) => (
              <li key={step.href}>
                <Link
                  href={step.href}
                  className="flex items-center gap-3 rounded-lg border border-navy/10 px-3 py-2.5 font-semibold text-navy hover:border-navy/25 hover:bg-navy/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/40"
                >
                  <span
                    aria-hidden
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy/[0.07] text-xs font-bold text-navy/80 tabular-nums"
                  >
                    {index + 1}
                  </span>
                  {t(step.key)}
                </Link>
              </li>
            ))}
          </ol>
        </section>

        <section className={APP_CARD} aria-labelledby="account-shortcuts">
          <h2 id="account-shortcuts" className={cardTitle}>
            {t("shortcutsTitle")}
          </h2>
          <ul className="mt-3 flex list-none flex-col gap-1 p-0 text-sm">
            <li>
              <Link
                href="/app/settings/security"
                className="block rounded-lg px-3 py-2 font-semibold text-navy underline-offset-4 hover:bg-navy/[0.03] hover:underline"
              >
                {t("sessions")}
              </Link>
            </li>
            <li>
              <Link
                href="/app/settings/notifications"
                className="block rounded-lg px-3 py-2 font-semibold text-navy underline-offset-4 hover:bg-navy/[0.03] hover:underline"
              >
                {t("alerts")}
              </Link>
            </li>
          </ul>
          {canManageBilling ? (
            <div className="mt-4 border-t border-navy/10 pt-4">
              <BillingPortalButton />
            </div>
          ) : null}
        </section>
      </aside>
    </div>
  );
}
