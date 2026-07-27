"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { CTAButton } from "@/components/CTAButton";

export type PricingTier = {
  name: string;
  price: string;
  cadence: string;
  items: string[];
  badge?: string;
  idealFor: string;
  volume: string;
  technicians: string;
  setupPaysFor: string;
  economy: string;
  installTime: string;
  support: string;
};

type Labels = {
  mostPopular: string;
  cta: string;
  forWhomLabel: string;
  includesLabel: string;
  setupLabel: string;
  monthlyLabel: string;
  comparisonTitle: string;
  comparisonSetup: string;
  comparisonMonthly: string;
  comparisonBestFor: string;
  comparisonTechs: string;
  whyRangeTitle: string;
  whyRangeBody: string;
  noSurprisesTitle: string;
  noSurprisesItems: string[];
  overageTitle: string;
  overageBody: string;
  dataOwnershipTitle: string;
  dataOwnershipBody: string;
  afterCancelTitle: string;
  afterCancelBody: string;
};

const ease = [0.22, 1, 0.36, 1] as const;

export function PricingExperience({
  tiers,
  labels,
}: {
  tiers: PricingTier[];
  labels: Labels;
}) {
  const [selected, setSelected] = useState(
    () => tiers.find((t) => t.badge)?.name ?? tiers[0]?.name ?? "",
  );

  const starterGrowth = tiers.filter((t) => t.name !== "Premium");
  const premium = tiers.find((t) => t.name === "Premium");

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {starterGrowth.map((tier, i) => (
          <PricingCard
            key={tier.name}
            tier={tier}
            index={i}
            selected={selected === tier.name}
            onSelect={() => setSelected(tier.name)}
            popularLabel={labels.mostPopular}
            cta={labels.cta}
            forWhomLabel={labels.forWhomLabel}
            includesLabel={labels.includesLabel}
            setupLabel={labels.setupLabel}
            monthlyLabel={labels.monthlyLabel}
          />
        ))}
      </div>

      {premium ? (
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.55, delay: 0.18, ease }}
          className={`mt-5 overflow-hidden border transition-[border-color,box-shadow] duration-300 ${
            selected === premium.name
              ? "border-orange/45 shadow-[0_24px_50px_-36px_rgba(12,20,30,0.55)]"
              : "border-[rgba(12,20,30,0.12)]"
          } bg-navy text-white`}
          onMouseEnter={() => setSelected(premium.name)}
        >
          <div className="grid items-stretch lg:grid-cols-[1.05fr_1.2fr]">
            <div className="border-b border-white/10 p-[clamp(28px,3.5vw,44px)] lg:border-r lg:border-b-0">
              <p className="text-[13px] font-medium text-orange">
                {labels.forWhomLabel}
              </p>
              <h2 className="mt-3 font-heading text-[clamp(28px,3vw,40px)] font-extrabold tracking-[-0.04em]">
                {premium.name}
              </h2>
              <p className="mt-4 max-w-[34em] text-[16px] leading-[1.6] text-white/72">
                {premium.idealFor}
              </p>
              <div className="mt-8 flex flex-wrap items-end gap-x-6 gap-y-2">
                <div>
                  <p className="text-[12px] text-white/45">{labels.setupLabel}</p>
                  <p className="font-heading text-[32px] font-extrabold tracking-[-0.035em]">
                    {premium.price}
                  </p>
                </div>
                <div>
                  <p className="text-[12px] text-white/45">{labels.monthlyLabel}</p>
                  <p className="text-[16px] font-semibold text-white/85">
                    {premium.cadence.replace(/^\+\s*/, "")}
                  </p>
                </div>
              </div>
              <p className="mt-5 max-w-[34em] text-[14.5px] leading-[1.55] text-orange/90">
                {premium.economy}
              </p>
              <CTAButton href="/book-audit" variant="ember" className="mt-8">
                {labels.cta}
              </CTAButton>
            </div>
            <div className="bg-ink-panel/60 p-[clamp(28px,3.5vw,44px)]">
              <MetaRows
                light
                volume={premium.volume}
                technicians={premium.technicians}
                setupPaysFor={premium.setupPaysFor}
                installTime={premium.installTime}
                support={premium.support}
              />
              <p className="mt-7 text-[12px] font-medium tracking-[0.04em] text-white/45 uppercase">
                {labels.includesLabel}
              </p>
              <ul className="mt-3 grid list-none gap-x-6 gap-y-0 p-0 sm:grid-cols-2">
                {premium.items.map((item, i) => (
                  <FeatureItem key={item} item={item} index={i} light />
                ))}
              </ul>
            </div>
          </div>
        </motion.div>
      ) : null}

      {/* Comparison */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.5, delay: 0.1, ease }}
        className="mt-[clamp(40px,5vw,64px)] overflow-x-auto border border-[rgba(12,20,30,0.1)] bg-white"
      >
        <p className="border-b border-[rgba(12,20,30,0.08)] px-5 py-4 text-[15px] font-semibold text-navy">
          {labels.comparisonTitle}
        </p>
        <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
          <thead>
            <tr className="border-b border-[rgba(12,20,30,0.08)] bg-paper/80">
              <th className="px-5 py-3 font-medium text-muted" />
              {tiers.map((tier) => (
                <th
                  key={tier.name}
                  className={`px-5 py-3 font-heading text-[16px] font-bold tracking-[-0.02em] text-navy ${
                    selected === tier.name ? "bg-[rgba(228,118,43,0.08)]" : ""
                  }`}
                >
                  {tier.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <CompareRow
              label={labels.comparisonSetup}
              values={tiers.map((t) => t.price)}
              selected={selected}
              names={tiers.map((t) => t.name)}
            />
            <CompareRow
              label={labels.comparisonMonthly}
              values={tiers.map((t) => t.cadence.replace(/^\+\s*/, ""))}
              selected={selected}
              names={tiers.map((t) => t.name)}
            />
            <CompareRow
              label={labels.comparisonBestFor}
              values={tiers.map((t) => t.idealFor)}
              selected={selected}
              names={tiers.map((t) => t.name)}
            />
            <CompareRow
              label={labels.comparisonTechs}
              values={tiers.map((t) => t.technicians)}
              selected={selected}
              names={tiers.map((t) => t.name)}
              last
            />
          </tbody>
        </table>
      </motion.div>

      <div
        className="mt-[clamp(28px,4vw,40px)] grid gap-6 border border-[rgba(12,20,30,0.1)] bg-white p-[clamp(24px,3vw,36px)]"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
        }}
      >
        <div>
          <p className="text-[14px] font-semibold text-navy">{labels.whyRangeTitle}</p>
          <p className="mt-2.5 text-[15px] leading-[1.6] text-secondary">
            {labels.whyRangeBody}
          </p>
        </div>
        <div>
          <p className="text-[14px] font-semibold text-navy">
            {labels.noSurprisesTitle}
          </p>
          <ul className="mt-2.5 flex list-none flex-col gap-2 p-0">
            {labels.noSurprisesItems.map((item) => (
              <li
                key={item}
                className="flex gap-2 text-[14.5px] leading-[1.5] text-secondary"
              >
                <span aria-hidden className="text-green">
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-5">
          <div>
            <p className="text-[14px] font-semibold text-navy">
              {labels.overageTitle}
            </p>
            <p className="mt-2.5 text-[14.5px] leading-[1.55] text-secondary">
              {labels.overageBody}
            </p>
          </div>
          <div>
            <p className="text-[14px] font-semibold text-navy">
              {labels.dataOwnershipTitle}
            </p>
            <p className="mt-2.5 text-[14.5px] leading-[1.55] text-secondary">
              {labels.dataOwnershipBody}
            </p>
          </div>
          <div>
            <p className="text-[14px] font-semibold text-navy">
              {labels.afterCancelTitle}
            </p>
            <p className="mt-2.5 text-[14.5px] leading-[1.55] text-secondary">
              {labels.afterCancelBody}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PricingCard({
  tier,
  index,
  selected,
  onSelect,
  popularLabel,
  cta,
  forWhomLabel,
  includesLabel,
  setupLabel,
  monthlyLabel,
}: {
  tier: PricingTier;
  index: number;
  selected: boolean;
  onSelect: () => void;
  popularLabel: string;
  cta: string;
  forWhomLabel: string;
  includesLabel: string;
  setupLabel: string;
  monthlyLabel: string;
}) {
  const popular = Boolean(tier.badge);

  return (
    <motion.article
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay: index * 0.08, ease }}
      onMouseEnter={onSelect}
      onFocus={onSelect}
      tabIndex={0}
      className={`relative flex flex-col border bg-white p-[clamp(26px,3vw,36px)] outline-none transition-[border-color,box-shadow,transform] duration-300 ${
        popular
          ? "border-orange/35 shadow-[0_28px_60px_-40px_rgba(228,118,43,0.55)]"
          : "border-[rgba(12,20,30,0.1)]"
      } ${
        selected
          ? "z-[1] -translate-y-1 border-[rgba(12,20,30,0.22)] shadow-[0_28px_50px_-36px_rgba(12,20,30,0.35)]"
          : "hover:-translate-y-1 hover:border-[rgba(12,20,30,0.18)] hover:shadow-[0_24px_44px_-34px_rgba(12,20,30,0.28)]"
      }`}
    >
      {popular ? (
        <motion.span
          initial={{ opacity: 0, scale: 0.92 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.25, duration: 0.35, ease }}
          className="absolute top-5 right-5 inline-flex items-center gap-1.5 rounded-full bg-[rgba(228,118,43,0.14)] px-3 py-1 text-[11px] font-semibold tracking-[0.04em] text-ember-text"
        >
          <span className="h-1.5 w-1.5 animate-tc-pulse rounded-full bg-orange" />
          {popularLabel}
        </motion.span>
      ) : null}

      {popular ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{
            boxShadow: selected
              ? "inset 0 0 0 1.5px rgba(228,118,43,0.45)"
              : "inset 0 0 0 1px rgba(228,118,43,0.28)",
          }}
        />
      ) : null}

      <div className={popular ? "pr-28" : ""}>
        <h2 className="m-0 font-heading text-[24px] font-bold tracking-[-0.03em] text-navy">
          {tier.name}
        </h2>
        <p className="mt-2 text-[14px] leading-[1.5] text-muted">
          <span className="font-medium text-secondary">{forWhomLabel}: </span>
          {tier.idealFor}
        </p>
      </div>

      <div className="mt-7 grid grid-cols-2 gap-4 border-t border-[rgba(12,20,30,0.08)] pt-6">
        <div>
          <p className="text-[12px] text-muted">{setupLabel}</p>
          <p className="mt-1 font-heading text-[clamp(26px,2.4vw,34px)] font-extrabold leading-[1.05] tracking-[-0.04em] text-navy">
            {tier.price}
          </p>
        </div>
        <div>
          <p className="text-[12px] text-muted">{monthlyLabel}</p>
          <p className="mt-1 font-heading text-[clamp(20px,2vw,26px)] font-extrabold leading-[1.15] tracking-[-0.03em] text-navy">
            {tier.cadence.replace(/^\+\s*/, "")}
          </p>
        </div>
      </div>

      <p className="mt-5 text-[14.5px] leading-[1.5] font-medium text-ember-text">
        {tier.economy}
      </p>

      <MetaRows
        volume={tier.volume}
        technicians={tier.technicians}
        setupPaysFor={tier.setupPaysFor}
        installTime={tier.installTime}
        support={tier.support}
      />

      <p className="mt-6 text-[12px] font-medium tracking-[0.04em] text-muted uppercase">
        {includesLabel}
      </p>
      <ul className="mt-2 flex flex-1 list-none flex-col p-0">
        {tier.items.map((item, i) => (
          <FeatureItem key={item} item={item} index={i} />
        ))}
      </ul>

      <CTAButton
        href="/book-audit"
        variant={popular ? "ember" : "outline"}
        size="md"
        className="mt-7"
      >
        {cta}
      </CTAButton>
    </motion.article>
  );
}

function FeatureItem({
  item,
  index,
  light = false,
}: {
  item: string;
  index: number;
  light?: boolean;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, x: -6 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.35, delay: 0.05 + index * 0.04, ease }}
      className={`flex items-start gap-2.5 border-t py-[10px] text-[14.5px] leading-[1.5] ${
        light
          ? "border-white/10 text-white/75"
          : "border-[rgba(12,20,30,0.08)] text-secondary"
      }`}
    >
      <motion.span
        initial={{ scale: 0.6, opacity: 0 }}
        whileInView={{ scale: 1, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.3, delay: 0.08 + index * 0.04, ease }}
        aria-hidden
        className="mt-0.5 shrink-0 text-[13px] text-green"
      >
        ✓
      </motion.span>
      {item}
    </motion.li>
  );
}

function MetaRows({
  volume,
  technicians,
  setupPaysFor,
  installTime,
  support,
  light = false,
}: {
  volume: string;
  technicians: string;
  setupPaysFor: string;
  installTime: string;
  support: string;
  light?: boolean;
}) {
  const rows = [volume, technicians, setupPaysFor, installTime, support];
  return (
    <ul
      className={`mt-5 flex list-none flex-col gap-1.5 border-t pt-4 p-0 ${
        light ? "border-white/12" : "border-[rgba(12,20,30,0.08)]"
      }`}
    >
      {rows.map((row) => (
        <li
          key={row}
          className={`text-[13px] leading-[1.45] ${
            light ? "text-white/55" : "text-muted"
          }`}
        >
          {row}
        </li>
      ))}
    </ul>
  );
}

function CompareRow({
  label,
  values,
  selected,
  names,
  last = false,
}: {
  label: string;
  values: string[];
  selected: string;
  names: string[];
  last?: boolean;
}) {
  return (
    <tr className={last ? "" : "border-b border-[rgba(12,20,30,0.08)]"}>
      <th className="px-5 py-3.5 align-top font-medium text-muted">{label}</th>
      {values.map((value, i) => (
        <td
          key={names[i]}
          className={`px-5 py-3.5 align-top leading-[1.45] text-secondary ${
            selected === names[i] ? "bg-[rgba(228,118,43,0.06)]" : ""
          }`}
        >
          {value}
        </td>
      ))}
    </tr>
  );
}
