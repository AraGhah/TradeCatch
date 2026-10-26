"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type FeatureFlags = {
  aiReceptionist: boolean;
  appointmentBooking: boolean;
  callTransfer: boolean;
  missedCallRecovery: boolean;
  quoteFollowups: boolean;
};

const FEATURE_KEYS = [
  "aiReceptionist",
  "appointmentBooking",
  "callTransfer",
  "missedCallRecovery",
  "quoteFollowups",
] as const;

export function BusinessFeaturesForm({
  organizationId,
  initial,
  canEdit,
}: {
  organizationId: string;
  initial: FeatureFlags;
  canEdit: boolean;
}) {
  const t = useTranslations("app.settings");
  const [features, setFeatures] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/businesses/${organizationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ features }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error || t("featuresSaveFailed"));
        return;
      }
      setMessage(t("featuresSaved"));
    } catch {
      setError(t("featuresSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
        {t("featuresHeading")}
      </h2>
      <p className="text-sm text-navy/60">{t("featuresIntro")}</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {FEATURE_KEYS.map((key) => (
          <li key={key}>
            <label className="flex items-center gap-2 rounded-md border border-navy/10 bg-white px-3 py-2 text-sm text-navy">
              <input
                type="checkbox"
                checked={features[key]}
                disabled={!canEdit || saving}
                onChange={(e) =>
                  setFeatures((prev) => ({ ...prev, [key]: e.target.checked }))
                }
              />
              {t(`featureFlags.${key}`)}
            </label>
          </li>
        ))}
      </ul>
      {canEdit ? (
        <button
          type="submit"
          disabled={saving}
          className="w-fit rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {t("saveFeatures")}
        </button>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-800">{message}</p> : null}
    </form>
  );
}
