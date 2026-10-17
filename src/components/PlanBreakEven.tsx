"use client";

import { useId, useState } from "react";
import { CTAButton } from "@/components/CTAButton";
import {
  PLAN_PRICES,
  formatPlanMoney,
  monthsCovered,
  parseMoneyInput,
  priceLocale,
  type PlanId,
} from "@/lib/plans";

export type PlanBreakEvenCopy = {
  eyebrow: string;
  title: string;
  intro: string;
  inputLabel: string;
  inputHint: string;
  planColumn: string;
  feeColumn: string;
  coverColumn: string;
  months: string;
  monthOne: string;
  partMonth: string;
  invalid: string;
  note: string;
  cta: string;
};

/** Shown until the visitor types their own figure. An example, not a statistic. */
const EXAMPLE_JOB_VALUE = 1500;
/** Bars stop growing at a year of cover so one huge job doesn't flatten the rest. */
const BAR_FULL_MONTHS = 12;

export function PlanBreakEven({
  locale,
  copy,
  plans,
}: {
  locale: "fr" | "en";
  copy: PlanBreakEvenCopy;
  plans: { id: PlanId; name: string }[];
}) {
  const inputId = useId();
  const hintId = useId();
  const [raw, setRaw] = useState(String(EXAMPLE_JOB_VALUE));
  const value = parseMoneyInput(raw);

  const describe = (months: number): string => {
    if (months < 1) {
      return copy.partMonth.replace(
        "{value}",
        String(Math.max(1, Math.round(months * 100))),
      );
    }
    const rounded = months >= 10 ? Math.round(months) : Math.round(months * 10) / 10;
    if (rounded === 1) return copy.monthOne;
    return copy.months.replace(
      "{value}",
      rounded.toLocaleString(priceLocale(locale), { maximumFractionDigits: 1 }),
    );
  };

  return (
    <div className="grid items-start gap-[clamp(28px,4vw,64px)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div>
        <p className="text-[13px] font-medium text-ember-text">{copy.eyebrow}</p>
        <h2 className="text-section mt-3 text-heading">{copy.title}</h2>
        <p className="mt-5 max-w-[34em] text-[16.5px] leading-[1.6] text-muted">
          {copy.intro}
        </p>

        <label
          htmlFor={inputId}
          className="mt-8 block font-mono text-[10.5px] tracking-[0.12em] text-muted uppercase"
        >
          {copy.inputLabel}
        </label>
        <div className="mt-2 flex max-w-[22rem] items-stretch border border-[rgb(var(--ink-rgb)/0.25)] bg-surface focus-within:border-navy focus-within:ring-2 focus-within:ring-orange/50">
          <span
            aria-hidden
            className="flex items-center border-r border-[rgb(var(--ink-rgb)/0.12)] px-4 font-heading text-[20px] font-bold text-muted"
          >
            $
          </span>
          <input
            id={inputId}
            value={raw}
            onChange={(e) => setRaw(e.target.value.slice(0, 12))}
            inputMode="decimal"
            autoComplete="off"
            aria-describedby={hintId}
            aria-invalid={value === null}
            className="min-w-0 flex-1 bg-transparent px-4 py-3.5 font-heading text-[24px] font-extrabold tracking-[-0.03em] text-heading outline-none"
          />
        </div>
        <p
          id={hintId}
          className={`mt-2 text-[13px] leading-[1.5] ${value === null ? "text-red-700 dark:text-red-300" : "text-muted"}`}
        >
          {value === null ? copy.invalid : copy.inputHint}
        </p>
      </div>

      <div className="border border-[rgb(var(--ink-rgb)/0.12)] bg-surface p-[clamp(20px,3vw,32px)]">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 border-b border-[rgb(var(--ink-rgb)/0.16)] pb-3 font-mono text-[10.5px] tracking-[0.12em] text-muted uppercase sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.2fr)]">
          <span>{copy.planColumn}</span>
          <span className="hidden sm:block">{copy.feeColumn}</span>
          <span className="text-right sm:text-left">{copy.coverColumn}</span>
        </div>

        <ul aria-live="polite" className="m-0 list-none p-0">
          {plans.map((plan) => {
            const monthly = PLAN_PRICES[plan.id].monthly;
            const months = value === null ? null : monthsCovered(value, monthly);
            return (
              <li
                key={plan.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 border-b border-[rgb(var(--ink-rgb)/0.08)] py-4 last:border-b-0 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.2fr)]"
              >
                <div>
                  <p className="m-0 font-heading text-[18px] font-bold tracking-[-0.025em] text-heading">
                    {plan.name}
                  </p>
                  <p className="m-0 mt-0.5 text-[13px] text-muted sm:hidden">
                    {formatPlanMoney(monthly, locale)}
                  </p>
                </div>
                <p className="m-0 hidden text-[15px] text-secondary sm:block">
                  {formatPlanMoney(monthly, locale)}
                </p>
                <div className="text-right sm:text-left">
                  <p className="m-0 font-heading text-[18px] font-extrabold tracking-[-0.03em] text-heading">
                    {months === null ? "—" : describe(months)}
                  </p>
                  <div
                    aria-hidden
                    className="mt-1.5 hidden h-[5px] bg-[rgb(var(--ink-rgb)/0.08)] sm:block"
                  >
                    <div
                      className="h-full bg-orange transition-[width] duration-500"
                      style={{
                        width: `${months === null ? 0 : Math.min(100, (months / BAR_FULL_MONTHS) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="mt-4 border-t border-[rgb(var(--ink-rgb)/0.1)] pt-4 text-[13px] leading-[1.55] text-muted">
          {copy.note}
        </p>
        <CTAButton href="/book-audit" variant="ember" className="mt-5">
          {copy.cta}
        </CTAButton>
      </div>
    </div>
  );
}
