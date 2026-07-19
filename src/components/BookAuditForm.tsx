"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { trackEvent } from "@/lib/analytics";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import {
  BOOK_AUDIT_STEPS,
  STEP_FIELDS,
  bookAuditSchema,
  type BookAuditStep,
} from "@/lib/validation/book-audit";

const DRAFT_STORAGE_KEY = "tradecatch-book-audit-draft";
const FORM_STEPS = BOOK_AUDIT_STEPS.filter(
  (step) => step !== "calendar"
) as Exclude<BookAuditStep, "calendar">[];

type Answers = {
  firstName: string;
  lastName: string;
  company: string;
  trade: string;
  email: string;
  phone: string;
  city: string;
  preferredLanguage: "en" | "fr" | "";
  employees: string;
  callsPerMonth: string;
  missedCallsPerWeek: string;
  afterHours: "yes" | "no" | "";
  quotesPerMonth: string;
  averageJobValue: string;
  currentCrm: string;
  handlesMissedCalls: string;
  followsUpQuotes: string;
  mainProblem: string;
  serviceConsent: boolean;
  marketingConsent: boolean;
  companyWebsite: string;
};

function emptyAnswers(defaultLanguage: "en" | "fr"): Answers {
  return {
    firstName: "",
    lastName: "",
    company: "",
    trade: "",
    email: "",
    phone: "",
    city: "",
    preferredLanguage: defaultLanguage,
    employees: "",
    callsPerMonth: "",
    missedCallsPerWeek: "",
    afterHours: "no",
    quotesPerMonth: "",
    averageJobValue: "",
    currentCrm: "",
    handlesMissedCalls: "",
    followsUpQuotes: "",
    mainProblem: "",
    serviceConsent: false,
    marketingConsent: false,
    companyWebsite: "",
  };
}

type Phase = "wizard" | "calendar" | "confirmed";
type SubmitStatus = "idle" | "submitting" | "error";

export function BookAuditForm() {
  const t = useTranslations("bookAudit");
  const locale = useLocale() as "en" | "fr";
  const shouldReduceMotion = useReducedMotion();

  const [phase, setPhase] = useState<Phase>("wizard");
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>(() => emptyAnswers(locale));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [consentTouched, setConsentTouched] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const hydrated = useRef(false);

  const step = FORM_STEPS[stepIndex];
  const totalSteps = FORM_STEPS.length;

  // Restore an in-progress draft within this browser tab only (sessionStorage,
  // not localStorage) so back/forward preserves answers but nothing survives
  // after the tab closes or the form is successfully submitted.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    try {
      const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
      // sessionStorage only exists client-side, so restoring a draft can't
      // happen during the initial (server-matching) render — this one-time
      // hydration read is the legitimate exception to "no setState in effects".
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setAnswers((prev) => ({ ...prev, ...JSON.parse(raw) }));
    } catch {
      // Corrupt or inaccessible sessionStorage — start from a blank draft.
    }
  }, []);

  useEffect(() => {
    if (phase !== "wizard") return;
    try {
      window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(answers));
    } catch {
      // Storage may be unavailable (private browsing quota) — draft just won't persist.
    }
  }, [answers, phase]);

  function update<K extends keyof Answers>(key: K, value: Answers[K]) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function validateStep(current: BookAuditStep): boolean {
    const fields = STEP_FIELDS[current];
    if (fields.length === 0) return true;

    // zod's .pick() types its mask as an exact subset of the schema's own
    // shape rather than a plain Record<string, true> — cast here since
    // `fields` is already typed as (keyof BookAuditPayload)[] upstream.
    const shape = Object.fromEntries(fields.map((f) => [f, true]));
    const result = bookAuditSchema
      .pick(shape as Parameters<typeof bookAuditSchema.pick>[0])
      .safeParse(answers);
    if (result.success) {
      setErrors({});
      return true;
    }

    const nextErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const field = String(issue.path[0]);
      if (field === "email") nextErrors[field] = t("wizard.errors.email");
      else if (field === "phone") nextErrors[field] = t("wizard.errors.phone");
      else nextErrors[field] = t("wizard.errors.required");
    }
    setErrors(nextErrors);
    if (current === "consent") setConsentTouched(true);
    return false;
  }

  function goBack() {
    if (stepIndex === 0) return;
    setErrors({});
    setStepIndex((i) => i - 1);
  }

  async function handleStepSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validateStep(step)) return;

    trackEvent("audit_step_completed", { step: stepIndex + 1 });

    if (step !== "review") {
      setStepIndex((i) => i + 1);
      return;
    }

    if (!turnstileToken) return;

    setSubmitStatus("submitting");
    try {
      const response = await fetch("/api/book-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...answers,
          turnstileToken,
          idempotencyKey: idempotencyKey.current,
        }),
      });

      if (!response.ok) {
        setSubmitStatus("error");
        return;
      }

      trackEvent("audit_form_submitted");
      try {
        window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        // Nothing to clean up if storage was never available.
      }
      setSubmitStatus("idle");
      setPhase("calendar");
    } catch {
      setSubmitStatus("error");
    }
  }

  function handleConfirm() {
    trackEvent("audit_booking_confirmed");
    setPhase("confirmed");
  }

  const transition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.25 };
  // exit sets pointerEvents: "none" so the outgoing step's fields can't be
  // typed into or clicked during its ~250ms fade-out — without this, a fast
  // typist could briefly land keystrokes in fields that are about to unmount.
  const slideProps = shouldReduceMotion
    ? {}
    : {
        initial: { opacity: 0, x: 16 },
        exit: { opacity: 0, x: -16, pointerEvents: "none" as const },
      };

  return (
    <div className="rounded-2xl border border-navy/10 bg-white p-6 shadow-card sm:p-8">
      {phase === "wizard" ? (
        <>
          <ProgressBar current={stepIndex + 1} total={totalSteps} label={t(`wizard.steps.${step}`)} stepOfLabel={t("wizard.stepOf", { current: stepIndex + 1, total: totalSteps })} />

          <form onSubmit={handleStepSubmit} noValidate>
            <input
              type="text"
              name="company_website"
              value={answers.companyWebsite}
              onChange={(e) => update("companyWebsite", e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden"
            />

            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                {...slideProps}
                animate={{ opacity: 1, x: 0 }}
                transition={transition}
                className="min-h-[220px]"
              >
                <StepFields
                  step={step}
                  answers={answers}
                  errors={errors}
                  consentTouched={consentTouched}
                  update={update}
                  t={t}
                />

                {step === "review" ? (
                  <div className="mt-6">
                    <TurnstileWidget onToken={setTurnstileToken} />
                    {submitStatus === "error" ? (
                      <p role="alert" className="mt-3 text-sm font-medium text-red-600">
                        {t("wizard.genericError")}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </motion.div>
            </AnimatePresence>

            <div className="mt-8 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={goBack}
                disabled={stepIndex === 0}
                className="rounded-lg px-4 py-2.5 text-sm font-semibold text-navy/70 transition-colors hover:text-navy disabled:pointer-events-none disabled:opacity-0"
              >
                {t("wizard.back")}
              </button>

              <motion.button
                type="submit"
                whileHover={shouldReduceMotion ? undefined : { scale: 1.01 }}
                whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                disabled={
                  step === "review" &&
                  (submitStatus === "submitting" || !turnstileToken)
                }
                className="rounded-lg bg-orange px-6 py-3 text-base font-semibold text-navy shadow-cta transition-colors hover:bg-orange-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {step === "review"
                  ? submitStatus === "submitting"
                    ? t("wizard.submitting")
                    : t("wizard.submit")
                  : t("wizard.continue")}
              </motion.button>
            </div>
          </form>
        </>
      ) : null}

      <AnimatePresence mode="wait">
        {phase === "calendar" ? (
          <motion.div
            key="calendar"
            initial={shouldReduceMotion ? undefined : { opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={transition}
          >
            <h2 className="text-xl font-bold text-navy">{t("headline")}</h2>
            <div className="mt-6 flex h-80 flex-col items-center justify-center rounded-lg border border-dashed border-navy/20 bg-bg text-center text-sm text-text/70">
              <p>Calendar booking widget placeholder</p>
              <p className="mt-1 text-xs">(Cal.com / scheduling embed goes here)</p>
            </div>
            <motion.button
              type="button"
              whileHover={shouldReduceMotion ? undefined : { scale: 1.01 }}
              whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
              onClick={handleConfirm}
              className="mt-6 w-full rounded-lg bg-orange px-6 py-3.5 text-base font-semibold text-navy shadow-cta transition-colors hover:bg-orange-dark"
            >
              {t("submit")}
            </motion.button>
          </motion.div>
        ) : null}

        {phase === "confirmed" ? (
          <motion.div
            key="confirmed"
            initial={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.3 }}
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
                    transition: { duration: shouldReduceMotion ? 0 : 0.5 },
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
                    transition: {
                      duration: shouldReduceMotion ? 0 : 0.4,
                      delay: shouldReduceMotion ? 0 : 0.4,
                    },
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

function ProgressBar({
  current,
  total,
  label,
  stepOfLabel,
}: {
  current: number;
  total: number;
  label: string;
  stepOfLabel: string;
}) {
  const percent = (current / total) * 100;
  return (
    <div className="mb-8">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-navy">{label}</span>
        <span className="text-xs font-medium text-navy/50">{stepOfLabel}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-navy/10">
        <motion.div
          className="h-full rounded-full bg-orange"
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

type StepFieldsProps = {
  step: BookAuditStep;
  answers: Answers;
  errors: Record<string, string>;
  consentTouched: boolean;
  update: <K extends keyof Answers>(key: K, value: Answers[K]) => void;
  t: ReturnType<typeof useTranslations<"bookAudit">>;
};

function StepFields({ step, answers, errors, consentTouched, update, t }: StepFieldsProps) {
  const grid = "grid gap-4 sm:grid-cols-2";

  switch (step) {
    case "name":
      return (
        <div className={grid}>
          <TextField label={t("fields.firstName")} value={answers.firstName} error={errors.firstName} onChange={(v) => update("firstName", v)} autoFocus />
          <TextField label={t("fields.lastName")} value={answers.lastName} error={errors.lastName} onChange={(v) => update("lastName", v)} />
        </div>
      );
    case "company":
      return (
        <div className={grid}>
          <TextField label={t("fields.company")} value={answers.company} error={errors.company} onChange={(v) => update("company", v)} autoFocus />
          <TextField label={t("fields.trade")} value={answers.trade} error={errors.trade} onChange={(v) => update("trade", v)} />
        </div>
      );
    case "contact":
      return (
        <div className={grid}>
          <TextField label={t("fields.email")} type="email" value={answers.email} error={errors.email} onChange={(v) => update("email", v)} autoFocus />
          <TextField label={t("fields.phone")} type="tel" value={answers.phone} error={errors.phone} onChange={(v) => update("phone", v)} />
        </div>
      );
    case "location":
      return (
        <div className={grid}>
          <TextField label={t("fields.city")} value={answers.city} error={errors.city} onChange={(v) => update("city", v)} autoFocus />
          <SelectField
            label={t("fields.preferredLanguage")}
            value={answers.preferredLanguage}
            onChange={(v) => update("preferredLanguage", v as Answers["preferredLanguage"])}
            options={[
              { value: "en", label: t("options.language.en") },
              { value: "fr", label: t("options.language.fr") },
            ]}
          />
        </div>
      );
    case "volume":
      return (
        <div className={grid}>
          <TextField label={t("fields.employees")} value={answers.employees} onChange={(v) => update("employees", v)} autoFocus inputMode="numeric" />
          <TextField label={t("fields.callsPerMonth")} value={answers.callsPerMonth} onChange={(v) => update("callsPerMonth", v)} inputMode="numeric" />
        </div>
      );
    case "afterHours":
      return (
        <div className={grid}>
          <TextField label={t("fields.missedCallsPerWeek")} value={answers.missedCallsPerWeek} onChange={(v) => update("missedCallsPerWeek", v)} autoFocus inputMode="numeric" />
          <SelectField
            label={t("fields.afterHours")}
            value={answers.afterHours}
            onChange={(v) => update("afterHours", v as Answers["afterHours"])}
            options={[
              { value: "yes", label: t("options.yesNo.yes") },
              { value: "no", label: t("options.yesNo.no") },
            ]}
          />
        </div>
      );
    case "quotes":
      return (
        <div className={grid}>
          <TextField label={t("fields.quotesPerMonth")} value={answers.quotesPerMonth} onChange={(v) => update("quotesPerMonth", v)} autoFocus inputMode="numeric" />
          <TextField label={t("fields.averageJobValue")} value={answers.averageJobValue} onChange={(v) => update("averageJobValue", v)} inputMode="numeric" />
        </div>
      );
    case "tools":
      return (
        <div className={grid}>
          <TextField label={t("fields.currentCrm")} value={answers.currentCrm} onChange={(v) => update("currentCrm", v)} autoFocus />
          <TextField label={t("fields.handlesMissedCalls")} value={answers.handlesMissedCalls} onChange={(v) => update("handlesMissedCalls", v)} />
        </div>
      );
    case "followUp":
      return (
        <div className={grid}>
          <TextField label={t("fields.followsUpQuotes")} value={answers.followsUpQuotes} onChange={(v) => update("followsUpQuotes", v)} autoFocus />
          <TextField label={t("fields.mainProblem")} value={answers.mainProblem} onChange={(v) => update("mainProblem", v)} textarea className="sm:col-span-2" />
        </div>
      );
    case "consent":
      return (
        <div className="space-y-4">
          <label className="flex items-start gap-3 text-sm text-text/70">
            <input
              type="checkbox"
              checked={answers.serviceConsent}
              onChange={(e) => update("serviceConsent", e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-navy/30 accent-orange"
            />
            {t("consent")}
          </label>
          {consentTouched && errors.serviceConsent ? (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-sm font-medium text-red-600" role="alert">
              {t("consentRequired")}
            </motion.p>
          ) : null}
          <label className="flex items-start gap-3 text-sm text-text/70">
            <input
              type="checkbox"
              checked={answers.marketingConsent}
              onChange={(e) => update("marketingConsent", e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-navy/30 accent-orange"
            />
            {t("marketingConsent")}
          </label>
        </div>
      );
    case "review":
      return (
        <div>
          <p className="text-sm text-text/70">{t("wizard.reviewNote")}</p>
          <dl className="mt-4 divide-y divide-navy/10 rounded-lg border border-navy/10">
            {(
              [
                ["firstName", "lastName"],
                ["company", "trade"],
                ["email", "phone"],
                ["city"],
              ] as (keyof Answers)[][]
            ).map((keys, i) => (
              <div key={i} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <dt className="text-navy/60">
                  {keys.map((k) => t(`fields.${k as string}`)).join(" / ")}
                </dt>
                <dd className="font-medium text-navy">
                  {keys.map((k) => String(answers[k]) || "—").join(" · ")}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      );
    case "calendar":
      return null;
    default:
      return null;
  }
}

function TextField({
  label,
  value,
  onChange,
  error,
  type = "text",
  textarea,
  className = "",
  autoFocus,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: string;
  textarea?: boolean;
  className?: string;
  autoFocus?: boolean;
  inputMode?: "text" | "numeric" | "tel" | "email";
}) {
  const fieldClass = `rounded-lg border px-3.5 py-2.5 text-sm font-normal text-text transition-colors duration-150 outline-none focus:ring-2 hover:border-navy/25 ${
    error
      ? "border-red-400 focus:border-red-500 focus:ring-red-100"
      : "border-navy/15 focus:border-blue focus:ring-blue/15"
  }`;

  return (
    <label className={`flex flex-col gap-1.5 text-sm font-medium text-navy ${className}`}>
      <span>{label}</span>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className={fieldClass}
          aria-invalid={Boolean(error)}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={fieldClass}
          autoFocus={autoFocus}
          inputMode={inputMode}
          aria-invalid={Boolean(error)}
        />
      )}
      {error ? (
        <span role="alert" className="text-xs font-medium text-red-600">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-navy/15 px-3.5 py-2.5 text-sm font-normal text-text transition-colors duration-150 outline-none focus:border-blue focus:ring-2 focus:ring-blue/15 hover:border-navy/25"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
