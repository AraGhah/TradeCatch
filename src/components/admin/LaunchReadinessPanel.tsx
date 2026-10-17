"use client";

import { useEffect, useState } from "react";

type Check = { component: string; status: string; detail: string };

export function LaunchReadinessPanel() {
  const [overall, setOverall] = useState("");
  const [checks, setChecks] = useState<Check[]>([]);

  useEffect(() => {
    fetch("/api/admin/launch-readiness")
      .then((response) => response.json())
      .then((body) => {
        const parsed = body as { overall?: string; checks?: Check[] };
        setOverall(parsed.overall || "");
        setChecks(parsed.checks ?? []);
      });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">Launch readiness</h1>
      <p className="max-w-2xl text-sm text-navy/70">A staging test does not mark production phone, AI, or billing as ready. Real customer traffic stays off while a critical check needs attention or has failed.</p>
      <p className="text-lg font-semibold text-navy">{overall || "Checking…"}</p>
      <ul className="grid gap-2 md:grid-cols-2">
        {checks.map((check) => (
          <li key={check.component} className="rounded-md bg-white px-3 py-2 text-sm ring-1 ring-navy/10">
            <p className="font-semibold text-navy">{check.component} · {check.status}</p>
            <p className="text-navy/70">{check.detail}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
