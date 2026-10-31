"use client";

import { useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { trackEvent } from "@/lib/analytics";
import { randomUUID } from "@/lib/id";
import {
  TurnstileWidget,
  type TurnstileWidgetHandle,
} from "@/components/TurnstileWidget";
import { referralSubmissionSchema } from "@/lib/validation/referral-submission";

type Values = {
  referrerName: string;
  referrerEmail: string;
  referralCode: string;
  contactName: string;
  businessName: string;
  contactEmail: string;
  contactPhone: string;
  note: string;
  permissionConfirmed: boolean;
  companyWebsite: string;
};

type Status = "idle" | "submitting" | "sent";
type FieldErrors = Partial<Record<keyof Values | "turnstile", string>>;

const EMPTY: Values = {
  referrerName: "",
  referrerEmail: "",
  referralCode: "",
  contactName: "",
  businessName: "",
  contactEmail: "",
  contactPhone: "",
  note: "",
  permissionConfirmed: false,
  companyWebsite: "",
};

// Field order = focus order when validation fails.
const FIELD_ORDER: (keyof Values | "turnstile")[] = [
  "referrerName",
  "referrerEmail",
  "referralCode",
  "contactName",
  "businessName",
  "contactEmail",
  "contactPhone",
  "note",
  "permissionConfirmed",
  "turnstile",
];

const INPUT =
  "w-full rounded-[10px] border border-[rgb(var(--ink-rgb)/0.22)] bg-surface px-3.5 py-3 text-[16px] text-text outline-none transition-colors placeholder:text-muted/70 focus-visible:border-orange focus-visible:ring-2 focus-visible:ring-orange/40 aria-[invalid=true]:border-red-600 dark:aria-[invalid=true]:border-red-400";
const ERROR = "text-[13px] font-medium text-red-700 dark:text-red-400";

function fieldId(name: string) {
  return `referral-field-${name}`;
}

/** Public "refer a contractor" form. Sends to /api/referrals/submit. */
export function ReferralForm() {
  const t = useTranslations("referrals.form");
  const locale = useLocale() === "fr" ? "fr" : "en";

  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>("idle");
  const [submitError, setSubmitError] = useState<"generic" | "network" | null>(
    null,
  );
  const [turnstileToken, setTurnstileToken] = useState("");
  const idempotencyKey = useRef(randomUUID());
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function validate(): FieldErrors {
    const found: FieldErrors = {};
    // Zod skips object-level rules once another field has failed, so report
    // this one up front; otherwise it would only appear after the first fixes.
    if (!values.contactEmail.trim() && !values.contactPhone.trim()) {
      found.contactPhone = t("errors.contactRequired");
    }
    const result = referralSubmissionSchema.safeParse({
      ...values,
      language: locale,
      // The real token is checked separately below so its error is its own.
      turnstileToken: "pending",
    });
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = String(issue.path[0]) as keyof Values;
        if (found[field]) continue;
        if (issue.message === "contact_required") {
          continue; // already reported above
        } else if (field === "referrerEmail" || field === "contactEmail") {
          found[field] = values[field].trim()
            ? t("errors.email")
            : t("errors.required");
        } else if (field === "contactPhone") {
          found[field] = t("errors.phone");
        } else if (field === "referralCode") {
          found[field] = t("errors.code");
        } else if (field === "permissionConfirmed") {
          found[field] = t("errors.permission");
        } else {
          found[field] = t("errors.required");
        }
      }
    }
    if (!turnstileToken) found.turnstile = t("errors.verification");
    return found;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (status === "submitting") return;

    const found = validate();
    setErrors(found);
    const first = FIELD_ORDER.find((name) => found[name]);
    if (first) {
      document.getElementById(fieldId(first))?.focus();
      return;
    }

    setStatus("submitting");
    setSubmitError(null);
    try {
      const response = await fetch("/api/referrals/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          language: locale,
          turnstileToken,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        ok?: boolean;
      } | null;
      if (!response.ok || result?.ok !== true) {
        setSubmitError("generic");
        setStatus("idle");
        setTurnstileToken("");
        turnstileRef.current?.reset();
        return;
      }
      trackEvent("referral_form_submitted", { language: locale });
      setStatus("sent");
    } catch {
      setSubmitError("network");
      setStatus("idle");
      setTurnstileToken("");
      turnstileRef.current?.reset();
    }
  }

  function reset() {
    idempotencyKey.current = randomUUID();
    setValues(EMPTY);
    setErrors({});
    setSubmitError(null);
    setTurnstileToken("");
    setStatus("idle");
  }

  if (status === "sent") {
    return (
      <div
        role="status"
        className="rounded-[18px] border border-[rgb(var(--ink-rgb)/0.12)] bg-surface p-[clamp(24px,4vw,40px)]"
      >
        <span
          aria-hidden
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(47,158,104,0.14)] text-[22px] text-signal-text"
        >
          ✓
        </span>
        <h3 className="mt-5 font-heading text-[clamp(22px,2.6vw,28px)] font-extrabold tracking-[-0.03em] text-heading">
          {t("success.title")}
        </h3>
        <p className="mt-2 max-w-[38em] text-[16px] leading-[1.6] text-muted">
          {t("success.body")}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-[10px] border border-[rgb(var(--ink-rgb)/0.22)] px-5 py-3 text-[15px] font-semibold text-heading transition-colors hover:border-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
        >
          {t("success.another")}
        </button>
      </div>
    );
  }

  const field = (
    name: keyof Values,
    label: string,
    options: {
      type?: string;
      autoComplete?: string;
      optional?: boolean;
      hint?: string;
      inputMode?: "text" | "email" | "tel";
    } = {},
  ) => {
    const error = errors[name];
    const hintId = options.hint ? `${fieldId(name)}-hint` : undefined;
    const errorId = error ? `${fieldId(name)}-error` : undefined;
    return (
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={fieldId(name)}
          className="text-[14px] font-semibold text-heading"
        >
          {label}
          {options.optional ? (
            <span className="ml-1.5 font-normal text-muted">
              {t("optional")}
            </span>
          ) : null}
        </label>
        <input
          id={fieldId(name)}
          name={name}
          type={options.type ?? "text"}
          inputMode={options.inputMode}
          autoComplete={options.autoComplete ?? "off"}
          value={values[name] as string}
          onChange={(e) => set(name, e.target.value as Values[typeof name])}
          aria-invalid={Boolean(error)}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          className={INPUT}
        />
        {options.hint ? (
          <p id={hintId} className="text-[13px] leading-snug text-muted">
            {options.hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} role="alert" className={ERROR}>
            {error}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-8">
      {/* Honeypot: hidden from people and assistive tech. */}
      <input
        type="text"
        name="company_website"
        value={values.companyWebsite}
        onChange={(e) => set("companyWebsite", e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute top-auto left-[-9999px] h-px w-px overflow-hidden"
      />

      <div className="grid gap-8 md:grid-cols-2 md:gap-10">
        <fieldset className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
          <legend className="mb-5 p-0 font-heading text-[19px] font-bold tracking-[-0.02em] text-heading">
            {t("you.legend")}
          </legend>
          {field("referrerName", t("you.name"), { autoComplete: "name" })}
          {field("referrerEmail", t("you.email"), {
            type: "email",
            inputMode: "email",
            autoComplete: "email",
          })}
          {field("referralCode", t("you.code"), {
            optional: true,
            hint: t("you.codeHint"),
          })}
        </fieldset>

        <fieldset className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
          <legend className="mb-5 p-0 font-heading text-[19px] font-bold tracking-[-0.02em] text-heading">
            {t("them.legend")}
          </legend>
          {field("contactName", t("them.name"))}
          {field("businessName", t("them.business"), {
            autoComplete: "organization",
          })}
          {field("contactPhone", t("them.phone"), {
            type: "tel",
            inputMode: "tel",
            optional: true,
            hint: t("them.contactHint"),
          })}
          {field("contactEmail", t("them.email"), {
            type: "email",
            inputMode: "email",
            optional: true,
          })}
        </fieldset>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={fieldId("note")}
          className="text-[14px] font-semibold text-heading"
        >
          {t("note")}
          <span className="ml-1.5 font-normal text-muted">{t("optional")}</span>
        </label>
        <textarea
          id={fieldId("note")}
          name="note"
          rows={3}
          maxLength={500}
          value={values.note}
          onChange={(e) => set("note", e.target.value)}
          className={`${INPUT} resize-y`}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex cursor-pointer items-start gap-3.5 rounded-[12px] border border-[rgb(var(--ink-rgb)/0.18)] bg-surface p-4 text-[15px] leading-[1.55] text-text">
          <input
            id={fieldId("permissionConfirmed")}
            type="checkbox"
            name="permissionConfirmed"
            checked={values.permissionConfirmed}
            onChange={(e) => set("permissionConfirmed", e.target.checked)}
            aria-invalid={Boolean(errors.permissionConfirmed)}
            aria-describedby={
              errors.permissionConfirmed
                ? `${fieldId("permissionConfirmed")}-error`
                : undefined
            }
            className="mt-1 h-[18px] w-[18px] shrink-0 accent-orange"
          />
          <span>{t("permission")}</span>
        </label>
        {errors.permissionConfirmed ? (
          <p
            id={`${fieldId("permissionConfirmed")}-error`}
            role="alert"
            className={ERROR}
          >
            {errors.permissionConfirmed}
          </p>
        ) : null}
      </div>

      <div>
        <div id={fieldId("turnstile")} tabIndex={-1} className="outline-none">
          <TurnstileWidget
            ref={turnstileRef}
            action="referral"
            onToken={setTurnstileToken}
          />
        </div>
        {errors.turnstile ? (
          <p role="alert" className={`mt-2 ${ERROR}`}>
            {errors.turnstile}
          </p>
        ) : null}
      </div>

      {submitError ? (
        <p role="alert" className={ERROR}>
          {submitError === "network"
            ? t("errors.network")
            : t("errors.generic")}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={status === "submitting"}
          aria-busy={status === "submitting"}
          className="inline-flex items-center justify-center gap-3 rounded-[12px] bg-orange px-7 py-[15px] text-[16px] font-bold tracking-[-0.015em] text-navy shadow-cta transition-[transform,background] duration-200 hover:translate-y-[-2px] hover:bg-orange-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
        >
          {status === "submitting" ? t("submitting") : t("submit")}
        </button>
      </div>
    </form>
  );
}
