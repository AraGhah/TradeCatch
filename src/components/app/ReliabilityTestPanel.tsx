"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const SCENARIOS = [
  "ai_timeout",
  "job_failure",
  "cost_threshold",
] as const;

export function ReliabilityTestPanel({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = useTranslations("app.reliabilityTest");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function run(scenario: (typeof SCENARIOS)[number]) {
    if (busy) return;
    setBusy(scenario);
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch("/api/admin/monitoring/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario, organizationId }),
      });
      if (!response.ok) throw new Error("failed");
      setMessage(t(`ok.${scenario}`));
    } catch {
      setFailed(true);
      setMessage(t("error"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-md bg-white p-4 ring-1 ring-navy/10">
      <h2 className="font-semibold text-navy">{t("title")}</h2>
      <p className="mt-1 text-sm text-navy/70">{t("intro")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {SCENARIOS.map((scenario) => (
          <button
            key={scenario}
            type="button"
            disabled={busy !== null}
            className="rounded-md bg-navy px-3 py-2 text-sm text-white disabled:opacity-50"
            onClick={() => void run(scenario)}
          >
            {t(`actions.${scenario}`)}
          </button>
        ))}
      </div>
      {message ? (
        <p
          role={failed ? "alert" : "status"}
          className={`mt-3 text-sm ${failed ? "text-red-700" : "text-navy"}`}
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
