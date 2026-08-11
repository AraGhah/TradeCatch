"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

export function ApiKeyCreateButton() {
  const t = useTranslations("app");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createKey() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/app/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "website" }),
      });
      const data = (await res.json().catch(() => null)) as {
        token?: string;
        error?: string;
      } | null;
      if (!res.ok || !data?.token) {
        setError(data?.error || t("settings.apiKeyError"));
        return;
      }
      setToken(data.token);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => void createKey()}
        className="rounded-md border border-navy/20 bg-white px-3 py-2 text-sm font-medium text-navy hover:bg-navy/5 disabled:opacity-50"
      >
        {busy ? t("settings.apiKeyCreating") : t("settings.apiKeyCreate")}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {token ? (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-navy/60">
            {t("settings.apiKeyOnce")}
          </p>
          <code className="mt-2 block break-all text-sm text-navy">{token}</code>
          <p className="mt-2 text-xs text-navy/60">{t("settings.apiKeyHint")}</p>
        </div>
      ) : null}
    </div>
  );
}
