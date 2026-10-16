"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AutomationTestPanel({
  organizationId,
  missedCallId,
  quoteId,
  labels,
}: {
  organizationId: string;
  missedCallId?: string;
  quoteId?: string;
  labels: {
    title: string;
    intro: string;
    missed: string;
    run: string;
    reply: string;
    quote: string;
    accept: string;
    result: string;
    error: string;
    phone: string;
    name: string;
  };
}) {
  const router = useRouter();
  const [phone, setPhone] = useState("+15145550199");
  const [name, setName] = useState("Alex Martin");
  const [threadId, setThreadId] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(
    automationId: string | undefined,
    action: string,
    extra?: Record<string, string>,
  ) {
    if (!automationId) return;
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/businesses/${organizationId}/automations/${automationId}/test`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          phoneE164: phone,
          customerName: name,
          threadId: threadId || undefined,
          ...extra,
        }),
      },
    );
    const data = (await res.json().catch(() => null)) as {
      error?: string;
      jobs?: { payload?: { quoteThreadId?: string } }[];
      job?: { payload?: { quoteThreadId?: string } } | null;
    } | null;
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || labels.error);
      return;
    }
    const created = data?.jobs?.[0]?.payload?.quoteThreadId;
    if (created) setThreadId(created);
    setOutput(JSON.stringify(data, null, 2));
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-navy/10 bg-white p-4">
      <h2 className="font-semibold text-navy">{labels.title}</h2>
      <p className="text-sm text-navy/70">{labels.intro}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-navy/70">
          {labels.phone}
          <input value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy" />
        </label>
        <label className="text-xs text-navy/70">
          {labels.name}
          <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !missedCallId} onClick={() => void run(missedCallId, "simulate_missed_call")} className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
          {labels.missed}
        </button>
        <button type="button" disabled={busy || !missedCallId} onClick={() => void run(missedCallId, "run_next")} className="rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold text-navy">
          {labels.run}
        </button>
        <button type="button" disabled={busy || !missedCallId} onClick={() => void run(missedCallId, "simulate_reply", { body: "I need a plumber tomorrow." })} className="rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold text-navy">
          {labels.reply}
        </button>
        <button type="button" disabled={busy || !quoteId} onClick={() => void run(quoteId, "simulate_quote")} className="rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold text-navy">
          {labels.quote}
        </button>
        <button type="button" disabled={busy || !quoteId || !threadId} onClick={() => void run(quoteId, "accept_quote")} className="rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold text-navy">
          {labels.accept}
        </button>
      </div>
      {error ? <p className="text-sm text-red-800">{error}</p> : null}
      {output ? (
        <pre className="max-h-80 overflow-auto rounded-md bg-[var(--color-surface,#f7f5f1)] p-3 text-xs text-navy">
          {labels.result}
          {"\n"}
          {output}
        </pre>
      ) : null}
    </section>
  );
}
