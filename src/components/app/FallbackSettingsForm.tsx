"use client";

import { useEffect, useState } from "react";

type Settings = {
  aiUnavailable: "transfer" | "voicemail";
  calendarUnavailable: "collect_request";
  databaseUnavailable: "do_not_claim_saved";
  transferFailed: "voicemail" | "backup";
};

export function FallbackSettingsForm({ organizationId }: { organizationId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(`/api/businesses/${organizationId}/fallback-settings`)
      .then((response) => response.json())
      .then((body) => {
        const parsed = body as { settings?: Settings };
        setSettings(parsed.settings ?? null);
      });
  }, [organizationId]);

  async function save() {
    if (!settings) return;
    const response = await fetch(`/api/businesses/${organizationId}/fallback-settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    });
    setMessage(response.ok ? "Fallback settings saved." : "Could not save fallback settings.");
  }

  if (!settings) return <p className="text-sm text-navy/70">Loading fallback settings…</p>;

  return (
    <form className="flex max-w-xl flex-col gap-4 rounded-md bg-white p-4 ring-1 ring-navy/10" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="text-sm text-navy">
        If the AI cannot connect
        <select className="mt-1 block w-full rounded-md border border-navy/15 px-2 py-2" value={settings.aiUnavailable} onChange={(event) => setSettings({ ...settings, aiUnavailable: event.target.value as Settings["aiUnavailable"] })}>
          <option value="transfer">Transfer to the contractor number</option>
          <option value="voicemail">Take a voicemail</option>
        </select>
      </label>
      <p className="text-sm text-navy/70">If the calendar is unavailable, TradeCatch collects the preferred time and does not confirm an appointment.</p>
      <p className="text-sm text-navy/70">If the database is unavailable, TradeCatch does not tell the caller that their information was saved.</p>
      <label className="text-sm text-navy">
        If a transfer fails
        <select className="mt-1 block w-full rounded-md border border-navy/15 px-2 py-2" value={settings.transferFailed} onChange={(event) => setSettings({ ...settings, transferFailed: event.target.value as Settings["transferFailed"] })}>
          <option value="voicemail">Voicemail</option>
          <option value="backup">Backup number</option>
        </select>
      </label>
      <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white">Save</button>
      {message ? <p className="text-sm text-navy">{message}</p> : null}
    </form>
  );
}
