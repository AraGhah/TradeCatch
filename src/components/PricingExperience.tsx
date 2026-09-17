"use client";

import { useId, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CTAButton } from "@/components/CTAButton";

export type PricingOutcomeGroup = {
  title: string;
  items: string[];
};

/** Routes a pricing tier is allowed to point at. */
const TIER_HREFS = {
  "/book-audit": "/book-audit",
  "/ai-receptionist": "/ai-receptionist",
  "/pricing": "/pricing",
} as const;

type TierHref = keyof typeof TIER_HREFS;

/** Plan ids accepted by the book-audit intake, so a lead stays attributable. */
const TIER_PLAN_INTEREST = ["starter", "growth", "ai-receptionist"] as const;

type TierPlanInterest = (typeof TIER_PLAN_INTEREST)[number];

function resolveHref(value: string | undefined, fallback: TierHref): TierHref {
  return value && value in TIER_HREFS ? (value as TierHref) : fallback;
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
function tierCtaHref(pathname: TierHref, plan: TierPlanInterest | undefined) {
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
  /** Visual weight. Premium gets the inverted card. */
  emphasis?: "featured" | "premium";
  idealFor: string;
  setupAmount?: string;
  monthlyAmount?: string;
  reassuranceLine?: string;
  /** "Everything in Starter, plus:" style line for stacked plans */
  includesPrevious?: string;
  /** Allowance/limits disclosure shown under the price */
  usageNote?: string;
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
  monthlyLabel: string;
  customTitle: string;
  customBody: string;
  customCta: string;
  includesTitle: string;
  includesItems: string[];
  details: { title: string; body: string }[];
  thenLabel: string;
};

const ease = [0.22, 1, 0.36, 1] as const;

export function PricingExperience({
  tiers,
  labels,
}: {
  tiers: PricingTier[];
  labels: Labels;
}) {
  return (
    <div className="w-full">
      {/*
        Two standard plans sit side by side from md; the premium plan spans the
        full row there and only joins them as a third column at lg.
      */}
      <div className="relative z-[1] -mt-[clamp(24px,3vw,40px)] grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-5">
        {tiers.map((tier, i) => (
          <PlanCard
            key={tier.name}
            tier={tier}
            index={i}
            cta={labels.cta}
            setupLabel={labels.setupLabel}
            monthlyLabel={labels.monthlyLabel}
            thenLabel={labels.thenLabel}
          />
        ))}
      </div>

      <motion.section
        initial={{ y: 14 }}
        whileInView={{ y: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.5, ease }}
        className="relative mt-[clamp(40px,5vw,56px)] overflow-hidden bg-navy px-[clamp(28px,4vw,48px)] py-[clamp(36px,4.5vw,52px)] text-white"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(80% 80% at 80% 50%, #000 20%, transparent 75%)",
          }}
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
          <div className="max-w-[34em]">
            <p className="font-heading text-[clamp(26px,3vw,36px)] font-extrabold tracking-[-0.04em]">
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
      </motion.section>

      <motion.section
        initial={{ y: 12 }}
        whileInView={{ y: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.45, ease }}
        className="mt-[clamp(48px,6vw,72px)]"
      >
        <div className="flex flex-col gap-6 border-t border-[rgb(var(--ink-rgb)/0.14)] pt-8 lg:flex-row lg:items-start lg:justify-between lg:gap-12">
          <h2 className="m-0 max-w-[10em] font-heading text-[clamp(24px,2.6vw,32px)] font-extrabold tracking-[-0.035em] text-heading">
            {labels.includesTitle}
          </h2>
          <ul className="m-0 grid flex-1 list-none gap-x-8 gap-y-0 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {labels.includesItems.map((item) => (
              <li
                key={item}
                className="border-t border-[rgb(var(--ink-rgb)/0.1)] py-4 text-[15px] leading-[1.5] text-secondary"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-10 border-t border-[rgb(var(--ink-rgb)/0.14)]">
          {labels.details.map((detail) => (
            <DetailAccordion
              key={detail.title}
              title={detail.title}
              body={detail.body}
            />
          ))}
        </div>
      </motion.section>
    </div>
  );
}

function PlanCard({
  tier,
  index,
  cta,
  setupLabel,
  monthlyLabel,
  thenLabel,
}: {
  tier: PricingTier;
  index: number;
  cta: string;
  setupLabel: string;
  monthlyLabel: string;
  thenLabel: string;
}) {
  const setupDisplay = tier.setupAmount ?? tier.price;
  const monthlyDisplay =
    tier.monthlyAmount ?? tier.cadence.replace(/^\+\s*/, "");
  const premium = tier.emphasis === "premium";
  const featured = tier.emphasis === "featured";

  const shell = premium
    ? "border-navy bg-navy text-white shadow-[0_36px_72px_-40px_rgb(var(--ink-rgb)/0.6)] md:col-span-2 lg:col-span-1"
    : featured
      ? "border-orange/55 bg-surface text-heading shadow-[0_32px_64px_-40px_rgba(228,118,43,0.45)] ring-1 ring-orange/20"
      : "border-[rgb(var(--ink-rgb)/0.1)] bg-surface text-heading shadow-[0_20px_48px_-40px_rgb(var(--ink-rgb)/0.28)]";

  const divider = premium
    ? "border-white/12"
    : "border-[rgb(var(--ink-rgb)/0.1)]";
  const softDivider = premium
    ? "border-white/[0.08]"
    : "border-[rgb(var(--ink-rgb)/0.08)]";
  const bodyText = premium ? "text-white/85" : "text-heading/85";
  const mutedText = premium ? "text-white/55" : "text-muted";
  const listText = premium ? "text-white/80" : "text-secondary";
  const strongText = premium ? "text-white" : "text-heading";

  return (
    <motion.article
      initial={{ y: 20 }}
      whileInView={{ y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.55, delay: index * 0.08, ease }}
      className={`relative flex flex-col border p-[clamp(28px,3.2vw,44px)] transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 ${shell}`}
    >
      {featured ? (
        <div
          aria-hidden
          className="absolute top-0 left-0 h-full w-[3px] bg-orange"
        />
      ) : null}
      {premium ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage:
              "radial-gradient(80% 55% at 90% 0%, #000 10%, transparent 72%)",
          }}
        />
      ) : null}

      <div className="relative flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2
            className={`m-0 font-heading text-[clamp(26px,2.6vw,34px)] font-extrabold tracking-[-0.04em] ${strongText}`}
          >
            {tier.name}
          </h2>
          <p
            className={`mt-2 text-[15px] font-semibold tracking-[-0.01em] ${premium ? "text-orange" : "text-orange"}`}
          >
            {tier.tagline}
          </p>
        </div>
        {tier.badge ? (
          <span
            className={`shrink-0 px-2.5 py-1 text-[12px] font-semibold tracking-[0.04em] ${
              premium
                ? "bg-orange text-navy"
                : "bg-[rgba(228,118,43,0.12)] text-ember-text"
            }`}
          >
            {tier.badge}
          </span>
        ) : null}
      </div>

      <p
        className={`relative mt-4 max-w-[32em] text-[16px] leading-[1.55] ${bodyText}`}
      >
        {tier.outcome}
      </p>
      <p
        className={`relative mt-2 max-w-[28em] text-[14.5px] leading-[1.5] ${mutedText}`}
      >
        {tier.idealFor}
      </p>

      <div className={`relative mt-7 border-t pt-6 ${divider}`}>
        <p className={`text-[12px] tracking-[0.08em] uppercase ${mutedText}`}>
          {setupLabel}
        </p>
        <p
          className={`mt-1.5 font-heading text-[clamp(26px,2.6vw,32px)] font-extrabold leading-[1.05] tracking-[-0.03em] break-words ${strongText}`}
        >
          {setupDisplay}
        </p>
        <p className={`mt-2 text-[15px] ${listText}`}>
          <span className={mutedText}>{thenLabel} </span>
          <span className={`font-semibold ${strongText}`}>
            {monthlyDisplay}
          </span>
          <span className={mutedText}> / {monthlyLabel.toLowerCase()}</span>
        </p>
        {tier.reassuranceLine ? (
          <p className={`mt-3 text-[13.5px] leading-[1.5] ${mutedText}`}>
            {tier.reassuranceLine}
          </p>
        ) : null}
        {tier.usageNote ? (
          <p className={`mt-2 text-[13px] leading-[1.5] ${mutedText}`}>
            {tier.usageNote}
          </p>
        ) : null}
      </div>

      <div className="relative mt-7 flex flex-1 flex-col gap-5">
        {tier.includesPrevious ? (
          <p
            className={`border-t pt-4 text-[14.5px] font-semibold ${softDivider} ${strongText}`}
          >
            {tier.includesPrevious}
          </p>
        ) : null}
        {tier.groups.map((group) => (
          <div key={group.title} className={`border-t pt-4 ${softDivider}`}>
            <p
              className={`text-[11px] font-semibold tracking-[0.1em] uppercase ${mutedText}`}
            >
              {group.title}
            </p>
            <ul className="mt-2 flex list-none flex-col p-0">
              {group.items.map((item) => (
                <li
                  key={item}
                  className={`py-1.5 text-[15px] leading-[1.45] ${listText}`}
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="relative mt-10 flex flex-col items-stretch gap-3">
        <CTAButton
          href={tierCtaHref(
            resolveHref(tier.ctaHref, "/book-audit"),
            resolvePlanInterest(tier.planInterest),
          )}
          variant={premium || featured ? "ember" : "ink"}
          size="lg"
          className="w-full"
        >
          {tier.ctaLabel ?? cta}
        </CTAButton>
        {tier.secondaryCtaLabel ? (
          <CTAButton
            href={resolveHref(tier.secondaryCtaHref, "/ai-receptionist")}
            variant="ghost-ink"
            size="lg"
            className="w-full"
          >
            {tier.secondaryCtaLabel}
          </CTAButton>
        ) : null}
      </div>
    </motion.article>
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
        className="flex w-full items-center justify-between gap-6 py-5 text-left"
      >
        <span className="font-heading text-[18px] font-bold tracking-[-0.02em] text-heading">
          {title}
        </span>
        <span
          aria-hidden
          className={`relative h-4 w-4 shrink-0 transition-transform duration-200 ${
            open ? "rotate-45" : ""
          }`}
        >
          <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-navy" />
          <span className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-navy" />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={panelId}
            role="region"
            aria-labelledby={buttonId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease }}
            className="overflow-hidden"
          >
            <p className="max-w-[42em] pb-5 text-[15.5px] leading-[1.65] text-muted">
              {body}
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
