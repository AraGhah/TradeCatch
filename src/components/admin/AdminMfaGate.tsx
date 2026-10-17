"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

export function AdminMfaGate({ organizationId }: { organizationId: string }) {
  const t = useTranslations("admin.platform");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const res = await fetch(`/api/businesses/${organizationId}/security/mfa`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.ok) window.location.reload();
    else setMessage(t("error"));
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex max-w-md flex-col gap-3 rounded-md border border-navy/10 bg-white p-4">
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">{t("mfaTitle")}</h1>
      <p className="text-sm text-navy/70">{t("mfaBody")}</p>
      <label className="text-sm text-navy/70">
        {t("mfaCode")}
        <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} className="mt-1 block rounded-md border border-navy/15 px-2 py-1.5" />
      </label>
      <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">{t("mfaSubmit")}</button>
      {message ? <p className="text-sm text-navy">{message}</p> : null}
    </form>
  );
}
