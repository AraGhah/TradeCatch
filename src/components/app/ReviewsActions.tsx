"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function ReviewsActions({
  googleReviewUrl,
  appointmentIds,
}: {
  googleReviewUrl?: string | null;
  appointmentIds: { id: string; label: string }[];
}) {
  const t = useTranslations("app");
  const router = useRouter();
  const [url, setUrl] = useState(googleReviewUrl ?? "");
  const [appointmentId, setAppointmentId] = useState(
    appointmentIds[0]?.id ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveUrl(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/app/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-url",
          googleReviewUrl: url.trim(),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error || t("reviews.error"));
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function complete(e: React.FormEvent) {
    e.preventDefault();
    if (!appointmentId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/app/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          appointmentId,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error || t("reviews.error"));
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <form
        onSubmit={(e) => void saveUrl(e)}
        className="rounded-md border border-navy/10 bg-white px-4 py-4"
      >
        <p className="text-sm font-semibold text-navy">
          {t("reviews.setUrl")}
        </p>
        <label className="mt-3 block text-xs text-navy/70">
          {t("settings.googleReviewUrl")}
          <input
            required
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="mt-3 rounded-md bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy/90 disabled:opacity-50"
        >
          {busy ? t("reviews.saving") : t("reviews.saveUrl")}
        </button>
      </form>

      {appointmentIds.length > 0 ? (
        <form
          onSubmit={(e) => void complete(e)}
          className="rounded-md border border-navy/10 bg-white px-4 py-4"
        >
          <p className="text-sm font-semibold text-navy">
            {t("reviews.complete")}
          </p>
          <label className="mt-3 block text-xs text-navy/70">
            {t("reviews.appointment")}
            <select
              value={appointmentId}
              onChange={(e) => setAppointmentId(e.target.value)}
              className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
            >
              {appointmentIds.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={busy || !appointmentId}
            className="mt-3 rounded-md bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy/90 disabled:opacity-50"
          >
            {busy ? t("reviews.saving") : t("reviews.markComplete")}
          </button>
        </form>
      ) : null}
    </div>
  );
}
