"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { AiReceptionistOverview } from "@/product/receptionist/ai-receptionist-service";

const CARD = "rounded-md border border-navy/10 bg-white px-4 py-4";
const BUTTON =
  "rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 focus-visible:ring-offset-2";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusClass =
    overview.status === "active"
      ? "border-green-300 bg-green-50 text-green-900"
      : overview.status === "error"
        ? "border-red-300 bg-red-50 text-red-900"
        : "border-navy/15 bg-white text-navy/80";

  async function toggleActivation() {
    setBusy(true);
    setError(null);
    const path = overview.activated
      ? `/api/businesses/${organizationId}/ai-receptionist/deactivate`
      : `/api/businesses/${organizationId}/ai-receptionist/activate`;
    try {
      const res = await fetch(path, { method: "POST" });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error || t("activateError"));
        return;
      }
      router.refresh();
    } catch {
      setError(t("activateError"));
    } finally {
      setBusy(false);
    }
  }

  const voiceLabel = `${overview.voice.fr} / ${overview.voice.en}`;

  return (
    <section className="flex flex-col gap-4">
      <div className={`rounded-md border px-4 py-3 text-sm ${statusClass}`}>
        <p className="font-semibold">
          {t(`status.${overview.status}`)}
          {overview.receptionistName
            ? ` — ${overview.receptionistName}`
            : ""}
        </p>
        {overview.statusDetail ? (
          <p className="mt-1 text-xs opacity-90">{overview.statusDetail}</p>
        ) : null}
        <p className="mt-1 text-xs opacity-80">
          {t(`connection.${overview.operationalConnection}`)}
        </p>
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
            ["transfers", String(overview.transfers)],
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

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BUTTON}
          disabled={readOnly || busy}
          onClick={() => void toggleActivation()}
        >
          {overview.activated ? t("deactivate") : t("activate")}
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
