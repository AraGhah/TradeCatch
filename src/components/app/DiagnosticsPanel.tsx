"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const CHECKS = ["ai", "phone", "calendar", "notifications", "sms", "automations", "subscription"] as const;

export function DiagnosticsPanel({ organizationId }: { organizationId: string }) {
  const t = useTranslations("app.support");
  const [result, setResult] = useState("");

  async function run(check: string) {
    const response = await fetch(`/api/businesses/${organizationId}/diagnostics`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ check }),
    });
    const body = await response.json();
    setResult(JSON.stringify(body, null, 2));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-2xl text-sm text-navy/70">{t("configNote")}</p>
      <div className="flex flex-wrap gap-2">
        {CHECKS.map((check) => (
          <button key={check} type="button" className="rounded-md border border-navy/15 bg-white px-3 py-2 text-sm text-navy" onClick={() => void run(check)}>{check}</button>
        ))}
      </div>
      {result ? <pre className="overflow-auto rounded-md border border-navy/10 bg-white p-3 text-xs text-navy">{result}</pre> : null}
    </div>
  );
}
