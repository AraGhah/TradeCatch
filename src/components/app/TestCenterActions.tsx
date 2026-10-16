"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export function TestCenterActions({
  organizationId,
  isDemo,
  isAdmin,
}: {
  organizationId: string;
  isDemo: boolean;
  isAdmin: boolean;
}) {
  const t = useTranslations("app.testCenter");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function seed() {
    setError(null);
    setMessage(null);
    const res = await fetch(
      `/api/admin/demo-businesses/${organizationId}/seed`,
      { method: "POST" },
    );
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(json.error || t("seedFailed"));
      return;
    }
    setMessage(t("seedOk"));
  }

  async function reset() {
    if (!window.confirm(t("confirmReset"))) return;
    setError(null);
    setMessage(null);
    const res = await fetch(
      `/api/admin/demo-businesses/${organizationId}/reset`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "RESET_DEMO_ACCOUNT", reseed: true }),
      },
    );
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(json.error || t("resetFailed"));
      return;
    }
    setMessage(t("resetOk"));
  }

  if (!isDemo) {
    return (
      <p className="rounded-md border border-navy/10 bg-white px-4 py-3 text-sm text-navy/70">
        {t("notDemo")}
      </p>
    );
  }

  if (!isAdmin) {
    return (
      <p className="rounded-md border border-navy/10 bg-white px-4 py-3 text-sm text-navy/70">
        {t("adminOnly")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void seed()}
          className="rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-white"
        >
          {t("generateData")}
        </button>
        <button
          type="button"
          onClick={() => void reset()}
          className="rounded-md border border-navy/20 px-4 py-2.5 text-sm font-semibold text-navy"
        >
          {t("resetAccount")}
        </button>
      </div>
      <p className="text-xs text-navy/50">{t("safetyNote")}</p>
    </div>
  );
}
