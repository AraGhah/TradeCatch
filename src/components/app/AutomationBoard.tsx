"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BusyLabel } from "@/components/ui/Spinner";
import { Link } from "@/i18n/navigation";
import type { AutomationRecord, AutomationType } from "@/product/sms-automation/types";
import { OPERATIONAL_AUTOMATION_TYPES } from "@/product/sms-automation/types";
import { isKnownResult } from "@/product/sms-automation/status";
import { StatusHelp, StatusPill, stateOf, type StatusInputs } from "./AutomationStatus";
import {
  describeFailure,
  readStored,
  requestEnabled,
  useFailureText,
  useKeyedSingleFlight,
} from "./automation-client";

/** Where each automation's settings, and its test panel, live. Others have neither yet. */
const EDIT: Partial<Record<AutomationType, "/app/automations/missed-call" | "/app/automations/quotes">> = {
  missed_call_recovery: "/app/automations/missed-call",
  quote_followup: "/app/automations/quotes",
};

type Notice = { kind: "ok" | "error"; text: string };

const BUTTON =
  "rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-60";

export function AutomationBoard({
  organizationId,
  automations,
  status,
  schedule,
  lastAt,
}: {
  organizationId: string;
  automations: AutomationRecord[];
  /** What the status is worked out from: the queue, whether the business can text, and the clock. */
  status: StatusInputs;
  /** The "When it runs" lines, written from each automation's real settings. */
  schedule: Record<AutomationType, string[]>;
  /** Time of the last activity, already written for the business's time zone and language. */
  lastAt: Record<AutomationType, string | null>;
}) {
  const t = useTranslations("app.automations");
  const router = useRouter();
  const failureText = useFailureText();
  // What the server last confirmed. The switch changes only when the server says so.
  const [rows, setRows] = useState(automations);
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const [target, setTarget] = useState<Record<string, boolean>>({});
  const flight = useKeyedSingleFlight();

  function say(id: string, notice: Notice | null) {
    setNotices((current) => {
      const next = { ...current };
      if (notice) next[id] = notice;
      else delete next[id];
      return next;
    });
  }

  function replace(updated: AutomationRecord) {
    setRows((current) => current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)));
  }

  /** Sets the switch to `enabled`. One request per automation at a time; extra clicks are dropped. */
  async function setEnabled(row: AutomationRecord, enabled: boolean) {
    await flight.run(row.id, async () => {
      say(row.id, null);
      setTarget((current) => ({ ...current, [row.id]: enabled }));
      try {
        const { automation, canceled } = await requestEnabled(organizationId, row.id, enabled);
        replace(automation);
        say(row.id, {
          kind: "ok",
          text: enabled ? t("toggle.enabled") : t("toggle.disabled", { count: canceled }),
        });
        // The queue changes with the switch (texts canceled, or brought back): ask for it again.
        router.refresh();
      } catch (err) {
        // Show what is stored, not what was asked for: the request may or may not have landed.
        const stored = await readStored(organizationId, row.id);
        if (stored) replace(stored);
        say(row.id, { kind: "error", text: failureText(describeFailure(err)) });
      } finally {
        setTarget((current) => {
          const next = { ...current };
          delete next[row.id];
          return next;
        });
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {rows.map((row) => {
        const operational = OPERATIONAL_AUTOMATION_TYPES.includes(row.type);
        const edit = EDIT[row.type];
        const busy = flight.isPending(row.id);
        const notice = notices[row.id];
        const state = stateOf(row, status);
        const lines = schedule[row.type] ?? [];
        const lastResult = isKnownResult(row.lastExecutionStatus) ? row.lastExecutionStatus : null;
        const lastTime = lastAt[row.type];
        const headingId = `automation-${row.type}`;

        return (
          <article
            key={row.id}
            data-automation={row.type}
            aria-labelledby={headingId}
            className="flex min-w-0 flex-col gap-3 rounded-md border border-navy/10 bg-white p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 id={headingId} className="min-w-0 font-semibold text-navy">
                {t(`names.${row.type}`)}
              </h2>
              <StatusPill state={state} testId={`status-${row.type}`} />
            </div>

            <p className="text-sm text-navy/80">{t(`descriptions.${row.type}`)}</p>

            {state ? (
              <StatusHelp state={state} testId={`status-help-${row.type}`} />
            ) : (
              <p className="text-sm font-medium text-navy">{t(`soon.${row.type}`)}</p>
            )}

            {lines.length > 0 ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-navy/60">{t("card.when")}</p>
                <ul className="mt-1 flex list-none flex-col gap-1 p-0 text-sm text-navy/80">
                  {lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {operational ? (
              <dl className="m-0 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-navy/60">{t("card.sent")}</dt>
                  <dd className="m-0 font-semibold text-navy">{row.successCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-navy/60">{t("card.replies")}</dt>
                  <dd className="m-0 font-semibold text-navy">{row.responseCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-navy/60">{t("card.failed")}</dt>
                  <dd className="m-0 font-semibold text-navy">{row.failureCount}</dd>
                </div>
                <div className="min-w-0 basis-full">
                  <dt className="text-xs text-navy/60">{t("card.lastActivity")}</dt>
                  <dd className="m-0 text-navy/80">
                    {lastResult || lastTime
                      ? [lastResult ? t(`results.${lastResult}`) : null, lastTime].filter(Boolean).join(" · ")
                      : t("card.noActivity")}
                  </dd>
                </div>
              </dl>
            ) : null}

            <div className="mt-auto flex flex-wrap gap-2 pt-1">
              {operational ? (
                <button
                  type="button"
                  disabled={busy}
                  aria-busy={busy}
                  aria-describedby={headingId}
                  onClick={() => void setEnabled(row, !row.enabled)}
                  className={
                    row.enabled
                      ? BUTTON
                      : "rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  }
                >
                  <BusyLabel pending={busy} busyLabel={target[row.id] ? t("actions.enabling") : t("actions.pausing")}>
                    {row.enabled ? t("actions.pause") : t("actions.enable")}
                  </BusyLabel>
                </button>
              ) : null}
              {edit ? (
                <Link href={edit} aria-describedby={headingId} className={BUTTON}>
                  {t("actions.settings")}
                </Link>
              ) : null}
              {edit ? (
                <Link href={edit} aria-describedby={headingId} className={BUTTON}>
                  {t("actions.test")}
                </Link>
              ) : null}
              {operational ? (
                <Link href="/app/automations/history" aria-describedby={headingId} className={BUTTON}>
                  {t("actions.history")}
                </Link>
              ) : null}
            </div>
            <div aria-live="polite" className="min-h-0 text-sm">
              {notice ? (
                <p
                  role={notice.kind === "error" ? "alert" : "status"}
                  className={notice.kind === "error" ? "text-red-800" : "text-green-800"}
                >
                  {notice.text}
                </p>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
