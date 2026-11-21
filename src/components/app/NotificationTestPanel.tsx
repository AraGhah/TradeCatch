"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useFailureText } from "@/components/ui/FeedbackMessage";
import { BusyLabel } from "@/components/ui/Spinner";
import { classifyFailure } from "@/lib/client/use-action";
import { useGuarded } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
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
  const tFeedback = useTranslations("feedback");
  const failureText = useFailureText();
  const [lines, setLines] = useState<string[]>([]);
  // Which test is running: only that button says "Sending…".
  const [acting, setActing] = useState<string | null>(null);
  const busy = acting !== null;

  const run = useGuarded(runHandler);
  async function runHandler(type: string, escalate = false) {
    if (busy) return;
    setActing(type);
    try {
      const res = await timedFetch(
        `/api/businesses/${organizationId}/notifications/test`,
        {
          method: "POST",
          timeoutMs: 60_000,
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
    } catch (err) {
      // Without an answer the test may still have been queued: say so rather than "failed".
      const failure = classifyFailure(err, { write: true });
      setLines([failure.outcomeUnknown ? failureText(failure) : t("testFailed")]);
    } finally {
      setActing(null);
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
            aria-busy={acting === type}
            onClick={() => void run(type, type === "urgent_request")}
            className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
          >
            <BusyLabel pending={acting === type} busyLabel={tFeedback("sending")}>
              {t(label)}
            </BusyLabel>
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
