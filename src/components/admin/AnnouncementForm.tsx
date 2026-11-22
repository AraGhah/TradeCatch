"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

import { BusyLabel } from "@/components/ui/Spinner";
import { useGuarded } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
export function AnnouncementForm() {
  const t = useTranslations("admin.platform");
  const tFeedback = useTranslations("feedback");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useGuarded(submitHandler);
  async function submitHandler(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await timedFetch("/api/admin/announcements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, confirm }),
      });
      const body = (await res.json().catch(() => null)) as { queued?: number } | null;
      setResult(res.ok ? t("announceQueued", { count: body?.queued ?? 0 }) : t("error"));
    } catch {
      setResult(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3 rounded-md border border-navy/10 bg-white p-4">
      <h2 className="font-semibold text-navy">{t("announceTitle")}</h2>
      <p className="text-sm text-navy/70">{t("announceHint")}</p>
      <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={500} rows={3} className="rounded-md border border-navy/15 px-2 py-1.5 text-sm" />
      <label className="text-sm text-navy/70">
        {t("announceConfirm")}
        <input value={confirm} onChange={(event) => setConfirm(event.target.value)} className="mt-1 block rounded-md border border-navy/15 px-2 py-1.5" />
      </label>
      <button type="submit" disabled={busy} aria-busy={busy} className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
        <BusyLabel pending={busy} busyLabel={tFeedback("sending")}>{t("announceSend")}</BusyLabel>
      </button>
      {result ? <p className="text-sm text-navy">{result}</p> : null}
    </form>
  );
}
