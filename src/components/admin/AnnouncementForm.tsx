"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

export function AnnouncementForm() {
  const t = useTranslations("admin.platform");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState("");
  const [result, setResult] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const res = await fetch("/api/admin/announcements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, confirm }),
    });
    const body = (await res.json().catch(() => null)) as { queued?: number } | null;
    setResult(res.ok ? t("announceQueued", { count: body?.queued ?? 0 }) : t("error"));
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
      <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">{t("announceSend")}</button>
      {result ? <p className="text-sm text-navy">{result}</p> : null}
    </form>
  );
}
