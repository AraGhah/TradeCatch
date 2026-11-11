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

export function NotificationTestPanel({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = useTranslations("app.alerts");
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function run(type: string, escalate = false) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/businesses/${organizationId}/notifications/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            customer: "Test Customer A",
            service:
              type === "urgent_request"
                ? "basement flooding"
                : "Water heater repair",
            location: "Laval",
            whenLabel: "tomorrow at 10 AM",
            escalate,
          }),
        },
      );
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        queued?: boolean;
        duplicate?: boolean;
      } | null;
      if (!res.ok || !data?.ok) {
        setLines([t("testFailed")]);
        return;
      }
      setLines([
        data.duplicate ? t("testDuplicate") : t("testQueued"),
        t("testHint"),
      ]);
    } catch {
      setLines([t("testFailed")]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-navy/10 bg-white p-4">
      <h2 className="font-semibold text-navy">{t("testTitle")}</h2>
      <p className="text-sm text-navy/70">{t("testIntro")}</p>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map(([type, label]) => (
          <button
            key={type}
            type="button"
            disabled={busy}
            onClick={() => void run(type, type === "urgent_request")}
            className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
          >
            {t(label)}
          </button>
        ))}
      </div>
      {lines.length ? (
        <ul
          role="status"
          className="list-disc space-y-1 pl-5 text-sm text-navy"
        >
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
