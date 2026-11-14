"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const inputClass =
  "rounded-md border border-navy/15 bg-white px-3 py-2.5 text-base font-normal text-navy outline-none focus-visible:ring-2 focus-visible:ring-orange";
const labelClass = "flex flex-col gap-1.5 text-sm font-medium text-navy";

type Status = "idle" | "loading" | "sent" | "error";

/** For a customer who can no longer open the email on their account. */
export function AccountRecoveryForm() {
  const t = useTranslations("accountRecovery");
  const locale = useLocale() === "fr" ? "fr" : "en";
  const [form, setForm] = useState({
    accountEmail: "",
    contactEmail: "",
    contactName: "",
    businessName: "",
    phone: "",
    details: "",
    website: "",
  });
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  function field(name: keyof typeof form) {
    return {
      value: form[name],
      onChange: (e: { target: { value: string } }) =>
        setForm((prev) => ({ ...prev, [name]: e.target.value })),
    };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/auth/account-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          phone: form.phone || undefined,
          website: form.website || undefined,
          locale,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setStatus("sent");
        return;
      }
      setStatus("error");
      setError(
        data.error === "rate_limited"
          ? t("rateLimited")
          : data.error === "invalid_input"
            ? t("invalid")
            : t("errorGeneric"),
      );
    } catch {
      setStatus("error");
      setError(t("errorGeneric"));
    }
  }

  if (status === "sent") {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <p className="rounded-md border border-navy/10 bg-white px-4 py-3 text-sm text-navy" role="status">
          {t("sent")}
        </p>
        <p className="text-sm text-navy/70">
          <Link href="/login" className="font-semibold underline">
            {t("back")}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-md flex-col gap-4">
      <label className={labelClass}>
        {t("accountEmail")}
        <input type="email" required maxLength={200} autoComplete="off" className={inputClass} {...field("accountEmail")} />
      </label>
      <label className={labelClass}>
        {t("contactEmail")}
        <input type="email" required maxLength={200} autoComplete="email" className={inputClass} {...field("contactEmail")} />
      </label>
      <label className={labelClass}>
        {t("contactName")}
        <input type="text" required minLength={2} maxLength={120} autoComplete="name" className={inputClass} {...field("contactName")} />
      </label>
      <label className={labelClass}>
        {t("businessName")}
        <input type="text" required minLength={2} maxLength={160} autoComplete="organization" className={inputClass} {...field("businessName")} />
      </label>
      <label className={labelClass}>
        {t("phone")}
        <input type="tel" maxLength={40} autoComplete="tel" className={inputClass} {...field("phone")} />
      </label>
      <label className={labelClass}>
        {t("details")}
        <textarea required minLength={10} maxLength={2000} rows={4} className={inputClass} {...field("details")} />
      </label>
      {/* Hidden from people; bots that fill every field are ignored. */}
      <label className="hidden" aria-hidden="true">
        Website
        <input type="text" tabIndex={-1} autoComplete="off" {...field("website")} />
      </label>
      <p className="text-sm text-navy/70">{t("howItWorks")}</p>
      <button
        type="submit"
        disabled={status === "loading"}
        className="rounded-md bg-orange px-4 py-3 text-[15px] font-semibold text-navy transition hover:bg-orange-dark disabled:opacity-60"
      >
        {status === "loading" ? t("sending") : t("submit")}
      </button>
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-sm text-navy/70">
        <Link href="/forgot-password" className="font-semibold underline">
          {t("stillHaveEmail")}
        </Link>
      </p>
    </form>
  );
}
