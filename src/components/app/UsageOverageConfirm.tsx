"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

export type OverageRow = {
  metric: "smsSegmentsPerMonth" | "voiceMinutesPerMonth";
  status: "pending" | "confirmed" | "declined";
};

/** Lets the owner confirm or decline billing for usage past the allowance. */
export function UsageOverageConfirm({ rows }: { rows: OverageRow[] }) {
  const t = useTranslations("app.account");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function decide(
    metric: OverageRow["metric"],
    decision: "confirmed" | "declined",
  ) {
    if (busy) return;
    setBusy(metric);
    setError(false);
    try {
      const res = await fetch("/api/billing/usage-overage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metric, decision }),
      });
      if (!res.ok && res.status !== 409) {
        setError(true);
        return;
      }
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-navy/15 p-4">
      <p className="text-sm font-semibold text-navy">{t("overageHeadline")}</p>
      <p className="mt-1 text-sm text-navy/70">{t("overageIntro")}</p>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.metric} className="text-sm text-navy">
            <p>
              {t(
                row.metric === "smsSegmentsPerMonth"
                  ? "overageSms"
                  : "overageVoice",
              )}{" "}
              <strong>{t(`overageStatus_${row.status}`)}</strong>
            </p>
            {row.status === "pending" ? (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void decide(row.metric, "confirmed")}
                  className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {t("overageConfirm")}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void decide(row.metric, "declined")}
                  className="rounded-md border border-navy/30 px-3 py-2 text-sm font-semibold text-navy disabled:opacity-60"
                >
                  {t("overageDecline")}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-navy">
          {t("overageError")}
        </p>
      ) : null}
    </div>
  );
}
