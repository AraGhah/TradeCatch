"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { AutomationRecord, AutomationType } from "@/product/sms-automation/types";
import { OPERATIONAL_AUTOMATION_TYPES } from "@/product/sms-automation/types";
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

export function AutomationBoard({
  organizationId,
  automations,
  labels,
}: {
  organizationId: string;
  automations: AutomationRecord[];
  labels: {
    automation: string;
    status: string;
    trigger: string;
    action: string;
    active: string;
    inactive: string;
    enable: string;
    disable: string;
    edit: string;
    test: string;
    history: string;
    last: string;
    success: string;
    failures: string;
    responses: string;
    none: string;
    later: string;
    names: Record<AutomationType, string>;
    triggers: Record<AutomationType, string>;
    actions: Record<AutomationType, string>;
    error: string;
  };
}) {
  const t = useTranslations("app.automations");
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
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-md border border-navy/10 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-navy/10 text-xs uppercase tracking-wide text-navy/50">
            <tr>
              <th className="px-4 py-3">{labels.automation}</th>
              <th className="px-4 py-3">{labels.status}</th>
              <th className="px-4 py-3">{labels.trigger}</th>
              <th className="px-4 py-3">{labels.action}</th>
              <th className="px-4 py-3">{labels.last}</th>
              <th className="px-4 py-3">{labels.success}</th>
              <th className="px-4 py-3">{labels.failures}</th>
              <th className="px-4 py-3">{labels.responses}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy/10">
            {rows.map((row) => {
              const operational = OPERATIONAL_AUTOMATION_TYPES.includes(row.type);
              const edit = EDIT[row.type];
              const busy = flight.isPending(row.id);
              const notice = notices[row.id];
              return (
                <tr key={row.id} data-automation={row.type}>
                  <td className="px-4 py-3 font-semibold text-navy">
                    {labels.names[row.type]}
                    <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium">
                      {operational ? (
                        <button
                          type="button"
                          disabled={busy}
                          aria-busy={busy}
                          onClick={() => void setEnabled(row, !row.enabled)}
                          className="rounded-md border border-navy/20 px-2 py-1 text-navy hover:bg-navy/5 disabled:opacity-60"
                        >
                          {busy
                            ? target[row.id]
                              ? t("toggle.enabling")
                              : t("toggle.disabling")
                            : row.enabled
                              ? labels.disable
                              : labels.enable}
                        </button>
                      ) : (
                        <span className="text-navy/50">{labels.later}</span>
                      )}
                      {edit ? (
                        <Link href={edit} className="rounded-md border border-navy/20 px-2 py-1">
                          {labels.edit}
                        </Link>
                      ) : null}
                      {edit ? (
                        <Link href={edit} className="rounded-md border border-navy/20 px-2 py-1">
                          {labels.test}
                        </Link>
                      ) : null}
                      <Link href="/app/automations/history" className="rounded-md border border-navy/20 px-2 py-1">
                        {labels.history}
                      </Link>
                    </div>
                    <div aria-live="polite" className="mt-2 min-h-0 text-xs font-normal">
                      {notice ? (
                        <p
                          role={notice.kind === "error" ? "alert" : "status"}
                          className={notice.kind === "error" ? "text-red-800" : "text-green-800"}
                        >
                          {notice.text}
                        </p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3" data-testid={`status-${row.type}`}>
                    {row.enabled ? labels.active : labels.inactive}
                  </td>
                  <td className="px-4 py-3 text-navy/70">{labels.triggers[row.type]}</td>
                  <td className="px-4 py-3 text-navy/70">{labels.actions[row.type]}</td>
                  <td className="px-4 py-3 text-navy/70">
                    {row.lastExecutionStatus || labels.none}
                  </td>
                  <td className="px-4 py-3">{row.successCount}</td>
                  <td className="px-4 py-3">{row.failureCount}</td>
                  <td className="px-4 py-3">{row.responseCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
