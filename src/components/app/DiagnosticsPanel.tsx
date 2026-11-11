"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const CHECKS = [
  "ai",
  "phone",
  "calendar",
  "notifications",
  "sms",
  "automations",
  "subscription",
] as const;
type Check = (typeof CHECKS)[number];

type Report = {
  check: Check;
  findings: { code: string; detail: string }[];
  recentErrorCount: number;
};

export function DiagnosticsPanel({ organizationId }: { organizationId: string }) {
  const t = useTranslations("app.support");
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);
  const [running, setRunning] = useState<Check | null>(null);

  async function run(check: Check) {
    if (running) return;
    setRunning(check);
    setFailed(false);
    try {
      const response = await fetch(
        `/api/businesses/${organizationId}/diagnostics`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ check }),
        },
      );
      if (!response.ok) throw new Error("Diagnostics failed");
      const body = (await response.json()) as {
        findings?: { code: string; detail: string }[];
        recentErrorCount?: number;
      };
      setReport({
        check,
        findings: body.findings ?? [],
        recentErrorCount: body.recentErrorCount ?? 0,
      });
    } catch {
      setReport(null);
      setFailed(true);
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-2xl text-sm text-navy/70">{t("configNote")}</p>
      <div className="flex flex-wrap gap-2">
        {CHECKS.map((check) => (
          <button
            key={check}
            type="button"
            disabled={running !== null}
            aria-pressed={report?.check === check}
            className="min-h-9 rounded-md border border-navy/15 bg-white px-3 py-2 text-sm text-navy disabled:opacity-50"
            onClick={() => void run(check)}
          >
            {t(`checks.${check}`)}
          </button>
        ))}
      </div>
      {running ? (
        <p role="status" className="text-sm text-navy/70">
          {t("checkRunning")}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="text-sm text-red-700">
          {t("checkFailed")}
        </p>
      ) : null}
      {report && !running ? (
        <section
          aria-live="polite"
          className="max-w-2xl rounded-md border border-navy/10 bg-white p-4 text-sm text-navy"
        >
          <h2 className="m-0 font-semibold">{t(`checks.${report.check}`)}</h2>
          {report.findings.length === 0 ? (
            <p className="mt-2">{t("checkClear")}</p>
          ) : (
            <ul className="mt-2 list-disc pl-5">
              {report.findings.map((finding) => (
                <li key={finding.code}>
                  {t.has(`findings.${finding.code}`)
                    ? t(`findings.${finding.code}` as "findings.plan")
                    : finding.detail}
                </li>
              ))}
            </ul>
          )}
          {report.recentErrorCount > 0 ? (
            <p className="mt-2">
              {t("checkRecentErrors", { count: report.recentErrorCount })}
            </p>
          ) : null}
          {report.findings.length > 0 ? (
            <p className="mt-2">
              <Link href="/app/help" className="font-semibold underline">
                {t("help")}
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
