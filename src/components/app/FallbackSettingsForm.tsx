"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Settings = {
  aiUnavailable: "transfer" | "voicemail";
  calendarUnavailable: "collect_request";
  databaseUnavailable: "do_not_claim_saved";
  transferFailed: "voicemail" | "backup";
};

export function FallbackSettingsForm({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = useTranslations("app.monitoring");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [busy, setBusy] = useState(false);

  function fetchSettings() {
    return fetch(`/api/businesses/${organizationId}/fallback-settings`)
      .then((response) => {
        if (!response.ok) throw new Error("Fallback settings unavailable");
        return response.json();
      })
      .then((body) => {
        const parsed = body as { settings?: Settings };
        setSettings(parsed.settings ?? null);
        setLoadError(false);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }

  function retry() {
    setLoading(true);
    setLoadError(false);
    void fetchSettings();
  }

  useEffect(() => {
    void fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  async function save() {
    if (!settings || busy) return;
    setBusy(true);
    setMessage("");
    setMessageError(false);
    try {
      const response = await fetch(
        `/api/businesses/${organizationId}/fallback-settings`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          // Calls are never transferred: when the receptionist cannot answer, the caller leaves a message.
          body: JSON.stringify({
            ...settings,
            aiUnavailable: "voicemail",
            transferFailed: "voicemail",
          }),
        },
      );
      setMessageError(!response.ok);
      setMessage(response.ok ? t("fallbackSaved") : t("fallbackSaveError"));
    } catch {
      setMessageError(true);
      setMessage(t("fallbackSaveError"));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div role="alert" className="max-w-xl text-sm text-red-700">
        <p>{t("fallbackLoadError")}</p>
        <button
          type="button"
          className="mt-1 font-semibold underline"
          onClick={retry}
        >
          {t("fallbackRetry")}
        </button>
      </div>
    );
  }

  if (loading || !settings)
    return <p role="status" className="text-sm text-navy/70">{t("fallbackLoading")}</p>;

  return (
    <form
      className="flex max-w-xl flex-col gap-4 rounded-md bg-white p-4 ring-1 ring-navy/10"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="text-sm text-navy">{t("fallbackAiUnavailableNote")}</p>
      <p className="text-sm text-navy/70">{t("fallbackCalendarNote")}</p>
      <p className="text-sm text-navy/70">{t("fallbackDatabaseNote")}</p>
      <button
        type="submit"
        disabled={busy}
        className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {busy ? t("fallbackSaving") : t("fallbackSave")}
      </button>
      {message ? (
        <p
          role={messageError ? "alert" : "status"}
          className="text-sm text-navy"
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
