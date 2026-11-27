"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BusyLabel } from "@/components/ui/Spinner";
import { Link } from "@/i18n/navigation";
import { requestJson } from "@/lib/client/request";
import { useAction } from "@/lib/client/use-action";

const inputClass =
  "rounded-md border border-navy/15 bg-white px-3 py-2.5 text-base font-normal text-navy outline-none focus-visible:ring-2 focus-visible:ring-orange";
const labelClass = "flex flex-col gap-1.5 text-sm font-medium text-navy";

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
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One request at a time; what was typed stays in the form whatever happens.
  const action = useAction();

  function field(name: keyof typeof form) {
    return {
      value: form[name],
      onChange: (e: { target: { value: string } }) =>
        setForm((prev) => ({ ...prev, [name]: e.target.value })),
    };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const outcome = await action.run(
      (signal) =>
        requestJson<{ ok?: boolean; error?: string }>("/api/auth/account-recovery", {
          method: "POST",
          body: {
            ...form,
            phone: form.phone || undefined,
            website: form.website || undefined,
            locale,
          },
          signal,
        }),
      { write: true },
    );
    if (outcome.status === "dropped" || outcome.status === "cancelled") return;
    if (outcome.status === "ok" && outcome.value?.ok) {
      setSent(true);
      return;
    }
    if (outcome.status === "failed") {
      const { failure } = outcome;
      const code = (failure.body as { error?: unknown } | undefined)?.error;
      setError(
        failure.outcomeUnknown
          ? t("unconfirmed")
          : code === "rate_limited" || failure.kind === "rate_limited"
            ? t("rateLimited")
            : code === "invalid_input"
              ? t("invalid")
              : t("errorGeneric"),
      );
      return;
    }
    setError(t("errorGeneric"));
  }

  if (sent) {
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
        disabled={action.pending}
        aria-busy={action.pending}
        className="rounded-md bg-orange px-4 py-3 text-[15px] font-semibold text-navy transition hover:bg-orange-dark disabled:opacity-60"
      >
        <BusyLabel pending={action.pending} busyLabel={t("sending")}>
          {t("submit")}
        </BusyLabel>
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
