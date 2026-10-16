"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AutomationConfig, AutomationRecord } from "@/product/sms-automation/types";

export function AutomationSettingsForm({
  organizationId,
  automation,
  labels,
  showSecondDelay,
}: {
  organizationId: string;
  automation: AutomationRecord;
  showSecondDelay?: boolean;
  labels: {
    save: string;
    saved: string;
    error: string;
    status: string;
    active: string;
    inactive: string;
    enable: string;
    disable: string;
    delay: string;
    secondDelay: string;
    language: string;
    languageCustomer: string;
    languageEn: string;
    languageFr: string;
    attempts: string;
    windowStart: string;
    windowEnd: string;
    weekend: string;
    duplicate: string;
    stopReply: string;
    stopHuman: string;
    stopAccepted: string;
    stopRejected: string;
    minutes: string;
  };
}) {
  const router = useRouter();
  const [config, setConfig] = useState<AutomationConfig>(automation.config);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof AutomationConfig>(key: K, value: AutomationConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(
      `/api/businesses/${organizationId}/automations/${automation.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      },
    );
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || labels.error);
      return;
    }
    setMessage(labels.saved);
    router.refresh();
  }

  async function toggle() {
    setBusy(true);
    setError(null);
    const path = automation.enabled ? "deactivate" : "activate";
    const res = await fetch(
      `/api/businesses/${organizationId}/automations/${automation.id}/${path}`,
      { method: "POST" },
    );
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || labels.error);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4 rounded-md border border-navy/10 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-navy">
          {labels.status}: {automation.enabled ? labels.active : labels.inactive}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void toggle()}
          className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white"
        >
          {automation.enabled ? labels.disable : labels.enable}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-navy/70">
          {labels.delay} ({labels.minutes})
          <input
            type="number"
            min={0}
            value={config.initialDelayMinutes}
            onChange={(event) => set("initialDelayMinutes", Number(event.target.value))}
            className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
          />
        </label>
        {showSecondDelay ? (
          <label className="text-xs text-navy/70">
            {labels.secondDelay} ({labels.minutes})
            <input
              type="number"
              min={0}
              value={config.secondDelayMinutes ?? 0}
              onChange={(event) => set("secondDelayMinutes", Number(event.target.value))}
              className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
            />
          </label>
        ) : null}
        <label className="text-xs text-navy/70">
          {labels.language}
          <select
            value={config.language}
            onChange={(event) => set("language", event.target.value as AutomationConfig["language"])}
            className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
          >
            <option value="customer">{labels.languageCustomer}</option>
            <option value="en">{labels.languageEn}</option>
            <option value="fr">{labels.languageFr}</option>
          </select>
        </label>
        <label className="text-xs text-navy/70">
          {labels.attempts}
          <input
            type="number"
            min={1}
            max={5}
            value={config.maxAttempts}
            onChange={(event) => set("maxAttempts", Number(event.target.value))}
            className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
          />
        </label>
        <label className="text-xs text-navy/70">
          {labels.windowStart}
          <input
            type="number"
            min={0}
            max={23}
            value={config.windowStartHour}
            onChange={(event) => set("windowStartHour", Number(event.target.value))}
            className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
          />
        </label>
        <label className="text-xs text-navy/70">
          {labels.windowEnd}
          <input
            type="number"
            min={1}
            max={24}
            value={config.windowEndHour}
            onChange={(event) => set("windowEndHour", Number(event.target.value))}
            className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
          />
        </label>
      </div>
      <div className="grid gap-2 text-sm text-navy">
        <Check label={labels.weekend} checked={config.weekendSending} onChange={(value) => set("weekendSending", value)} />
        <Check label={labels.duplicate} checked={config.duplicateProtection} onChange={(value) => set("duplicateProtection", value)} />
        <Check label={labels.stopReply} checked={config.stopOnCustomerReply} onChange={(value) => set("stopOnCustomerReply", value)} />
        <Check label={labels.stopHuman} checked={config.stopOnHumanContact} onChange={(value) => set("stopOnHumanContact", value)} />
        {showSecondDelay ? (
          <>
            <Check label={labels.stopAccepted} checked={config.stopOnQuoteAccepted} onChange={(value) => set("stopOnQuoteAccepted", value)} />
            <Check label={labels.stopRejected} checked={config.stopOnQuoteRejected} onChange={(value) => set("stopOnQuoteRejected", value)} />
          </>
        ) : null}
      </div>
      {error ? <p className="text-sm text-red-800">{error}</p> : null}
      {message ? <p className="text-sm text-navy">{message}</p> : null}
      <button type="submit" disabled={busy} className="w-fit rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold text-navy">
        {labels.save}
      </button>
    </form>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
