"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

type Job = {
  id?: string;
  status?: string;
  scheduledAt?: string;
  customerPhoneE164?: string;
  payload?: { quoteThreadId?: string };
};
type TestResult = {
  error?: string;
  jobs?: Job[];
  job?: Job | null;
  canceled?: number;
  duplicate?: boolean;
  deferred?: boolean;
  scheduled?: boolean;
  reason?: string;
};

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
  const t = useTranslations("app.automations.testPanel");
  const dateLocale = useLocale() === "fr" ? "fr-CA" : "en-CA";
  const [phone, setPhone] = useState("+15145550199");
  const [name, setName] = useState("Alex Martin");
  const [threadId, setThreadId] = useState("");
  // What happened, in sentences: the raw answer is of no use to an owner.
  const [lines, setLines] = useState<string[]>([]);

  function describe(data: TestResult): string[] {
    const out: string[] = [];
    if (data.duplicate) out.push(t("resultDuplicate"));
    if (data.deferred && data.reason && t.has(`reasons.${data.reason}`))
      out.push(t(`reasons.${data.reason}` as "reasons.duplicate"));
    const jobs = [...(data.jobs ?? []), ...(data.job ? [data.job] : [])];
    for (const job of jobs) {
      const status =
        job.status && t.has(`jobStatus.${job.status}`)
          ? t(`jobStatus.${job.status}` as "jobStatus.pending")
          : (job.status ?? "");
      const at = job.scheduledAt ? new Date(job.scheduledAt) : null;
      const when =
        at && !Number.isNaN(at.getTime())
          ? new Intl.DateTimeFormat(dateLocale, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(at)
          : "";
      out.push(
        t("resultJob", {
          status,
          phone: job.customerPhoneE164 ?? "",
          when,
        }),
      );
    }
    if (typeof data.canceled === "number")
      out.push(t("resultCanceled", { count: data.canceled }));
    if (out.length === 0)
      out.push(
        data.scheduled === false ? t("resultNotScheduled") : t("resultNone"),
      );
    return out;
  }
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
    const data = (await res.json().catch(() => null)) as TestResult | null;
    setBusy(false);
    if (!res.ok || !data) {
      setLines([]);
      setError(labels.error);
      return;
    }
    const created = data.jobs?.[0]?.payload?.quoteThreadId;
    if (created) setThreadId(created);
    setLines(describe(data));
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
      {error ? <p role="alert" className="text-sm text-red-800">{error}</p> : null}
      {lines.length > 0 ? (
        <div role="status" className="rounded-md bg-[var(--color-surface,#f7f5f1)] p-3 text-sm text-navy">
          <p className="m-0 font-semibold">{labels.result}</p>
          <ul className="mt-1 list-disc pl-5">
            {lines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
