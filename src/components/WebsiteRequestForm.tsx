"use client";

import { useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { trackEvent } from "@/lib/analytics";
import { randomUUID } from "@/lib/id";
import {
  TurnstileWidget,
  type TurnstileWidgetHandle,
} from "@/components/TurnstileWidget";
import { websiteRequestSchema } from "@/lib/validation/website-request";
import {
  WEBSITE_FOCUS_AREAS,
  type WebsiteFocusArea,
  type WebsiteRequestType,
  type WebsiteRequestView,
} from "@/product/website-services/model";

type Values = {
  requestType: WebsiteRequestType | "";
  businessName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  currentWebsiteUrl: string;
  focusAreas: WebsiteFocusArea[];
  notes: string;
  companyWebsite: string;
};

type Status = "idle" | "submitting" | "sent";
type FieldErrors = Partial<Record<keyof Values | "turnstile", string>>;

export type WebsiteRequestFormProps = {
  /**
   * `public` is the marketing-site form (bot checks, no sign-in needed).
   * `member` is for a signed-in customer: it files the request under their own
   * business through the dashboard API.
   */
  mode: "public" | "member";
  /** Where a signed-in request came from. Ignored on the public form. */
  source?: "dashboard" | "onboarding";
  defaults?: Partial<Pick<Values, "businessName" | "contactName" | "contactEmail">>;
  /** Called with the saved request after a member submission succeeds. */
  onSubmitted?: (request: WebsiteRequestView | null) => void;
};

// Field order = focus order when validation fails.
const FIELD_ORDER: (keyof Values | "turnstile")[] = [
  "requestType",
  "businessName",
  "contactName",
  "contactEmail",
  "contactPhone",
  "currentWebsiteUrl",
  "notes",
  "turnstile",
];

const INPUT =
  "w-full rounded-[10px] border border-[rgb(var(--ink-rgb)/0.22)] bg-surface px-3.5 py-3 text-[16px] text-text outline-none transition-colors placeholder:text-muted/70 focus-visible:border-orange focus-visible:ring-2 focus-visible:ring-orange/40 aria-[invalid=true]:border-red-600 dark:aria-[invalid=true]:border-red-400";
const ERROR = "text-[13px] font-medium text-red-700 dark:text-red-400";

function fieldId(name: string, scope: string) {
  return `website-request-${scope}-${name}`;
}

/**
 * The short "Get My Website Built" request. It only records what the customer
 * wants; it is never a purchase, and the price is confirmed in writing first.
 */
export function WebsiteRequestForm({
  mode,
  source = "dashboard",
  defaults,
  onSubmitted,
}: WebsiteRequestFormProps) {
  const t = useTranslations("websiteRequest.form");
  const locale = useLocale() === "fr" ? "fr" : "en";
  const scope = `${mode}-${source}`;
  const id = (name: string) => fieldId(name, scope);

  const empty: Values = {
    requestType: "",
    businessName: defaults?.businessName ?? "",
    contactName: defaults?.contactName ?? "",
    contactEmail: defaults?.contactEmail ?? "",
    contactPhone: "",
    currentWebsiteUrl: "",
    focusAreas: [],
    notes: "",
    companyWebsite: "",
  };

  const [values, setValues] = useState<Values>(empty);
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

  function toggleFocus(area: WebsiteFocusArea) {
    set(
      "focusAreas",
      values.focusAreas.includes(area)
        ? values.focusAreas.filter((a) => a !== area)
        : [...values.focusAreas, area],
    );
  }

  function validate(): FieldErrors {
    const found: FieldErrors = {};
    if (!values.requestType) found.requestType = t("errors.required");
    const result = websiteRequestSchema.safeParse({
      ...values,
      requestType: values.requestType || "new",
      language: locale,
    });
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = String(issue.path[0]) as keyof Values;
        if (found[field]) continue;
        if (field === "contactEmail") {
          found[field] = values.contactEmail.trim()
            ? t("errors.email")
            : t("errors.required");
        } else if (field === "contactPhone") {
          found[field] = t("errors.phone");
        } else if (field === "currentWebsiteUrl") {
          found[field] =
            issue.message === "url_required"
              ? t("errors.urlRequired")
              : t("errors.url");
        } else {
          found[field] = t("errors.required");
        }
      }
    }
    if (mode === "public" && !turnstileToken) {
      found.turnstile = t("errors.verification");
    }
    return found;
  }

  function resetBotCheck() {
    if (mode !== "public") return;
    setTurnstileToken("");
    turnstileRef.current?.reset();
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (status === "submitting") return;

    const found = validate();
    setErrors(found);
    const first = FIELD_ORDER.find((name) => found[name]);
    if (first) {
      document.getElementById(id(first))?.focus();
      return;
    }

    setStatus("submitting");
    setSubmitError(null);
    const { companyWebsite, ...fields } = values;
    try {
      const response = await fetch(
        mode === "public" ? "/api/website-requests" : "/api/app/website-services",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "public"
              ? {
                  ...fields,
                  language: locale,
                  companyWebsite,
                  turnstileToken,
                  idempotencyKey: idempotencyKey.current,
                }
              : {
                  ...fields,
                  language: locale,
                  source,
                  idempotencyKey: idempotencyKey.current,
                },
          ),
        },
      );
      const result = (await response.json().catch(() => null)) as {
        ok?: boolean;
        request?: WebsiteRequestView;
      } | null;
      if (!response.ok || result?.ok !== true) {
        setSubmitError("generic");
        setStatus("idle");
        resetBotCheck();
        return;
      }
      trackEvent("website_request_submitted", {
        language: locale,
        type: String(values.requestType),
        source: mode === "public" ? "pricing" : source,
      });
      setStatus("sent");
      onSubmitted?.(result.request ?? null);
    } catch {
      setSubmitError("network");
      setStatus("idle");
      resetBotCheck();
    }
  }

  function reset() {
    idempotencyKey.current = randomUUID();
    setValues(empty);
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
    name: Exclude<keyof Values, "requestType" | "focusAreas" | "companyWebsite" | "notes">,
    label: string,
    options: {
      type?: string;
      autoComplete?: string;
      optional?: boolean;
      hint?: string;
      inputMode?: "text" | "email" | "tel" | "url";
    } = {},
  ) => {
    const error = errors[name];
    const hintId = options.hint ? `${id(name)}-hint` : undefined;
    const errorId = error ? `${id(name)}-error` : undefined;
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id(name)} className="text-[14px] font-semibold text-heading">
          {label}
          {options.optional ? (
            <span className="ml-1.5 font-normal text-muted">{t("optional")}</span>
          ) : null}
        </label>
        <input
          id={id(name)}
          name={name}
          type={options.type ?? "text"}
          inputMode={options.inputMode}
          autoComplete={options.autoComplete ?? "off"}
          value={values[name]}
          onChange={(e) => set(name, e.target.value)}
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

  const typeOption = (value: WebsiteRequestType) => {
    const selected = values.requestType === value;
    return (
      <label
        key={value}
        className={`flex cursor-pointer gap-3 rounded-[12px] border p-4 transition-colors ${
          selected
            ? "border-orange bg-[rgba(228,118,43,0.08)]"
            : "border-[rgb(var(--ink-rgb)/0.18)] hover:border-orange/60"
        }`}
      >
        <input
          type="radio"
          name={`${scope}-requestType`}
          value={value}
          checked={selected}
          onChange={() => set("requestType", value)}
          className="mt-1 h-[18px] w-[18px] shrink-0 accent-orange"
          {...(value === "new" ? { id: id("requestType") } : {})}
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-[15.5px] font-semibold text-heading">
            {t(`type.${value}`)}
          </span>
          <span className="text-[13.5px] leading-snug text-muted">
            {t(`type.${value}Hint`)}
          </span>
        </span>
      </label>
    );
  };

  const improving = values.requestType === "improve";

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-7">
      {mode === "public" ? (
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
      ) : null}

      <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <legend className="mb-3 p-0 font-heading text-[19px] font-bold tracking-[-0.02em] text-heading">
          {t("typeLegend")}
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {typeOption("new")}
          {typeOption("improve")}
        </div>
        {errors.requestType ? (
          <p role="alert" className={ERROR}>
            {errors.requestType}
          </p>
        ) : null}
      </fieldset>

      <div className="grid gap-5 md:grid-cols-2">
        {field("businessName", t("businessName"), { autoComplete: "organization" })}
        {field("contactName", t("contactName"), { autoComplete: "name" })}
        {field("contactEmail", t("contactEmail"), {
          type: "email",
          inputMode: "email",
          autoComplete: "email",
        })}
        {field("contactPhone", t("contactPhone"), {
          type: "tel",
          inputMode: "tel",
          autoComplete: "tel",
          optional: true,
        })}
      </div>

      {field("currentWebsiteUrl", t("currentWebsiteUrl"), {
        inputMode: "url",
        autoComplete: "url",
        optional: !improving,
        hint: improving
          ? t("currentWebsiteHintImprove")
          : t("currentWebsiteHintNew"),
      })}

      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-[14px] font-semibold text-heading">
          {t("focusLegend")}
          <span className="ml-1.5 font-normal text-muted">{t("optional")}</span>
        </legend>
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {WEBSITE_FOCUS_AREAS.map((area) => (
            <label
              key={area}
              className="flex cursor-pointer items-center gap-3 py-1 text-[15px] text-heading"
            >
              <input
                type="checkbox"
                checked={values.focusAreas.includes(area)}
                onChange={() => toggleFocus(area)}
                className="h-[18px] w-[18px] shrink-0 accent-orange"
              />
              <span>{t(`focus.${area}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={id("notes")} className="text-[14px] font-semibold text-heading">
          {t("notes")}
          <span className="ml-1.5 font-normal text-muted">{t("optional")}</span>
        </label>
        <textarea
          id={id("notes")}
          name="notes"
          rows={3}
          maxLength={1000}
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
          className={INPUT}
        />
      </div>

      <p className="rounded-[10px] border-l-2 border-orange bg-[rgba(228,118,43,0.07)] px-4 py-3 text-[14px] leading-[1.55] text-heading">
        {t("priceNote")}
      </p>

      {mode === "public" ? (
        <div>
          <div id={id("turnstile")} tabIndex={-1} className="outline-none">
            <TurnstileWidget
              ref={turnstileRef}
              action="website-request"
              onToken={setTurnstileToken}
            />
          </div>
          {errors.turnstile ? (
            <p role="alert" className={`mt-2 ${ERROR}`}>
              {errors.turnstile}
            </p>
          ) : null}
        </div>
      ) : null}

      {submitError ? (
        <p role="alert" className={ERROR}>
          {submitError === "network" ? t("errors.network") : t("errors.generic")}
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
