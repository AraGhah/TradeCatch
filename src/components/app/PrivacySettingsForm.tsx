"use client";

import { useEffect, useState } from "react";

type Settings = {
  disclosureEnabled: boolean;
  recordingEnabled: boolean;
  retentionDays: number;
  onDenied: "continue_without_recording" | "end_call";
};

export function PrivacySettingsForm({ organizationId }: { organizationId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(`/api/businesses/${organizationId}/privacy`)
      .then((response) => response.json())
      .then((body) => {
        const parsed = body as { settings?: Settings };
        setSettings(parsed.settings ?? null);
      });
  }, [organizationId]);

  async function save() {
    if (!settings) return;
    const response = await fetch(`/api/businesses/${organizationId}/privacy`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    });
    setMessage(response.ok ? "Privacy settings saved." : "Could not save privacy settings.");
  }

  if (!settings) return <p className="text-sm text-navy/70">Loading privacy settings…</p>;

  return (
    <form className="flex max-w-xl flex-col gap-4 rounded-md bg-white p-4 ring-1 ring-navy/10" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="flex items-center gap-2 text-sm text-navy">
        <input type="checkbox" checked={settings.disclosureEnabled} onChange={(event) => setSettings({ ...settings, disclosureEnabled: event.target.checked })} />
        Tell the caller that the call may be recorded
      </label>
      <label className="flex items-center gap-2 text-sm text-navy">
        <input type="checkbox" checked={settings.recordingEnabled} onChange={(event) => setSettings({ ...settings, recordingEnabled: event.target.checked })} />
        Allow recording after consent
      </label>
      <label className="text-sm text-navy">
        Keep recordings (days)
        <input className="mt-1 block w-full rounded-md border border-navy/15 px-2 py-2" type="number" min={1} max={365} value={settings.retentionDays} onChange={(event) => setSettings({ ...settings, retentionDays: Number(event.target.value) })} />
      </label>
      <label className="text-sm text-navy">
        If the caller refuses recording
        <select className="mt-1 block w-full rounded-md border border-navy/15 px-2 py-2" value={settings.onDenied} onChange={(event) => setSettings({ ...settings, onDenied: event.target.value as Settings["onDenied"] })}>
          <option value="continue_without_recording">Continue without recording</option>
          <option value="end_call">End the call</option>
        </select>
      </label>
      <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white">Save</button>
      {message ? <p className="text-sm text-navy">{message}</p> : null}
    </form>
  );
}
