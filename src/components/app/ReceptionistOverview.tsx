"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import type { AiReceptionistOverview } from "@/product/receptionist/ai-receptionist-service";

const CARD = "rounded-md border border-navy/10 bg-white px-4 py-4";
const BUTTON_STOP =
  "inline-flex items-center gap-2 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600/60 focus-visible:ring-offset-2";
const BUTTON_GO =
  "inline-flex items-center gap-2 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 focus-visible:ring-offset-2";
const BUTTON_GHOST =
  "rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-50";

export function ReceptionistOverview({
  organizationId,
  overview,
  readOnly,
  onEdit,
  onTest,
  onHistory,
}: {
  organizationId: string;
  overview: AiReceptionistOverview;
  readOnly: boolean;
  onEdit: () => void;
  onTest: () => void;
  onHistory: () => void;
}) {
  const t = useTranslations("app.receptionist");
  const router = useRouter();
  // `working` is the request in flight; `confirmed` is what the backend last
  // reported. The page never shows a new state before the backend has said so.
  const [working, setWorking] = useState<"activate" | "deactivate" | null>(null);
  const [confirmed, setConfirmed] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  // The refreshed server data is the source of truth again once it arrives.
  const serverKey = `${overview.activated}|${overview.updatedAt}`;
  const [seenServerKey, setSeenServerKey] = useState(serverKey);
  if (seenServerKey !== serverKey) {
    setSeenServerKey(serverKey);
    setConfirmed(null);
  }

  const activated = confirmed ?? overview.activated;
  const kind: "active" | "inactive" | "error" = !activated
    ? "inactive"
    : confirmed === null && overview.status === "error"
      ? "error"
      : "active";

  const statusClass =
    kind === "active"
      ? "border-green-300 bg-green-50 text-green-900"
      : kind === "error"
        ? "border-red-300 bg-red-50 text-red-900"
        : "border-navy/15 bg-white text-navy/80";
  const dotClass =
    kind === "active"
      ? "bg-green-600"
      : kind === "error"
        ? "bg-red-600"
        : "bg-navy/40";

  async function toggleActivation() {
    // One request at a time: a double click must not send two.
    if (inFlight.current) return;
    inFlight.current = true;
    const wantActive = !activated;
    setWorking(wantActive ? "activate" : "deactivate");
    setError(null);
    setNotice(null);
    const path = wantActive
      ? `/api/businesses/${organizationId}/ai-receptionist/activate`
      : `/api/businesses/${organizationId}/ai-receptionist/deactivate`;
    try {
      const res = await fetch(path, { method: "POST" });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        activated?: boolean;
        changed?: boolean;
        error?: string;
      } | null;
      // Success means the backend confirmed the state that was asked for.
      if (!res.ok || !data?.ok || data.activated !== wantActive) {
        setError(data?.error || t("activateError"));
        return;
      }
      setConfirmed(data.activated);
      setNotice(
        data.changed === false
          ? t(wantActive ? "alreadyActive" : "alreadyInactive")
          : t(wantActive ? "activatedOk" : "deactivatedOk"),
      );
      router.refresh();
    } catch {
      setError(t("activateError"));
    } finally {
      inFlight.current = false;
      setWorking(null);
    }
  }

  const voiceLabel = `${overview.voice.fr} / ${overview.voice.en}`;

  return (
    <section className="flex flex-col gap-4">
      <div
        className={`rounded-md border px-4 py-3 text-sm ${statusClass}`}
        data-testid="receptionist-status"
        data-status={kind}
      >
        <p className="flex items-center gap-2 font-semibold">
          <span
            aria-hidden
            className={`inline-block h-2.5 w-2.5 rounded-full ${dotClass}`}
          />
          <span>
            {t(`status.${kind}`)}
            {overview.receptionistName
              ? ` · ${overview.receptionistName}`
              : ""}
          </span>
        </p>
        {kind === "inactive" ? (
          <p className="mt-1 text-xs opacity-90">{t("inactiveDetail")}</p>
        ) : overview.statusDetail ? (
          <p className="mt-1 text-xs opacity-90">{overview.statusDetail}</p>
        ) : null}
        {kind !== "inactive" ? (
          <p className="mt-1 text-xs opacity-80">
            {t(`connection.${overview.operationalConnection}`)}
          </p>
        ) : null}
      </div>

      <dl className={`m-0 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 ${CARD}`}>
        {(
          [
            ["aiName", overview.receptionistName || "—"],
            ["phone", overview.phoneNumberE164 || "—"],
            ["language", t(`languageValue.${overview.language}`)],
            ["voice", voiceLabel],
            ["business", overview.businessName],
            ["calls", String(overview.callsHandled)],
            ["appointments", String(overview.appointmentsBooked)],
            ["appointmentsRequested", String(overview.appointmentsRequested)],
            [
              "lastActivity",
              overview.lastActivityAt
                ? new Date(overview.lastActivityAt).toLocaleString()
                : "—",
            ],
            ["mode", t(`modes.${overview.callHandlingMode}`)],
          ] as const
        ).map(([key, value]) => (
          <div key={key}>
            <dt className="text-xs text-navy/60">{t(`overview.${key}`)}</dt>
            <dd className="m-0 mt-1 text-sm font-semibold text-navy">{value}</dd>
          </div>
        ))}
      </dl>

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <p
        role="status"
        aria-live="polite"
        className={notice ? "text-sm text-green-800" : "sr-only"}
      >
        {notice}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={activated ? BUTTON_STOP : BUTTON_GO}
          disabled={readOnly || working !== null}
          aria-busy={working !== null}
          onClick={() => void toggleActivation()}
        >
          {working !== null ? (
            <span
              aria-hidden
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
          ) : null}
          {working === "deactivate"
            ? t("deactivating")
            : working === "activate"
              ? t("activating")
              : activated
                ? t("deactivate")
                : t("activate")}
        </button>
        <button type="button" className={BUTTON_GHOST} onClick={onEdit}>
          {t("editConfig")}
        </button>
        <button type="button" className={BUTTON_GHOST} onClick={onTest}>
          {t("testAi")}
        </button>
        <button type="button" className={BUTTON_GHOST} onClick={onHistory}>
          {t("viewHistory")}
        </button>
      </div>
    </section>
  );
}
