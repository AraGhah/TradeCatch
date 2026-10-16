"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import type { AutomationRecord, AutomationType } from "@/product/sms-automation/types";
import { OPERATIONAL_AUTOMATION_TYPES } from "@/product/sms-automation/types";

const EDIT: Partial<Record<AutomationType, "/app/automations/missed-call" | "/app/automations/quotes" | "/app/automations/templates">> = {
  missed_call_recovery: "/app/automations/missed-call",
  quote_followup: "/app/automations/quotes",
};

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
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(row: AutomationRecord) {
    setBusy(row.id);
    setError(null);
    const path = row.enabled ? "deactivate" : "activate";
    const res = await fetch(
      `/api/businesses/${organizationId}/automations/${row.id}/${path}`,
      { method: "POST" },
    );
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    setBusy(null);
    if (!res.ok) {
      setError(data?.error || labels.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="text-sm text-red-800">{error}</p> : null}
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
            {automations.map((row) => {
              const operational = OPERATIONAL_AUTOMATION_TYPES.includes(row.type);
              const edit = EDIT[row.type];
              return (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-semibold text-navy">
                    {labels.names[row.type]}
                    <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium">
                      {operational ? (
                        <button
                          type="button"
                          disabled={busy === row.id}
                          onClick={() => void toggle(row)}
                          className="rounded-md border border-navy/20 px-2 py-1 text-navy hover:bg-navy/5"
                        >
                          {row.enabled ? labels.disable : labels.enable}
                        </button>
                      ) : (
                        <span className="text-navy/50">{labels.later}</span>
                      )}
                      {edit ? (
                        <Link href={edit} className="rounded-md border border-navy/20 px-2 py-1">
                          {labels.edit}
                        </Link>
                      ) : null}
                      {operational ? (
                        <Link
                          href={edit === "/app/automations/quotes" ? "/app/automations/quotes" : "/app/automations/missed-call"}
                          className="rounded-md border border-navy/20 px-2 py-1"
                        >
                          {labels.test}
                        </Link>
                      ) : null}
                      <Link href="/app/automations/history" className="rounded-md border border-navy/20 px-2 py-1">
                        {labels.history}
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-3">
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
