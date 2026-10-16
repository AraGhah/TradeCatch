"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const ACTIONS = [
  ["lead_created", "lead"],
  ["urgent_request", "urgent"],
  ["appointment_confirmed", "appointment"],
  ["appointment_canceled", "cancel"],
  ["appointment_rescheduled", "move"],
  ["automation_failure", "failure"],
] as const;

export function NotificationTestPanel({ organizationId }: { organizationId: string }) {
  const t = useTranslations("app.alerts");
  const [output, setOutput] = useState("");

  async function run(type: string, escalate = false) {
    const res = await fetch(`/api/businesses/${organizationId}/notifications/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        customer: "Test Customer A",
        service: type === "urgent_request" ? "basement flooding" : "Water heater repair",
        location: "Laval",
        whenLabel: "tomorrow at 10 AM",
        escalate,
      }),
    });
    setOutput(JSON.stringify(await res.json(), null, 2));
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-navy/10 bg-white p-4">
      <h2 className="font-semibold text-navy">{t("testTitle")}</h2>
      <p className="text-sm text-navy/70">{t("testIntro")}</p>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map(([type, label]) => (
          <button key={type} type="button" onClick={() => void run(type, type === "urgent_request")} className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-semibold">
            {t(label)}
          </button>
        ))}
      </div>
      {output ? <pre className="overflow-auto rounded-md bg-navy/5 p-3 text-xs">{output}</pre> : null}
    </section>
  );
}
