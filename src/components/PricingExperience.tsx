"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CTAButton } from "@/components/CTAButton";

export type PricingTier = {
  name: string;
  price: string;
  cadence: string;
  items: string[];
  badge?: string;
  idealFor: string;
  setupAmount?: string;
  monthlyAmount?: string;
};

type Labels = {
  mostPopular: string;
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
  const primary = tiers.slice(0, 2);

  return (
    <div className="w-full">
      {/* Cards sit clearly on paper — Growth stays light so it never merges with the navy hero */}
      <div className="relative z-[1] -mt-[clamp(24px,3vw,40px)] grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
        {primary.map((tier, i) => (
          <PlanCard
            key={tier.name}
            tier={tier}
            index={i}
            featured={Boolean(tier.badge)}
            popularLabel={labels.mostPopular}
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
          <CTAButton href="/book-audit" variant="ember" size="lg" className="shrink-0">
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
        <div className="flex flex-col gap-6 border-t border-[rgba(12,20,30,0.14)] pt-8 lg:flex-row lg:items-start lg:justify-between lg:gap-12">
          <h2 className="m-0 max-w-[10em] font-heading text-[clamp(24px,2.6vw,32px)] font-extrabold tracking-[-0.035em] text-navy">
            {labels.includesTitle}
          </h2>
          <ul className="m-0 grid flex-1 list-none gap-x-8 gap-y-0 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {labels.includesItems.map((item) => (
              <li
                key={item}
                className="border-t border-[rgba(12,20,30,0.1)] py-4 text-[15px] leading-[1.5] text-secondary"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-10 border-t border-[rgba(12,20,30,0.14)]">
          {labels.details.map((detail) => (
            <DetailAccordion key={detail.title} title={detail.title} body={detail.body} />
          ))}
        </div>
      </motion.section>
    </div>
  );
}

function PlanCard({
  tier,
  index,
  featured,
  popularLabel,
  cta,
  setupLabel,
  monthlyLabel,
  thenLabel,
}: {
  tier: PricingTier;
  index: number;
  featured: boolean;
  popularLabel: string;
  cta: string;
  setupLabel: string;
  monthlyLabel: string;
  thenLabel: string;
}) {
  const features = tier.items.slice(0, 6);
  const setupDisplay = tier.setupAmount ?? tier.price;
  const monthlyDisplay = tier.monthlyAmount ?? tier.cadence.replace(/^\+\s*/, "");

  return (
    <motion.article
      initial={{ y: 20 }}
      whileInView={{ y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.55, delay: index * 0.08, ease }}
      className={`relative flex flex-col border bg-white p-[clamp(32px,3.5vw,48px)] text-navy transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 ${
        featured
          ? "border-orange/55 shadow-[0_32px_64px_-40px_rgba(228,118,43,0.45)] ring-1 ring-orange/20"
          : "border-[rgba(12,20,30,0.1)] shadow-[0_20px_48px_-40px_rgba(12,20,30,0.28)]"
      }`}
    >
      {featured ? (
        <div
          aria-hidden
          className="absolute top-0 left-0 h-full w-[3px] bg-orange"
        />
      ) : null}

      <div className="flex items-baseline justify-between gap-4">
        <h2 className="m-0 font-heading text-[clamp(28px,2.8vw,36px)] font-extrabold tracking-[-0.04em] text-navy">
          {tier.name}
        </h2>
        {featured ? (
          <span className="shrink-0 bg-[rgba(228,118,43,0.12)] px-2.5 py-1 text-[12px] font-semibold tracking-[0.04em] text-ember-text">
            {popularLabel}
          </span>
        ) : null}
      </div>

      <p className="mt-4 max-w-[28em] text-[16px] leading-[1.55] text-muted">
        {tier.idealFor}
      </p>

      <div className="mt-9 border-t border-[rgba(12,20,30,0.1)] pt-8">
        <p className="text-[12px] tracking-[0.08em] text-muted uppercase">
          {setupLabel}
        </p>
        <p className="mt-2 font-heading text-[clamp(42px,4.5vw,56px)] font-extrabold leading-[0.95] tracking-[-0.05em] text-navy">
          {setupDisplay}
        </p>
        <p className="mt-4 text-[16px] text-secondary">
          <span className="text-muted">{thenLabel} </span>
          <span className="font-semibold text-navy">{monthlyDisplay}</span>
          <span className="text-muted"> / {monthlyLabel.toLowerCase()}</span>
        </p>
      </div>

      <ul className="mt-9 flex flex-1 list-none flex-col p-0">
        {features.map((item) => (
          <li
            key={item}
            className="border-t border-[rgba(12,20,30,0.08)] py-3.5 text-[15.5px] leading-[1.45] text-secondary"
          >
            {item}
          </li>
        ))}
      </ul>

      <CTAButton
        href="/book-audit"
        variant={featured ? "ember" : "ink"}
        size="lg"
        className="mt-10 w-full"
      >
        {cta}
      </CTAButton>
    </motion.article>
  );
}

function DetailAccordion({ title, body }: { title: string; body: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-[rgba(12,20,30,0.1)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-6 py-5 text-left"
      >
        <span className="font-heading text-[18px] font-bold tracking-[-0.02em] text-navy">
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
