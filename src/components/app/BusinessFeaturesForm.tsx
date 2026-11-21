"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useFailureText } from "@/components/ui/FeedbackMessage";
import { BusyLabel } from "@/components/ui/Spinner";
import { classifyFailure } from "@/lib/client/use-action";
import { useGuarded } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
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
  const failureText = useFailureText();
  const [features, setFeatures] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = useGuarded(saveHandler);
  async function saveHandler(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await timedFetch(`/api/businesses/${organizationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ features }),
      });
      // A 2xx is the server's confirmation; an unreadable body does not undo it.
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || t("featuresSaveFailed"));
        return;
      }
      setMessage(t("featuresSaved"));
    } catch (err) {
      // No answer is not the same as "not saved": say so when the change may have gone through.
      const failure = classifyFailure(err, { write: true });
      setError(failure.outcomeUnknown ? failureText(failure) : t("featuresSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} aria-busy={saving} className="flex flex-col gap-3">
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
          aria-busy={saving}
          className="w-fit rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          <BusyLabel pending={saving} busyLabel={t("saving")}>
            {t("saveFeatures")}
          </BusyLabel>
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-emerald-800">
          {message}
        </p>
      ) : null}
    </form>
  );
}
