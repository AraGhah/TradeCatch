"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function SettingsIntegrationsForm({
  initialNotifyEmail,
  initialGoogleReviewUrl,
  initialCrmWebhookUrl,
  isGrowth,
}: {
  initialNotifyEmail?: string;
  initialGoogleReviewUrl?: string;
  initialCrmWebhookUrl?: string;
  isGrowth: boolean;
}) {
  const t = useTranslations("app");
  const router = useRouter();
  const [notifyEmail, setNotifyEmail] = useState(initialNotifyEmail ?? "");
  const [googleReviewUrl, setGoogleReviewUrl] = useState(
    initialGoogleReviewUrl ?? "",
  );
  const [crmWebhookUrl, setCrmWebhookUrl] = useState(
    initialCrmWebhookUrl ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/app/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notifyEmail: notifyEmail.trim() || null,
          googleReviewUrl: isGrowth
            ? googleReviewUrl.trim() || null
            : undefined,
          crmWebhookUrl: crmWebhookUrl.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error || t("settings.saveError"));
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <label className="block text-xs text-navy/70">
        {t("settings.notifyEmail")}
        <input
          type="email"
          value={notifyEmail}
          onChange={(e) => setNotifyEmail(e.target.value)}
          placeholder={t("settings.notifyEmailPlaceholder")}
          className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
        />
      </label>
      {isGrowth ? (
        <label className="block text-xs text-navy/70">
          {t("settings.googleReviewUrl")}
          <input
            type="url"
            value={googleReviewUrl}
            onChange={(e) => setGoogleReviewUrl(e.target.value)}
            placeholder="https://g.page/r/…"
            className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
          />
        </label>
      ) : null}
      <label className="block text-xs text-navy/70">
        {t("settings.crmWebhookUrl")}
        <input
          type="url"
          value={crmWebhookUrl}
          onChange={(e) => setCrmWebhookUrl(e.target.value)}
          placeholder="https://hooks.zapier.com/…"
          className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
        />
        <span className="mt-1 block text-[11px] text-navy/50">
          {t("settings.crmWebhookIntro")}
        </span>
      </label>
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="text-sm text-green-800">{t("settings.saved")}</p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void save()}
        className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy/90 disabled:opacity-50"
      >
        {busy ? t("settings.saving") : t("settings.save")}
      </button>
    </div>
  );
}
