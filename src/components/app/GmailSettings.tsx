"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { GmailSyncStatus } from "./GmailSyncStatus";
import { GMAIL_EVENT } from "@/components/app/GmailSyncBadge";
import type { GmailNotice } from "@/product/gmail/http";
import type { GmailPublicStatus } from "@/product/gmail/types";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 focus-visible:ring-offset-2";

type Status = "connected" | "needs_reconnect" | "not_connected";
type ProblemKey = Exclude<GmailNotice, "connected">;
const PROBLEMS: ProblemKey[] = [
  "denied",
  "needs_reconnect",
  "rate_limited",
  "sync_failed",
  "config_error",
  "not_configured",
];

function asProblem(value: string | null): ProblemKey | null {
  return PROBLEMS.find((problem) => problem === value) ?? null;
}

export function GmailSettings({
  configured,
  status,
  email,
  lastError,
  lastSyncAt,
  pushEnabled = false,
  pushConfigured = false,
  notice,
}: {
  configured: boolean;
  status: Status;
  email: string | null;
  lastError: string | null;
  lastSyncAt: string | null;
  pushEnabled?: boolean;
  pushConfigured?: boolean;
  notice: GmailNotice | null;
}) {
  const t = useTranslations("app.gmail");
  const lang = useLocale() === "fr" ? "fr" : "en";
  const router = useRouter();
  const [pending, setPending] = useState<"disconnect" | "sync" | null>(null);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  // A fresh redirect result wins; otherwise show what the last sync reported.
  const problem =
    asProblem(notice) ??
    (status === "not_connected" ? null : asProblem(lastError));
  const connectHref = `/api/app/gmail/connect?locale=${lang}`;

  async function disconnect() {
    if (!window.confirm(t("disconnectConfirm"))) return;
    setPending("disconnect");
    setMessage(null);
    try {
      const response = await fetch("/api/app/gmail/disconnect", {
        method: "POST",
      });
      if (!response.ok) throw new Error(String(response.status));
      setMessage({ kind: "ok", text: t("disconnectedOk") });
      window.dispatchEvent(new CustomEvent(GMAIL_EVENT, { detail: {} }));
      router.replace("/app/settings");
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: t("disconnectFailed") });
    } finally {
      setPending(null);
    }
  }

  async function checkNow() {
    setPending("sync");
    setMessage(null);
    try {
      const response = await fetch("/api/app/gmail/sync?mode=manual", {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        status?: GmailPublicStatus;
      };
      if (body.status)
        window.dispatchEvent(new CustomEvent(GMAIL_EVENT, { detail: body }));
      if (!response.ok || body.ok === false) {
        const key = asProblem(body.error ?? null) ?? "sync_failed";
        setMessage({ kind: "error", text: t(`errors.${key}`) });
      }
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: t("errors.sync_failed") });
    } finally {
      setPending(null);
    }
  }

  const shownStatus =
    status === "connected" && email
      ? t("status.connected", { email })
      : t(`status.${status}`);

  return (
    <section
      className="rounded-md border border-navy/10 bg-white px-5 py-4"
      aria-labelledby="gmail-settings-title"
    >
      <h2
        id="gmail-settings-title"
        className="font-[family-name:var(--font-archivo)] text-lg font-extrabold text-navy"
      >
        {t("title")}
      </h2>
      <p className="mt-2 text-sm text-navy/80">{t("intro")}</p>
      <p className="mt-1 text-sm text-navy/80">{t("privacy")}</p>

      <p
        className="mt-3 text-sm font-semibold text-navy"
        data-testid="gmail-status"
      >
        {t("statusLabel")} {shownStatus}
      </p>
      {status !== "not_connected" ? (
        <GmailSyncStatus
          lastSyncAt={lastSyncAt}
          pushEnabled={pushEnabled}
          pushConfigured={pushConfigured}
        />
      ) : null}
      <p className="mt-3 text-sm text-navy/80">
        {t("replyAlertsHint")}{" "}
        <Link
          href="/app/settings/notifications"
          className="font-semibold underline"
        >
          {t("configureReplyAlerts")}
        </Link>
      </p>

      <div aria-live="polite">
        {notice === "connected" && status === "connected" ? (
          <p className="mt-2 text-sm font-semibold text-green" role="status">
            {t("connectedOk")}
          </p>
        ) : null}
        {problem ? (
          <p
            className="mt-2 text-sm text-ember-text"
            role="alert"
            data-testid="gmail-problem"
          >
            {t(`errors.${problem}`)}
          </p>
        ) : null}
        {message ? (
          <p
            className={`mt-2 text-sm ${message.kind === "ok" ? "font-semibold text-green" : "text-ember-text"}`}
            role={message.kind === "ok" ? "status" : "alert"}
          >
            {message.text}
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {configured && status !== "connected" ? (
          <a
            href={connectHref}
            className={`rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white ${FOCUS_RING}`}
          >
            {status === "needs_reconnect" ? t("reconnect") : t("connect")}
          </a>
        ) : null}
        {status === "connected" ? (
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void checkNow()}
            className={`rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 ${FOCUS_RING}`}
          >
            {pending === "sync" ? t("checking") : t("checkNow")}
          </button>
        ) : null}
        {status === "connected" && configured ? (
          <a
            href={connectHref}
            className={`rounded-md border border-navy/25 px-3 py-2 text-sm font-semibold text-navy hover:bg-navy/5 ${FOCUS_RING}`}
          >
            {t("reconnect")}
          </a>
        ) : null}
        {status !== "not_connected" ? (
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void disconnect()}
            className={`rounded-md border border-navy/25 px-3 py-2 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-60 ${FOCUS_RING}`}
          >
            {pending === "disconnect" ? t("disconnecting") : t("disconnect")}
          </button>
        ) : null}
      </div>
      {!configured && status === "not_connected" && !problem ? (
        <p className="mt-3 text-sm text-navy/80">
          {t("errors.not_configured")}
        </p>
      ) : null}
    </section>
  );
}
