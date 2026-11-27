"use client";

import { useId, useState } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

const ease = [0.22, 1, 0.36, 1] as const;

/** What both plans include, followed by the billing and product questions. */
export function PricingDetails({
  includesTitle,
  includesItems,
  details,
}: {
  includesTitle: string;
  includesItems: string[];
  details: { title: string; body: string }[];
}) {
  return (
    <section className="mx-auto mt-[clamp(28px,4vw,48px)] max-w-5xl">
      <div className="flex flex-col gap-4 border-t border-[rgb(var(--ink-rgb)/0.14)] pt-6 lg:flex-row lg:items-start lg:justify-between lg:gap-12">
        <h2 className="m-0 max-w-[10em] font-heading text-[clamp(22px,2.4vw,30px)] font-extrabold tracking-[-0.035em] text-heading">
          {includesTitle}
        </h2>
        <ul className="m-0 grid flex-1 list-none gap-x-8 p-0 sm:grid-cols-2">
          {includesItems.map((item) => (
            <li
              key={item}
              className="flex items-start gap-2.5 border-t border-[rgb(var(--ink-rgb)/0.1)] py-2.5 text-[15px] leading-[1.45] text-secondary"
            >
              <Check
                aria-hidden
                className="mt-[3px] h-4 w-4 shrink-0 text-signal-text"
                strokeWidth={2.25}
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 border-t border-[rgb(var(--ink-rgb)/0.14)]">
        {details.map((detail) => (
          <DetailAccordion
            key={detail.title}
            title={detail.title}
            body={detail.body}
          />
        ))}
      </div>
    </section>
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
        className="flex w-full items-center justify-between gap-6 py-4 text-left focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <span className="font-heading text-[17px] font-bold tracking-[-0.02em] text-heading">
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
        <p className="max-w-[42em] pb-4 text-[15.5px] leading-[1.65] text-muted">
          {body}
        </p>
      </motion.div>
    </div>
  );
}
