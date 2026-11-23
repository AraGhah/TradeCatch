"use client";

import { useId, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Check, Star } from "lucide-react";
import { CTAButton, type AnchorHref } from "@/components/CTAButton";
import { cn } from "@/lib/cn";

export type PricingOutcomeGroup = {
  title: string;
  items: string[];
};

/** Routes a pricing tier is allowed to point at. */
const TIER_HREFS = {
  "/book-audit": "/book-audit",
  "/receptionist": "/receptionist",
  "/pricing": "/pricing",
} as const;

type TierHref = keyof typeof TIER_HREFS;

/** Plan ids accepted by the book-audit intake, so a lead stays attributable. */
const TIER_PLAN_INTEREST = ["essential", "professional"] as const;

type TierPlanInterest = (typeof TIER_PLAN_INTEREST)[number];

/** A localized page + anchor passed in by the page, e.g. "/fr/receptionniste#try-it". */
const ANCHOR_HREF = /^\/(?!\/)[a-z0-9/-]*#[\w-]+$/i;

function resolveHref(
  value: string | undefined,
  fallback: TierHref,
): TierHref | AnchorHref {
  if (value && value in TIER_HREFS) return value as TierHref;
  if (value && ANCHOR_HREF.test(value)) return value as AnchorHref;
  return fallback;
}

function resolvePlanInterest(
  value: string | undefined,
): TierPlanInterest | undefined {
  return TIER_PLAN_INTEREST.includes(value as TierPlanInterest)
    ? (value as TierPlanInterest)
    : undefined;
}

/**
 * Only the intake route carries the plan query — linking to a content page
 * with a stray `?plan=` would just create duplicate URLs for crawlers.
 */
function tierCtaHref(
  pathname: TierHref | AnchorHref,
  plan: TierPlanInterest | undefined,
) {
  return plan && pathname === "/book-audit"
    ? { pathname, query: { plan } }
    : pathname;
}

export type PricingTier = {
  name: string;
  /** Short outcome line, e.g. "Recover More Leads" */
  tagline: string;
  /** One-sentence core outcome */
  outcome: string;
  price: string;
  cadence: string;
  groups: PricingOutcomeGroup[];
  badge?: string;
  /** Visual weight. Featured is the recommended plan. */
  emphasis?: "featured" | "premium";
  idealFor: string;
  setupAmount?: string;
  monthlyAmount?: string;
  reassuranceLine?: string;
  /** "Everything in Essential, plus:" style line for stacked plans */
  includesPrevious?: string;
  /** What this plan adds over the previous one, with the real price difference */
  stepUp?: string;
  /** Allowance/limits disclosure shown under the price */
  usageNote?: string;
  /**
   * A capability only this plan has, called out above the feature groups so
   * the premium plan is clearly set apart from the one below it.
   */
  exclusive?: { badge: string; title: string; body: string };
  ctaLabel?: string;
  ctaHref?: string;
  /** Tags the intake submission with the plan this CTA came from. */
  planInterest?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
};

type Labels = {
  cta: string;
  setupLabel: string;
  /** Optional block under the plans for work outside the two standard plans. */
  customTitle?: string;
  customBody?: string;
  customCta?: string;
  includesTitle: string;
  includesItems: string[];
  details: { title: string; body: string }[];
  onceLabel: string;
  monthlyEyebrow: string;
  /** Small line under each plan CTA pointing at the Done-for-You Website Service. */
  websiteMention: string;
  periodLabel?: string;
};

const ease = [0.22, 1, 0.36, 1] as const;

/**
 * Pricing cards adapted from Codehagen / Prism UI (MIT): rounded cards, large
 * monthly figures, checkmark feature lists, recommended highlight. Confetti,
 * annual toggle, NumberFlow, and decorative entrance motion are omitted —
 * TradeCatch bills monthly only and keeps the section calm.
 */
export function PricingExperience({
  tiers,
  labels,
  afterPlans,
}: {
  tiers: PricingTier[];
  labels: Labels;
  /**
   * Rendered directly under the plan cards, before the custom-plan block and
   * the FAQs. The pricing page puts the Done-for-You Website Service here.
   */
  afterPlans?: ReactNode;
}) {
  return (
    <div className="w-full font-cabinet">
      <div className="relative z-[1] -mt-[clamp(24px,3vw,40px)] mx-auto grid max-w-5xl grid-cols-1 items-stretch gap-5 md:grid-cols-2 md:gap-6 lg:gap-8">
        {tiers.map((tier) => (
          <PlanCard
            key={tier.name}
            tier={tier}
            cta={labels.cta}
            setupLabel={labels.setupLabel}
            onceLabel={labels.onceLabel}
            monthlyEyebrow={labels.monthlyEyebrow}
            periodLabel={labels.periodLabel}
            websiteMention={labels.websiteMention}
          />
        ))}
      </div>

      {afterPlans ? (
        <div className="mt-[clamp(24px,3vw,36px)]">{afterPlans}</div>
      ) : null}

      {labels.customTitle && labels.customBody && labels.customCta ? (
        <section className="relative mt-[clamp(24px,3vw,36px)] overflow-hidden bg-navy px-[clamp(24px,3.2vw,36px)] py-[clamp(24px,3vw,36px)] text-white">
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
            <div className="max-w-[34em]">
              <p className="font-cabinet text-[clamp(26px,3vw,36px)] font-extrabold tracking-[-0.04em]">
                {labels.customTitle}
              </p>
              <p className="mt-3 text-[16.5px] leading-[1.6] text-white/65">
                {labels.customBody}
              </p>
            </div>
            <CTAButton
              href="/book-audit"
              variant="ember"
              size="lg"
              className="shrink-0"
            >
              {labels.customCta}
            </CTAButton>
          </div>
        </section>
      ) : null}

      <section className="mt-[clamp(32px,4vw,48px)]">
        <div className="flex flex-col gap-6 border-t border-[rgb(var(--ink-rgb)/0.14)] pt-6 lg:flex-row lg:items-start lg:justify-between lg:gap-12">
          <h2 className="m-0 max-w-[10em] font-cabinet text-[clamp(24px,2.6vw,32px)] font-extrabold tracking-[-0.035em] text-heading">
            {labels.includesTitle}
          </h2>
          <ul className="m-0 grid flex-1 list-none gap-x-8 gap-y-0 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {labels.includesItems.map((item) => (
              <li
                key={item}
                className="border-t border-[rgb(var(--ink-rgb)/0.1)] py-3 text-[15px] leading-[1.5] text-secondary"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 border-t border-[rgb(var(--ink-rgb)/0.14)]">
          {labels.details.map((detail) => (
            <DetailAccordion
              key={detail.title}
              title={detail.title}
              body={detail.body}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function PlanCard({
  tier,
  cta,
  setupLabel,
  onceLabel,
  monthlyEyebrow,
  periodLabel,
  websiteMention,
}: {
  tier: PricingTier;
  cta: string;
  setupLabel: string;
  onceLabel: string;
  monthlyEyebrow: string;
  periodLabel?: string;
  websiteMention: string;
}) {
  const setupDisplay = tier.setupAmount ?? tier.price;
  const monthlyDisplay =
    tier.monthlyAmount ?? tier.cadence.replace(/^\+\s*/, "");
  const recommended =
    tier.emphasis === "featured" || tier.emphasis === "premium";

  return (
    <article
      className={cn(
        "relative flex h-full flex-col rounded-2xl border bg-surface p-[clamp(22px,2.6vw,32px)] text-heading transition-[border-color,box-shadow] duration-200",
        recommended
          ? "z-10 border-2 border-navy shadow-[0_24px_48px_-32px_rgb(var(--ink-rgb)/0.35)]"
          : "border-[rgb(var(--ink-rgb)/0.12)] hover:border-[rgb(var(--ink-rgb)/0.22)]",
      )}
    >
      {recommended && tier.badge ? (
        <div className="absolute -top-3 left-1/2 z-20 -translate-x-1/2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-navy px-3 py-1 text-[12px] font-semibold tracking-[0.02em] text-white">
            <Star
              className="h-3.5 w-3.5 fill-orange text-orange"
              aria-hidden
            />
            {tier.badge}
          </span>
        </div>
      ) : tier.badge ? (
        <div className="mb-3">
          <span className="inline-flex rounded-full bg-[rgba(228,118,43,0.12)] px-2.5 py-1 text-[12px] font-semibold tracking-[0.04em] text-ember-text">
            {tier.badge}
          </span>
        </div>
      ) : null}

      <div className={cn("flex flex-col", recommended && tier.badge && "pt-2")}>
        <h2 className="m-0 font-cabinet text-[clamp(22px,2.4vw,28px)] font-extrabold tracking-[-0.03em] text-heading">
          {tier.name}
        </h2>
        <p className="mt-2 text-[15px] font-medium leading-[1.45] text-ember-text">
          {tier.tagline}
        </p>
        <p className="mt-3 text-[15.5px] leading-[1.55] text-secondary">
          {tier.outcome}
        </p>
        <p className="mt-2 text-[14px] leading-[1.5] text-muted">{tier.idealFor}</p>
      </div>

      <div className="mt-6 border-t border-[rgb(var(--ink-rgb)/0.1)] pt-5">
        <p className="text-[12px] font-medium tracking-[0.08em] text-muted uppercase">
          {monthlyEyebrow}
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="m-0 font-cabinet text-[clamp(40px,4.2vw,52px)] font-extrabold leading-none tracking-[-0.045em] text-heading tabular-nums">
            {monthlyDisplay}
          </p>
          {periodLabel ? (
            <span className="text-[15px] text-muted">/ {periodLabel}</span>
          ) : null}
        </div>
        <p className="mt-4 text-[15px] leading-[1.45] text-secondary">
          <span className="text-muted">{setupLabel} </span>
          <span className="font-semibold text-heading tabular-nums">
            {setupDisplay}
          </span>
          <span className="text-muted"> · {onceLabel}</span>
        </p>
        {tier.stepUp ? (
          <p className="mt-4 border-l-2 border-orange pl-3 text-[14px] leading-[1.5] font-medium text-heading">
            {tier.stepUp}
          </p>
        ) : null}
        {tier.reassuranceLine ? (
          <p className="mt-3 text-[13.5px] leading-[1.5] text-muted">
            {tier.reassuranceLine}
          </p>
        ) : null}
        {tier.usageNote ? (
          <p className="mt-2 text-[13px] leading-[1.5] text-muted">
            {tier.usageNote}
          </p>
        ) : null}
      </div>

      <div className="mt-7 flex flex-1 flex-col gap-5">
        {tier.exclusive ? (
          <div
            data-testid="plan-exclusive"
            className="rounded-xl border border-orange/30 bg-[rgba(228,118,43,0.08)] px-4 py-3.5"
          >
            <p className="text-[11px] font-semibold tracking-[0.1em] text-orange uppercase">
              {tier.exclusive.badge}
            </p>
            <p className="mt-1.5 font-cabinet text-[18px] font-extrabold tracking-[-0.02em] text-heading">
              {tier.exclusive.title}
            </p>
            <p className="mt-1.5 text-[14.5px] leading-[1.5] text-secondary">
              {tier.exclusive.body}
            </p>
          </div>
        ) : null}
        {tier.includesPrevious ? (
          <p className="border-t border-[rgb(var(--ink-rgb)/0.08)] pt-4 text-[14.5px] font-semibold text-heading">
            {tier.includesPrevious}
          </p>
        ) : null}
        {tier.groups.map((group) => (
          <div key={group.title}>
            <p className="text-[11px] font-semibold tracking-[0.1em] text-muted uppercase">
              {group.title}
            </p>
            <ul className="mt-2.5 flex list-none flex-col gap-2.5 p-0">
              {group.items.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2.5 text-left text-[15px] leading-[1.45] text-secondary"
                >
                  <Check
                    className="mt-0.5 h-4 w-4 shrink-0 text-navy"
                    strokeWidth={2.25}
                    aria-hidden
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-col items-stretch gap-3">
        <CTAButton
          href={tierCtaHref(
            resolveHref(tier.ctaHref, "/book-audit"),
            resolvePlanInterest(tier.planInterest),
          )}
          variant={recommended ? "ember" : "ink"}
          size="lg"
          className="w-full justify-center"
        >
          {tier.ctaLabel ?? cta}
        </CTAButton>
        {tier.secondaryCtaLabel ? (
          <CTAButton
            href={resolveHref(tier.secondaryCtaHref, "/receptionist")}
            variant="outline"
            size="lg"
            className="w-full justify-center"
          >
            {tier.secondaryCtaLabel}
          </CTAButton>
        ) : null}
        <p className="text-center text-[13px] leading-[1.45] text-muted">
          <a
            href="#website-service"
            className="underline decoration-1 underline-offset-[3px] transition-colors hover:text-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
          >
            {websiteMention}
          </a>
        </p>
      </div>
    </article>
  );
}

function DetailAccordion({ title, body }: { title: string; body: string }) {
  const [open, setOpen] = useState(false);
  const baseId = useId();
  const buttonId = `${baseId}-button`;
  const panelId = `${baseId}-panel`;

  return (
    <div className="border-b border-[rgb(var(--ink-rgb)/0.1)]">
      <button
        type="button"
        id={buttonId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-6 py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2"
      >
        <span className="font-cabinet text-[18px] font-bold tracking-[-0.02em] text-heading">
          {title}
        </span>
        <span
          aria-hidden
          className={cn(
            "relative h-4 w-4 shrink-0 transition-transform duration-200",
            open && "rotate-45",
          )}
        >
          <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-navy" />
          <span className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-navy" />
        </span>
      </button>
      {/* Always mounted so FAQ text stays in the HTML for crawlers and no-JS. */}
      <motion.div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.28, ease }}
        className="overflow-hidden"
      >
        <p className="max-w-[42em] pb-5 text-[15.5px] leading-[1.65] text-muted">
          {body}
        </p>
      </motion.div>
    </div>
  );
}
