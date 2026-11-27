"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { timedFetch } from "@/lib/client/timed-fetch";
import { useGuarded } from "@/lib/client/use-single-flight";
import { BusyLabel } from "@/components/ui/Spinner";

export type QuoteWordingStep = { day: number; text: string };

/**
 * Shows the exact quote follow-up messages and lets the owner approve (or
 * withdraw) them. The server sends nothing until `approvedAt` is set.
 */
export function QuoteWordingApproval({
  locale,
  steps,
  approvedAt,
}: {
  locale: "en" | "fr";
  steps: QuoteWordingStep[];
  approvedAt?: string;
}) {
  const t = useTranslations("app");
  const router = useRouter();
  const tFeedback = useTranslations("feedback");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setApproved = useGuarded(setApprovedHandler);
  async function setApprovedHandler(approved: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await timedFetch("/api/app/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteFollowUpApproved: approved }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error || t("quotes.wordingError"));
        return;
      }
      router.refresh();
    } catch {
      setError(t("quotes.wordingError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="quote-wording-title"
      className="rounded-xl border border-navy/10 bg-white p-5 shadow-[0_1px_2px_rgb(12_20_30/0.04)] sm:p-6"
    >
      <h2 id="quote-wording-title" className="text-sm font-semibold text-navy">
        {t("quotes.wordingTitle")}
      </h2>
      <p className="mt-1 text-sm text-navy/70">{t("quotes.wordingIntro")}</p>
      <ol className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.day} className="rounded border border-navy/10 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-navy/50">
              {t("quotes.wordingDay", { day: s.day })}
            </p>
            <p className="text-sm text-navy">{s.text}</p>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-navy/80" role="status">
        {approvedAt
          ? t("quotes.wordingApprovedOn", {
              date: new Date(approvedAt).toLocaleDateString(
                locale === "fr" ? "fr-CA" : "en-CA",
              ),
            })
          : t("quotes.wordingPending")}
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void setApproved(!approvedAt)}
        className="mt-3 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        <BusyLabel pending={busy} busyLabel={tFeedback("saving")}>
          {approvedAt ? t("quotes.wordingWithdraw") : t("quotes.wordingApprove")}
        </BusyLabel>
      </button>
    </section>
  );
}
