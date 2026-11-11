"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function QuoteIngestForm({
  locale,
  wordingApproved,
}: {
  locale: "en" | "fr";
  /** Follow-ups are only sent once the owner has approved their wording. */
  wordingApproved: boolean;
}) {
  const t = useTranslations("app");
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [quoteRef, setQuoteRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !wordingApproved) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/app/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerPhoneE164: phone.trim(),
          customerName: name.trim() || undefined,
          quoteRef: quoteRef.trim() || undefined,
          locale,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          code?: string;
        } | null;
        setError(
          data?.code === "invalid_phone"
            ? t("quotes.errorPhone")
            : data?.code === "invalid_values"
              ? t("quotes.errorValues")
              : t("quotes.error"),
        );
        return;
      }
      setPhone("");
      setName("");
      setQuoteRef("");
      router.refresh();
    } catch {
      setError(t("quotes.error"));
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
      {wordingApproved ? null : (
        <p role="note" className="mt-1 text-sm text-amber-900">
          {t("quotes.approveFirst")}
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-navy/70">
          {t("quotes.phone")}
          <input
            required
            type="tel"
            inputMode="tel"
            maxLength={32}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="514-555-0123"
            className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
          />
        </label>
        <label className="text-xs text-navy/70">
          {t("quotes.name")}
          <input
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
          />
        </label>
        <label className="text-xs text-navy/70">
          {t("quotes.ref")}
          <input
            value={quoteRef}
            maxLength={80}
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
        disabled={busy || !wordingApproved}
        className="mt-3 rounded-md bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy/90 disabled:opacity-50"
      >
        {busy ? t("quotes.saving") : t("quotes.submit")}
      </button>
    </form>
  );
}
