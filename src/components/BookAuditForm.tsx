"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { trackEvent } from "@/lib/analytics";

type Step = "form" | "calendar" | "confirmed";

const STEP_ORDER: Step[] = ["form", "calendar", "confirmed"];

function StepIndicator({ step, labels }: { step: Step; labels: string[] }) {
  const activeIndex = STEP_ORDER.indexOf(step);

  return (
    <ol className="mb-8 flex items-center gap-2">
      {labels.map((label, i) => {
        const isDone = i < activeIndex;
        const isActive = i === activeIndex;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors duration-300 ${
                isDone
                  ? "bg-green text-white"
                  : isActive
                    ? "bg-orange text-navy"
                    : "bg-navy/10 text-navy/40"
              }`}
            >
              {isDone ? "✓" : i + 1}
            </span>
            <span
              className={`hidden text-xs font-medium sm:block ${
                isActive || isDone ? "text-navy" : "text-navy/40"
              }`}
            >
              {label}
            </span>
            {i < labels.length - 1 ? (
              <span className="mx-1 h-px flex-1 bg-navy/10" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function BookAuditForm() {
  const t = useTranslations("bookAudit");
  const [step, setStep] = useState<Step>("form");
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState(false);

  const stepLabels = [
    t("sections.contact"),
    t("submit"),
    t("confirmation.headline"),
  ];

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!consent) {
      setConsentError(true);
      return;
    }

    // Honeypot: real visitors never see or fill this field, bots often do.
    const honeypot = new FormData(e.currentTarget).get("company_website");
    if (honeypot) return;

    trackEvent("audit_form_submitted");
    setStep("calendar");
  }

  function handleConfirm() {
    trackEvent("audit_booking_confirmed");
    setStep("confirmed");
  }

  return (
    <div className="rounded-2xl border border-navy/10 bg-white p-6 shadow-card sm:p-8">
      <StepIndicator step={step} labels={stepLabels} />

      <AnimatePresence mode="wait">
        {step === "form" ? (
          <motion.form
            key="form"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.25 }}
            onSubmit={handleSubmit}
            className="space-y-10"
            noValidate
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

            <div>
              <label className="flex items-start gap-3 text-sm text-text/70">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => {
                    setConsent(e.target.checked);
                    if (e.target.checked) setConsentError(false);
                  }}
                  className="mt-1 h-4 w-4 rounded border-navy/30 accent-orange"
                />
                {t("consent")}
              </label>
              {consentError ? (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-2 text-sm font-medium text-red-600"
                  role="alert"
                >
                  {t("consentRequired")}
                </motion.p>
              ) : null}
            </div>

            <motion.button
              type="submit"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              className="w-full rounded-lg bg-orange px-6 py-3.5 text-base font-semibold text-navy shadow-cta transition-colors hover:bg-orange-dark"
            >
              {t("submit")}
            </motion.button>
          </motion.form>
        ) : null}

        {step === "calendar" ? (
          <motion.div
            key="calendar"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.25 }}
          >
            <h2 className="text-xl font-bold text-navy">{t("headline")}</h2>
            <div className="mt-6 flex h-80 flex-col items-center justify-center rounded-lg border border-dashed border-navy/20 bg-bg text-center text-sm text-text/70">
              <p>Calendar booking widget placeholder</p>
              <p className="mt-1 text-xs">(Cal.com / scheduling embed goes here)</p>
            </div>
            <motion.button
              type="button"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleConfirm}
              className="mt-6 w-full rounded-lg bg-orange px-6 py-3.5 text-base font-semibold text-navy shadow-cta transition-colors hover:bg-orange-dark"
            >
              {t("submit")}
            </motion.button>
          </motion.div>
        ) : null}

        {step === "confirmed" ? (
          <motion.div
            key="confirmed"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="py-6 text-center"
          >
            <motion.svg
              viewBox="0 0 52 52"
              className="mx-auto h-16 w-16 text-green"
              initial="hidden"
              animate="visible"
            >
              <motion.circle
                cx="26"
                cy="26"
                r="24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                variants={{
                  hidden: { pathLength: 0, opacity: 0 },
                  visible: {
                    pathLength: 1,
                    opacity: 1,
                    transition: { duration: 0.5 },
                  },
                }}
              />
              <motion.path
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 27l7 7 15-15"
                variants={{
                  hidden: { pathLength: 0 },
                  visible: {
                    pathLength: 1,
                    transition: { duration: 0.4, delay: 0.4 },
                  },
                }}
              />
            </motion.svg>
            <h2 className="mt-6 text-2xl font-bold text-navy">
              {t("confirmation.headline")}
            </h2>
            <p className="mx-auto mt-4 max-w-md text-text/70">
              {t("confirmation.body")}
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
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
  const fieldClass =
    "rounded-lg border border-navy/15 px-3.5 py-2.5 text-sm font-normal text-text transition-colors duration-150 outline-none focus:border-blue focus:ring-2 focus:ring-blue/15 hover:border-navy/25";

  return (
    <label className={`flex flex-col gap-1.5 text-sm font-medium text-navy ${className}`}>
      <span>
        {label}
        {required ? <span className="ml-0.5 text-orange-dark">*</span> : null}
      </span>
      {textarea ? (
        <textarea name={name} required={required} rows={3} className={fieldClass} />
      ) : (
        <input type={type} name={name} required={required} className={fieldClass} />
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
    <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
      {label}
      <select
        name={name}
        className="rounded-lg border border-navy/15 px-3.5 py-2.5 text-sm font-normal text-text transition-colors duration-150 outline-none focus:border-blue focus:ring-2 focus:ring-blue/15 hover:border-navy/25"
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
