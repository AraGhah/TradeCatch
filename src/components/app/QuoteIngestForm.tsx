"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function QuoteIngestForm({ locale }: { locale: "en" | "fr" }) {
  const t = useTranslations("app");
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [quoteRef, setQuoteRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/app/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerPhoneE164: phone,
          customerName: name || undefined,
          quoteRef: quoteRef || undefined,
          locale,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error || t("quotes.error"));
        return;
      }
      setPhone("");
      setName("");
      setQuoteRef("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="rounded-md border border-navy/10 bg-white px-4 py-4"
    >
      <p className="text-sm font-semibold text-navy">{t("quotes.add")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-navy/70">
          {t("quotes.phone")}
          <input
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+15145551234"
            className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
          />
        </label>
        <label className="text-xs text-navy/70">
          {t("quotes.name")}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
          />
        </label>
        <label className="text-xs text-navy/70">
          {t("quotes.ref")}
          <input
            value={quoteRef}
            onChange={(e) => setQuoteRef(e.target.value)}
            className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
          />
        </label>
      </div>
      {error ? (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="mt-3 rounded-md bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy/90 disabled:opacity-50"
      >
        {busy ? t("quotes.saving") : t("quotes.submit")}
      </button>
    </form>
  );
}
