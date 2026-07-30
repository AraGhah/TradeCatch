"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { trackEvent } from "@/lib/analytics";
import {
  TurnstileWidget,
  type TurnstileWidgetHandle,
} from "@/components/TurnstileWidget";
import { CalendarBookingCta } from "@/components/CalendarBookingCta";
import {
  BOOK_AUDIT_STEPS,
  OPTIONAL_STEPS,
  STEP_FIELDS,
  bookAuditSchema,
  type BookAuditStep,
} from "@/lib/validation/book-audit";

const DRAFT_STORAGE_KEY = "tradecatch-book-audit-draft";
const OPT_KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Question steps only — review is a separate screen after these. */
const QUESTION_STEPS = BOOK_AUDIT_STEPS.filter(
  (step) => step !== "review",
) as Exclude<BookAuditStep, "review">[];

const TOTAL_QUESTIONS = QUESTION_STEPS.length;

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
  afterHours: string;
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

function emptyAnswers(): Answers {
  return {
    firstName: "",
    lastName: "",
    company: "",
    trade: "",
    email: "",
    phone: "",
    city: "",
    preferredLanguage: "",
    employees: "",
    callsPerMonth: "",
    missedCallsPerWeek: "",
    afterHours: "",
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

type Phase = "wizard" | "confirmed";
type SubmitStatus = "idle" | "submitting" | "error";

type StepKind =
  | "name"
  | "text"
  | "choice"
  | "consent"
  | "review";

function stepKind(step: BookAuditStep): StepKind {
  switch (step) {
    case "name":
      return "name";
    case "trade":
      return "choice";
    case "consent":
      return "consent";
    case "review":
      return "review";
    default:
      return "text";
  }
}

/** Primary answer field for soft “answered?” checks (not name/consent/review). */
function primaryField(step: BookAuditStep): keyof Answers | null {
  const fields = STEP_FIELDS[step];
  if (fields.length === 0) return null;
  return fields[0] as keyof Answers;
}

export function BookAuditForm() {
  const t = useTranslations("bookAudit");
  const locale = useLocale() as "en" | "fr";

  const [phase, setPhase] = useState<Phase>("wizard");
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>(emptyAnswers);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [consentTouched, setConsentTouched] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);
  const hydrated = useRef(false);

  const step = BOOK_AUDIT_STEPS[stepIndex];
  const onReview = step === "review";
  const kind = stepKind(step);
  const questionNumber = onReview ? TOTAL_QUESTIONS : stepIndex + 1;
  const minutesLeft = Math.max(
    1,
    Math.round(((TOTAL_QUESTIONS - stepIndex) * 9) / 60),
  );
  const progressPct = Math.round(
    ((onReview ? TOTAL_QUESTIONS : stepIndex) / TOTAL_QUESTIONS) * 100,
  );
  const isOptional = OPTIONAL_STEPS.includes(step);

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

  /** Soft check — drives Continue ember vs greyed pill. */
  function isStepSatisfied(current: BookAuditStep): boolean {
    if (OPTIONAL_STEPS.includes(current)) return true;
    if (current === "review") return answers.serviceConsent && Boolean(turnstileToken);
    if (current === "name") return Boolean(answers.firstName.trim());
    if (current === "consent") return answers.serviceConsent;
    const field = primaryField(current);
    if (!field) return true;
    const value = answers[field];
    return typeof value === "string" ? Boolean(value.trim()) : Boolean(value);
  }

  /**
   * Hard check on Continue. Soft rules above, plus zod format for email/phone
   * (and other STEP_FIELDS picks when the soft check already passed).
   */
  function validateStep(current: BookAuditStep): boolean {
    if (OPTIONAL_STEPS.includes(current)) {
      setErrors({});
      return true;
    }
    if (current === "review") return true;

    if (current === "name") {
      // Soft Continue lights on firstName alone; hard check still asks for
      // lastName so the API payload matches bookAuditSchema.
      const shape = Object.fromEntries(
        STEP_FIELDS.name.map((f) => [f, true]),
      );
      const result = bookAuditSchema
        .pick(shape as Parameters<typeof bookAuditSchema.pick>[0])
        .safeParse(answers);
      if (result.success) {
        setErrors({});
        return true;
      }
      const nextErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        nextErrors[String(issue.path[0])] = t("wizard.errors.required");
      }
      setErrors(nextErrors);
      return false;
    }

    if (current === "consent") {
      if (!answers.serviceConsent) {
        setConsentTouched(true);
        setErrors({ serviceConsent: t("consentRequired") });
        return false;
      }
      setErrors({});
      return true;
    }

    // email / phone — zod format via STEP_FIELDS pick
    if (current === "email" || current === "phone") {
      const fields = STEP_FIELDS[current];
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
      return false;
    }

    if (!isStepSatisfied(current)) {
      const field = primaryField(current);
      if (field) setErrors({ [field]: t("wizard.errors.required") });
      return false;
    }

    setErrors({});
    return true;
  }

  function scrollTop() {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }

  function goToStep(index: number) {
    setErrors({});
    setStepIndex(index);
    scrollTop();
  }

  function goBack() {
    if (stepIndex === 0) return;
    goToStep(stepIndex - 1);
  }

  function goNext() {
    if (stepIndex >= BOOK_AUDIT_STEPS.length - 1) return;
    trackEvent("audit_step_completed", { step: stepIndex + 1 });
    goToStep(stepIndex + 1);
  }

  function skipOptional() {
    if (!isOptional) return;
    goNext();
  }

  async function submitAudit() {
    if (!turnstileToken || !answers.serviceConsent) return;

    function failSubmission() {
      setSubmitStatus("error");
      setTurnstileToken("");
      turnstileRef.current?.reset();
    }

    // Full-payload guard before POST — API re-validates anyway.
    const payload = {
      ...answers,
      preferredLanguage:
        answers.preferredLanguage === "fr" || answers.preferredLanguage === "en"
          ? answers.preferredLanguage
          : locale,
      turnstileToken,
      consentWording: t("consent"),
      consentSource: "book-audit",
    };
    const parsed = bookAuditSchema.safeParse(payload);
    if (!parsed.success) {
      failSubmission();
      return;
    }

    setSubmitStatus("submitting");
    try {
      const response = await fetch("/api/book-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...parsed.data,
          idempotencyKey: idempotencyKey.current,
        }),
      });

      if (!response.ok) {
        failSubmission();
        return;
      }

      trackEvent("audit_form_submitted", {
        trade: parsed.data.trade,
        preferred_language: parsed.data.preferredLanguage,
      });
      trackEvent("generate_lead", {
        currency: "CAD",
        value: 0,
        lead_source: "book_audit",
      });
      try {
        window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        // Nothing to clean up if storage was never available.
      }
      setSubmitStatus("idle");
      setPhase("confirmed");
      scrollTop();
    } catch {
      failSubmission();
    }
  }

  function handleContinue(e?: FormEvent) {
    e?.preventDefault();
    if (onReview) {
      void submitAudit();
      return;
    }
    if (!validateStep(step)) return;
    goNext();
  }

  function handleChoice(field: keyof Answers, label: string) {
    update(field, label as Answers[typeof field]);
  }

  function handleTextKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!isStepSatisfied(step)) return;
    handleContinue();
  }

  function resetForm() {
    idempotencyKey.current = crypto.randomUUID();
    setAnswers(emptyAnswers());
    setErrors({});
    setConsentTouched(false);
    setTurnstileToken("");
    setSubmitStatus("idle");
    setStepIndex(0);
    setPhase("wizard");
    try {
      window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // ignore
    }
    scrollTop();
  }

  const satisfied = isStepSatisfied(step);
  const showEnterHint =
    (kind === "text" || kind === "name") && satisfied && !onReview;
  const nextLabel = onReview
    ? submitStatus === "submitting"
      ? t("wizard.submitting")
      : t("wizard.submit")
    : kind === "consent"
      ? t("wizard.reviewAnswers")
      : t("wizard.continue");

  if (phase === "confirmed") {
    return (
      <div className="flex flex-1 items-center justify-center px-[clamp(20px,4vw,40px)] py-[clamp(56px,8vw,110px)]">
        <div className="w-full max-w-[640px] animate-tc-in text-center">
          <span
            aria-hidden
            className="animate-tc-pulse inline-flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(47,158,104,0.14)] text-[26px] text-signal-text"
          >
            ✓
          </span>
          <h1 className="mt-7 font-heading text-[clamp(30px,4.2vw,48px)] leading-[1.05] font-extrabold tracking-[-0.04em] text-navy">
            {t("confirmation.headline")}
          </h1>
          <p className="mx-auto mt-5 max-w-[34em] text-[17px] leading-[1.65] text-muted">
            {t("confirmation.body")}
          </p>
          <CalendarBookingCta
            label={t("confirmation.calendarCta")}
            hint={t("confirmation.calendarHint")}
          />
          <div className="mt-[34px] flex flex-wrap justify-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 rounded-[11px] bg-navy px-[26px] py-4 text-[16px] font-semibold text-white transition-[background,transform] duration-200 hover:translate-y-[-2px] hover:bg-navy-light"
            >
              {t("confirmation.backToSite")}
            </Link>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-[11px] border-[1.5px] border-[rgba(12,20,30,0.14)] px-[22px] py-4 text-[15.5px] font-semibold text-navy transition-colors duration-200 hover:border-navy"
            >
              {t("confirmation.submitAnother")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <ProgressBar
        counterText={
          onReview
            ? t("wizard.reviewYourAnswers")
            : t("wizard.questionOf", {
                current: questionNumber,
                total: TOTAL_QUESTIONS,
              })
        }
        timeLeft={
          onReview ? t("wizard.almostDone") : t("wizard.minLeft", { minutes: minutesLeft })
        }
        progressPct={progressPct}
        currentStep={onReview ? TOTAL_QUESTIONS : stepIndex}
        totalSteps={TOTAL_QUESTIONS}
      />

      <div className="flex flex-1 justify-center px-[clamp(20px,4vw,40px)] pt-[clamp(40px,7vw,88px)] pb-[clamp(56px,7vw,96px)]">
        <form
          onSubmit={handleContinue}
          noValidate
          className="w-full max-w-(--container-wizard)"
        >
          <input
            type="text"
            name="company_website"
            value={answers.companyWebsite}
            onChange={(e) => update("companyWebsite", e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute top-auto left-[-9999px] h-px w-px overflow-hidden"
          />

          {/*
            Remount on step change so animate-tc-in replays. Prefer CSS over
            framer here: MotionConfig handles reduced motion for framer, but
            a keyed CSS animation avoids any AnimatePresence exit/enter timing
            that could fight sticky progress layout during step swaps.
          */}
          <div key={step} className="animate-tc-in">
            {!onReview ? (
              <>
                <p className="m-0 flex items-center gap-2.5 font-mono text-[12px] font-semibold tracking-[0.12em] text-ember-text">
                  {String(questionNumber).padStart(2, "0")}
                  <span
                    aria-hidden
                    className="block h-px w-[22px] bg-[rgba(169,79,18,0.4)]"
                  />
                </p>
                <h1
                  id="audit-step-title"
                  className="mt-[18px] max-w-[16em] font-heading text-[clamp(28px,4vw,46px)] leading-[1.06] font-extrabold tracking-[-0.04em] text-navy"
                >
                  {t(`wizard.questions.${step}.title`)}
                </h1>
                {t.has(`wizard.questions.${step}.help`) ? (
                  <p className="mt-4 max-w-[38em] text-[16.5px] leading-[1.62] text-muted">
                    {t(`wizard.questions.${step}.help`)}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <p className="m-0 font-mono text-[12px] font-semibold tracking-[0.12em] text-ember-text">
                  {t("wizard.reviewLabel")}
                </p>
                <h1 className="mt-[18px] max-w-[15em] font-heading text-[clamp(28px,4vw,46px)] leading-[1.06] font-extrabold tracking-[-0.04em] text-navy">
                  {t("wizard.reviewHeadline")}
                </h1>
              </>
            )}

            <div className="mt-[clamp(28px,4vw,44px)]">
              {Object.keys(errors).length > 0 ? (
                <div
                  role="alert"
                  id="audit-error-summary"
                  className="mb-5 rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                >
                  <p className="m-0 font-semibold">{t("wizard.errorSummary")}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {Object.entries(errors).map(([field, message]) => (
                      <li key={field}>{message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <StepBody
                step={step}
                kind={kind}
                answers={answers}
                errors={errors}
                consentTouched={consentTouched}
                update={update}
                onTextKeyDown={handleTextKeyDown}
                onChoice={handleChoice}
                onEditStep={goToStep}
                t={t}
              />
            </div>

            {onReview ? (
              <div className="mt-6">
                <TurnstileWidget
                  ref={turnstileRef}
                  onToken={setTurnstileToken}
                />
                {submitStatus === "error" ? (
                  <p role="alert" className="mt-3 text-sm font-medium text-red-600">
                    {t("wizard.genericError")}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-[clamp(32px,4vw,48px)] flex flex-wrap items-center gap-3.5">
            {satisfied ? (
              <button
                type="submit"
                disabled={
                  onReview &&
                  (submitStatus === "submitting" || !turnstileToken)
                }
                aria-busy={onReview && submitStatus === "submitting"}
                className="inline-flex items-center gap-3 rounded-[12px] bg-orange px-7 py-[17px] text-[16.5px] font-bold tracking-[-0.015em] text-navy shadow-cta transition-[transform,background] duration-200 hover:translate-y-[-2px] hover:bg-orange-dark disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                {nextLabel}
                {!onReview ? (
                  <span aria-hidden className="font-mono text-[15px]">
                    →
                  </span>
                ) : null}
              </button>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed items-center gap-3 rounded-[12px] bg-[rgba(12,20,30,0.08)] px-7 py-[17px] text-[16.5px] font-bold tracking-[-0.015em] text-muted"
              >
                {nextLabel}
              </button>
            )}

            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={goBack}
                className="rounded-[12px] px-5 py-[17px] text-[15.5px] font-semibold text-muted transition-colors duration-200 hover:text-navy"
              >
                {t("wizard.back")}
              </button>
            ) : null}

            {isOptional ? (
              <button
                type="button"
                onClick={skipOptional}
                className="border-b border-[rgba(12,20,30,0.18)] px-1 py-[17px] text-[15px] text-muted transition-colors duration-200 hover:text-navy"
              >
                {t("wizard.skip")}
              </button>
            ) : null}

            {showEnterHint ? (
              <span className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
                {t("wizard.enterHint")}
              </span>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}

function ProgressBar({
  counterText,
  timeLeft,
  progressPct,
  currentStep,
  totalSteps,
}: {
  counterText: string;
  timeLeft: string;
  progressPct: number;
  currentStep: number;
  totalSteps: number;
}) {
  const summaryId = "audit-progress-summary";
  return (
    <div className="sticky top-(--header-h) z-30 border-b border-[rgba(12,20,30,0.08)] bg-[rgba(244,241,236,0.92)] backdrop-blur-[12px]">
      <div className="mx-auto w-full max-w-(--container-wizard) px-[clamp(20px,4vw,40px)] pt-3.5 pb-[13px]">
        <div className="flex items-center justify-between gap-4">
          <p
            id={summaryId}
            className="m-0 font-mono text-[11px] tracking-[0.12em] text-muted uppercase"
          >
            {counterText}
          </p>
          <p className="m-0 font-mono text-[11px] tracking-[0.12em] text-muted uppercase">
            {timeLeft}
          </p>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={totalSteps}
          aria-valuenow={currentStep}
          aria-valuetext={counterText}
          aria-describedby={summaryId}
          className="mt-[11px] h-[3px] overflow-hidden rounded-[3px] bg-[rgba(12,20,30,0.1)]"
        >
          <span
            className="block h-full rounded-[3px] bg-orange transition-[width] duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

type Translator = ReturnType<typeof useTranslations<"bookAudit">>;

function StepBody({
  step,
  kind,
  answers,
  errors,
  consentTouched,
  update,
  onTextKeyDown,
  onChoice,
  onEditStep,
  t,
}: {
  step: BookAuditStep;
  kind: StepKind;
  answers: Answers;
  errors: Record<string, string>;
  consentTouched: boolean;
  update: <K extends keyof Answers>(key: K, value: Answers[K]) => void;
  onTextKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onChoice: (field: keyof Answers, label: string) => void;
  onEditStep: (index: number) => void;
  t: Translator;
}) {
  if (kind === "name") {
    return (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-[clamp(20px,3vw,36px)]">
        <UnderlineField
          name="firstName"
          autoComplete="given-name"
          label={t("fields.firstName")}
          value={answers.firstName}
          placeholder={t("wizard.questions.name.firstPlaceholder")}
          error={errors.firstName}
          onChange={(v) => update("firstName", v)}
          onKeyDown={onTextKeyDown}
          size="name"
          autoFocus
        />
        <UnderlineField
          name="lastName"
          autoComplete="family-name"
          label={t("fields.lastName")}
          value={answers.lastName}
          placeholder={t("wizard.questions.name.lastPlaceholder")}
          error={errors.lastName}
          onChange={(v) => update("lastName", v)}
          onKeyDown={onTextKeyDown}
          size="name"
        />
      </div>
    );
  }

  if (kind === "text") {
    const field = primaryField(step)!;
    const inputType =
      step === "email" ? "email" : step === "phone" ? "tel" : "text";
    const autoComplete =
      step === "email"
        ? "email"
        : step === "phone"
          ? "tel"
          : step === "company"
            ? "organization"
            : step === "city"
              ? "address-level2"
              : "on";
    return (
      <div>
        <UnderlineField
          name={String(field)}
          autoComplete={autoComplete}
          value={String(answers[field] ?? "")}
          placeholder={
            t.has(`wizard.questions.${step}.placeholder`)
              ? t(`wizard.questions.${step}.placeholder`)
              : undefined
          }
          error={errors[field]}
          onChange={(v) => update(field, v as Answers[typeof field])}
          onKeyDown={onTextKeyDown}
          size="text"
          type={inputType}
          autoFocus
        />
      </div>
    );
  }

  if (kind === "choice") {
    const optionsKey = t(`wizard.questions.${step}.optionsKey`);
    const options = t.raw(`options.${optionsKey}`) as string[];
    const field = primaryField(step)!;
    const current = String(answers[field] ?? "");

    return (
      <ChoiceGrid
        options={options.map((label) => ({
          label,
          selected: current === label,
          onPick: () => onChoice(field, label),
        }))}
      />
    );
  }

  if (kind === "consent") {
    const consentErrorId = "audit-field-serviceConsent-error";
    return (
      <div className="flex flex-col gap-3.5">
        <label className="flex cursor-pointer items-start gap-3.5 rounded-[14px] border-[1.5px] border-[rgba(12,20,30,0.14)] bg-white p-5 text-[16px] leading-[1.6] text-text">
          <input
            type="checkbox"
            name="serviceConsent"
            checked={answers.serviceConsent}
            onChange={(e) => update("serviceConsent", e.target.checked)}
            aria-invalid={Boolean(consentTouched && errors.serviceConsent)}
            aria-describedby={
              consentTouched && errors.serviceConsent
                ? consentErrorId
                : undefined
            }
            className="mt-1 h-[18px] w-[18px] shrink-0 accent-orange"
          />
          <span>{t("consent")}</span>
        </label>
        {consentTouched && errors.serviceConsent ? (
          <p
            id={consentErrorId}
            role="alert"
            className="text-sm font-medium text-red-600"
          >
            {t("consentRequired")}
          </p>
        ) : null}
        <label className="flex cursor-pointer items-start gap-3.5 rounded-[14px] border-[1.5px] border-[rgba(12,20,30,0.14)] bg-white/50 p-5 text-[16px] leading-[1.6] text-muted">
          <input
            type="checkbox"
            name="marketingConsent"
            checked={answers.marketingConsent}
            onChange={(e) => update("marketingConsent", e.target.checked)}
            className="mt-1 h-[18px] w-[18px] shrink-0 accent-orange"
          />
          <span>{t("marketingConsent")}</span>
        </label>
      </div>
    );
  }

  // Review
  return (
    <div className="border-t border-[rgba(12,20,30,0.12)]">
      {QUESTION_STEPS.map((s, n) => (
        <ReviewRow
          key={s}
          label={t(`wizard.questions.${s}.label`)}
          value={formatReviewValue(s, answers, t)}
          onEdit={() => onEditStep(n)}
          editLabel={t("wizard.edit")}
        />
      ))}
    </div>
  );
}

function formatReviewValue(
  step: Exclude<BookAuditStep, "review">,
  answers: Answers,
  t: Translator,
): string {
  const empty = t("wizard.emptyValue");
  switch (step) {
    case "name": {
      const name = [answers.firstName, answers.lastName].filter(Boolean).join(" ");
      return name || empty;
    }
    case "consent":
      return answers.serviceConsent ? t("wizard.agreed") : t("wizard.notYet");
    default: {
      const field = primaryField(step);
      if (!field) return empty;
      const value = answers[field];
      if (typeof value === "string") return value.trim() || empty;
      return empty;
    }
  }
}

function ChoiceGrid({
  options,
}: {
  options: { label: string; selected: boolean; onPick: () => void }[];
}) {
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const index = OPT_KEYS.indexOf(event.key.toUpperCase());
      const current = optionsRef.current;
      if (index < 0 || index >= current.length) return;
      event.preventDefault();
      current[index]?.onPick();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(232px,1fr))] gap-2.5">
      {options.map((option, n) => (
        <button
          key={option.label}
          type="button"
          onClick={option.onPick}
          aria-pressed={option.selected}
          className={
            option.selected
              ? "flex w-full items-center justify-between gap-3.5 rounded-[13px] border-[1.5px] border-navy bg-navy px-5 py-[17px] text-left text-[16.5px] font-semibold tracking-[-0.015em] text-white"
              : "flex w-full items-center justify-between gap-3.5 rounded-[13px] border-[1.5px] border-[rgba(12,20,30,0.14)] bg-white px-5 py-[17px] text-left text-[16.5px] font-medium tracking-[-0.015em] text-text transition-[border-color,transform,box-shadow] duration-200 hover:translate-y-[-2px] hover:border-navy hover:shadow-[0_12px_24px_-16px_rgba(12,20,30,0.5)]"
          }
        >
          {option.label}
          {option.selected ? (
            <span aria-hidden className="text-[15px] text-orange">
              ✓
            </span>
          ) : (
            <span className="font-mono text-[11px] text-muted">
              {OPT_KEYS[n] ?? ""}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function UnderlineField({
  label,
  value,
  onChange,
  onKeyDown,
  placeholder,
  error,
  size,
  type = "text",
  autoFocus,
  name,
  autoComplete,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  error?: string;
  size: "name" | "text";
  type?: string;
  autoFocus?: boolean;
  name?: string;
  autoComplete?: string;
}) {
  const sizeClass =
    size === "name"
      ? "text-[clamp(22px,2.4vw,28px)] tracking-[-0.03em]"
      : "text-[clamp(24px,3vw,34px)] tracking-[-0.032em]";
  const errorId = name ? `audit-field-${name}-error` : undefined;

  return (
    <label className="flex flex-col gap-2.5">
      {label ? (
        <span className="font-mono text-[11px] tracking-[0.12em] text-muted uppercase">
          {label}
        </span>
      ) : null}
      <input
        type={type}
        name={name}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-labelledby={label ? undefined : "audit-step-title"}
        aria-invalid={Boolean(error)}
        aria-describedby={error && errorId ? errorId : undefined}
        className={`w-full border-0 border-b-2 border-[rgba(12,20,30,0.18)] bg-transparent py-3 font-heading font-bold text-navy outline-none placeholder:text-[rgba(12,20,30,0.28)] focus:border-orange ${sizeClass}`}
      />
      {error ? (
        <span
          id={errorId}
          role="alert"
          className="text-xs font-medium text-red-600"
        >
          {error}
        </span>
      ) : null}
    </label>
  );
}

function ReviewRow({
  label,
  value,
  onEdit,
  editLabel,
}: {
  label: string;
  value: string;
  onEdit: () => void;
  editLabel: string;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] items-baseline gap-2 gap-x-5 border-b border-[rgba(12,20,30,0.1)] py-[15px]">
      <p className="m-0 font-mono text-[11px] tracking-[0.1em] text-muted uppercase">
        {label}
      </p>
      <div className="flex items-baseline justify-between gap-4">
        <p className="m-0 text-[16.5px] leading-[1.5] text-text">{value}</p>
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 border-b border-[rgba(169,79,18,0.35)] text-[13.5px] font-semibold text-ember-text transition-colors duration-200 hover:text-navy"
        >
          {editLabel}
        </button>
      </div>
    </div>
  );
}
