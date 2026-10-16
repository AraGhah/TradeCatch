"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

type CallRow = {
  id: string;
  callSid: string;
  simulated?: boolean;
  fromE164: string;
  language: string;
  status: string;
  outcome?: string;
  urgency?: string;
  summary?: { headline?: string; issue?: string; callerName?: string };
  durationSeconds?: number;
  startedAt: string;
  transfers?: unknown[];
};

const CARD = "rounded-md border border-navy/10 bg-white px-4 py-4";

export function ReceptionistCallHistory({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = useTranslations("app.receptionist.history");
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/businesses/${organizationId}/ai-receptionist/calls`,
        );
        const data = (await res.json().catch(() => null)) as {
          calls?: CallRow[];
          error?: string;
        } | null;
        if (!res.ok) {
          if (!cancelled) setError(data?.error || t("error"));
          return;
        }
        if (!cancelled) setCalls(data?.calls ?? []);
      } catch {
        if (!cancelled) setError(t("error"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, t]);

  if (loading) {
    return <p className="text-sm text-navy/60">{t("loading")}</p>;
  }
  if (error) {
    return (
      <p role="alert" className="text-sm text-red-700">
        {error}
      </p>
    );
  }
  if (calls.length === 0) {
    return <p className="text-sm text-navy/60">{t("empty")}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-navy">{t("title")}</h2>
      {calls.map((c) => (
        <article key={c.id} className={CARD}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-navy">
              {c.summary?.callerName || c.fromE164}
              {c.simulated ? (
                <span className="ml-2 text-xs font-normal text-navy/50">
                  {t("simulated")}
                </span>
              ) : null}
            </p>
            <time className="text-xs text-navy/50">
              {new Date(c.startedAt).toLocaleString()}
            </time>
          </div>
          <p className="mt-1 text-sm text-navy/80">
            {c.summary?.headline ||
              c.summary?.issue ||
              c.outcome ||
              c.status}
          </p>
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy/60">
            {c.durationSeconds != null ? (
              <div>
                <dt className="inline">{t("duration")}: </dt>
                <dd className="inline m-0">
                  {Math.floor(c.durationSeconds / 60)}m {c.durationSeconds % 60}
                  s
                </dd>
              </div>
            ) : null}
            {c.outcome ? (
              <div>
                <dt className="inline">{t("outcome")}: </dt>
                <dd className="inline m-0">{c.outcome}</dd>
              </div>
            ) : null}
            {c.urgency ? (
              <div>
                <dt className="inline">{t("urgency")}: </dt>
                <dd className="inline m-0">{c.urgency}</dd>
              </div>
            ) : null}
            {c.transfers && c.transfers.length > 0 ? (
              <div>
                <dt className="inline">{t("transfer")}: </dt>
                <dd className="inline m-0">{t("yes")}</dd>
              </div>
            ) : null}
          </dl>
        </article>
      ))}
    </div>
  );
}
