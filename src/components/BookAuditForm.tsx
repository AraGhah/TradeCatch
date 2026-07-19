"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type Step = "form" | "calendar" | "confirmed";

export function BookAuditForm() {
  const t = useTranslations("bookAudit");
  const [step, setStep] = useState<Step>("form");
  const [consent, setConsent] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!consent) return;

    // Honeypot: real visitors never see or fill this field, bots often do.
    const honeypot = new FormData(e.currentTarget).get("company_website");
    if (honeypot) return;

    setStep("calendar");
  }

  if (step === "confirmed") {
    return (
      <div className="rounded-xl border border-navy/10 bg-white p-8 text-center shadow-sm">
        <h2 className="text-2xl font-bold text-navy">
          {t("confirmation.headline")}
        </h2>
        <p className="mt-4 text-text/80">{t("confirmation.body")}</p>
      </div>
    );
  }

  if (step === "calendar") {
    return (
      <div className="rounded-xl border border-navy/10 bg-white p-8 shadow-sm">
        <h2 className="text-xl font-bold text-navy">{t("headline")}</h2>
        <div className="mt-6 flex h-80 flex-col items-center justify-center rounded-lg border border-dashed border-navy/20 bg-bg text-center text-sm text-text/60">
          <p>Calendar booking widget placeholder</p>
          <p className="mt-1 text-xs">(Cal.com / scheduling embed goes here)</p>
        </div>
        <button
          type="button"
          onClick={() => setStep("confirmed")}
          className="mt-6 w-full rounded-md bg-orange px-6 py-3 text-base font-semibold text-white hover:bg-orange/90"
        >
          {t("submit")}
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-10 rounded-xl border border-navy/10 bg-white p-8 shadow-sm"
    >
      <input
        type="text"
        name="company_website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden"
      />

      <div>
        <h2 className="text-lg font-semibold text-navy">{t("sections.contact")}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label={t("fields.firstName")} name="firstName" required />
          <Field label={t("fields.lastName")} name="lastName" required />
          <Field label={t("fields.company")} name="company" required />
          <Field label={t("fields.email")} name="email" type="email" required />
          <Field label={t("fields.phone")} name="phone" type="tel" required />
          <Field label={t("fields.city")} name="city" required />
          <Field label={t("fields.trade")} name="trade" required />
          <SelectField
            label={t("fields.preferredLanguage")}
            name="preferredLanguage"
            options={["English", "Français"]}
          />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-navy">{t("sections.qualification")}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label={t("fields.employees")} name="employees" />
          <Field label={t("fields.callsPerMonth")} name="callsPerMonth" />
          <Field label={t("fields.missedCallsPerWeek")} name="missedCallsPerWeek" />
          <Field label={t("fields.quotesPerMonth")} name="quotesPerMonth" />
          <Field label={t("fields.averageJobValue")} name="averageJobValue" />
          <Field label={t("fields.currentCrm")} name="currentCrm" />
          <SelectField
            label={t("fields.afterHours")}
            name="afterHours"
            options={["Yes", "No"]}
          />
          <Field label={t("fields.handlesMissedCalls")} name="handlesMissedCalls" />
          <Field label={t("fields.followsUpQuotes")} name="followsUpQuotes" />
          <Field
            label={t("fields.mainProblem")}
            name="mainProblem"
            textarea
            className="sm:col-span-2"
          />
        </div>
      </div>

      <label className="flex items-start gap-3 text-sm text-text/70">
        <input
          type="checkbox"
          required
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-navy/30"
        />
        {t("consent")}
      </label>

      <button
        type="submit"
        className="w-full rounded-md bg-orange px-6 py-3 text-base font-semibold text-white hover:bg-orange/90"
      >
        {t("submit")}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  textarea,
  className = "",
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  textarea?: boolean;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm font-medium text-text ${className}`}>
      {label}
      {textarea ? (
        <textarea
          name={name}
          required={required}
          rows={3}
          className="rounded-md border border-navy/20 px-3 py-2 text-sm font-normal focus:border-blue focus:outline-none"
        />
      ) : (
        <input
          type={type}
          name={name}
          required={required}
          className="rounded-md border border-navy/20 px-3 py-2 text-sm font-normal focus:border-blue focus:outline-none"
        />
      )}
    </label>
  );
}

function SelectField({
  label,
  name,
  options,
}: {
  label: string;
  name: string;
  options: string[];
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
      {label}
      <select
        name={name}
        className="rounded-md border border-navy/20 px-3 py-2 text-sm font-normal focus:border-blue focus:outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
