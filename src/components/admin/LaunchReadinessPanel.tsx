"use client";

import { useEffect, useState } from "react";

import { timedFetch } from "@/lib/client/timed-fetch";
import { InlineStatus } from "@/components/ui/Spinner";

type Check = { component: string; status: string; detail: string };

export function LaunchReadinessPanel() {
  const [overall, setOverall] = useState("");
  const [checks, setChecks] = useState<Check[]>([]);
  /** null = still loading; true/false = finished. */
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    timedFetch("/api/admin/launch-readiness")
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        const parsed = body as { overall?: string; checks?: Check[] };
        setOverall(parsed.overall || "");
        setChecks(parsed.checks ?? []);
        setOk(true);
      })
      .catch(() => {
        if (!cancelled) setOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = ok === null;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
        Launch readiness
      </h1>
      <p className="max-w-2xl text-sm text-navy/70">
        A staging test does not mark production phone, receptionist, or billing
        as ready. Real customer traffic stays off while a critical check needs
        attention or has failed.
      </p>
      {loading ? <InlineStatus>Checking…</InlineStatus> : null}
      {ok === false ? (
        <p className="text-sm text-red-800" role="alert">
          Launch readiness could not be loaded. Refresh the page to try again.
        </p>
      ) : null}
      {ok === true ? (
        <p className="text-lg font-semibold text-navy" role="status">
          {overall || "No status yet"}
        </p>
      ) : null}
      <ul className="grid gap-2 md:grid-cols-2">
        {checks.map((check) => (
          <li
            key={check.component}
            className="rounded-md bg-white px-3 py-2 text-sm ring-1 ring-navy/10"
          >
            <p className="font-semibold text-navy">
              {check.component} · {check.status}
            </p>
            <p className="text-navy/70">{check.detail}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
