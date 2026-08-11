"use client";

import { Link } from "@/i18n/navigation";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function OnboardingWizard({
  initialNotifyEmail,
  initialGoogleReviewUrl,
  isGrowth,
  alreadyComplete,
}: {
  initialNotifyEmail?: string;
  initialGoogleReviewUrl?: string;
  isGrowth: boolean;
  alreadyComplete: boolean;
}) {
  const t = useTranslations("app");
  const router = useRouter();
  const [step, setStep] = useState(alreadyComplete ? 3 : 0);
  const [notifyEmail, setNotifyEmail] = useState(initialNotifyEmail ?? "");
  const [googleReviewUrl, setGoogleReviewUrl] = useState(
    initialGoogleReviewUrl ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveNotify() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/app/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notifyEmail: notifyEmail.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error || t("onboarding.error"));
        return;
      }
      setStep(isGrowth ? 1 : 2);
    } finally {
      setBusy(false);
    }
  }

  async function saveReviewUrl() {
    setBusy(true);
    setError(null);
    try {
      const body: { googleReviewUrl?: string | null } = {};
      if (googleReviewUrl.trim()) {
        body.googleReviewUrl = googleReviewUrl.trim();
      } else {
        body.googleReviewUrl = null;
      }
      const res = await fetch("/api/app/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error || t("onboarding.error"));
        return;
      }
      setStep(2);
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/app/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          onboardingCompletedAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error || t("onboarding.error"));
        return;
      }
      setStep(3);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-navy/10 bg-white px-5 py-5">
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}

      {step === 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-navy">
            {t("onboarding.stepNotify")}
          </h2>
          <p className="text-sm text-navy/70">{t("onboarding.stepNotifyIntro")}</p>
          <label className="text-xs text-navy/70">
            {t("settings.notifyEmail")}
            <input
              type="email"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              placeholder={t("settings.notifyEmailPlaceholder")}
              className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveNotify()}
            className="self-start rounded-md bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy/90 disabled:opacity-50"
          >
            {busy ? t("onboarding.saving") : t("onboarding.next")}
          </button>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-navy">
            {t("onboarding.stepReview")}
          </h2>
          <p className="text-sm text-navy/70">{t("onboarding.stepReviewIntro")}</p>
          <label className="text-xs text-navy/70">
            {t("settings.googleReviewUrl")}
            <input
              type="url"
              value={googleReviewUrl}
              onChange={(e) => setGoogleReviewUrl(e.target.value)}
              placeholder="https://g.page/r/…"
              className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveReviewUrl()}
              className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy/90 disabled:opacity-50"
            >
              {busy ? t("onboarding.saving") : t("onboarding.next")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep(2)}
              className="rounded-md border border-navy/20 px-4 py-2 text-sm font-medium text-navy hover:bg-navy/5"
            >
              {t("onboarding.skip")}
            </button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-navy">
            {t("onboarding.stepFinish")}
          </h2>
          <p className="text-sm text-navy/70">{t("onboarding.stepFinishIntro")}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void complete()}
            className="self-start rounded-md bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy/90 disabled:opacity-50"
          >
            {busy ? t("onboarding.saving") : t("onboarding.complete")}
          </button>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-navy">
            {t("onboarding.done")}
          </h2>
          <p className="text-sm text-navy/70">{t("onboarding.doneIntro")}</p>
          <Link
            href="/app/settings"
            className="self-start rounded-md border border-navy/20 px-4 py-2 text-sm font-medium text-navy hover:bg-navy/5"
          >
            {t("onboarding.goSettings")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
