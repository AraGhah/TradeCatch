"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function BookingForm() {
  const t = useTranslations("app");
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const startsIso = startsAt
        ? new Date(startsAt).toISOString()
        : undefined;
      const endsIso = endsAt ? new Date(endsAt).toISOString() : undefined;
      if (!startsIso) {
        setError(t("bookings.error"));
        return;
      }
      const res = await fetch("/api/app/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          startsAt: startsIso,
          endsAt: endsIso,
          customerName: customerName || undefined,
          customerPhoneE164: customerPhone || undefined,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error || t("bookings.error"));
        return;
      }
      setTitle("");
      setStartsAt("");
      setEndsAt("");
      setCustomerName("");
      setCustomerPhone("");
      setNotes("");
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
      <p className="text-sm font-semibold text-navy">{t("bookings.add")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-navy/70 sm:col-span-2">
          {t("bookings.title")}
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
          />
        </label>
        <label className="text-xs text-navy/70">
          {t("bookings.startsAt")}
          <input
            required
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
          />
        </label>
        <label className="text-xs text-navy/70">
          {t("bookings.endsAt")}
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
          />
        </label>
        <label className="text-xs text-navy/70">
          {t("bookings.customerName")}
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
          />
        </label>
        <label className="text-xs text-navy/70">
          {t("bookings.customerPhone")}
          <input
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            placeholder="+15145551234"
            className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy"
          />
        </label>
        <label className="text-xs text-navy/70 sm:col-span-2">
          {t("bookings.notes")}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
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
        {busy ? t("bookings.saving") : t("bookings.submit")}
      </button>
    </form>
  );
}
