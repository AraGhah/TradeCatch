"use client";

import { useState } from "react";

export function FaqAccordion({
  items,
  bordered = false,
}: {
  items: { q: string; a: string }[];
  bordered?: boolean;
}) {
  const [open, setOpen] = useState<number>(-1);

  return (
    <div
      className={
        bordered
          ? "rounded-[18px] border border-[rgba(12,20,30,0.1)] bg-white px-6"
          : ""
      }
    >
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div
            key={item.q}
            className="border-b border-[rgba(12,20,30,0.12)] last:border-b-0"
          >
            <button
              type="button"
              onClick={() => setOpen(isOpen ? -1 : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 py-[22px] text-left"
            >
              <span className="font-heading text-[17px] font-semibold tracking-[-0.02em] text-navy sm:text-[18.5px]">
                {item.q}
              </span>
              <span
                className="shrink-0 font-mono text-[18px] font-medium text-ember-text"
                aria-hidden
              >
                {isOpen ? "−" : "+"}
              </span>
            </button>
            {isOpen ? (
              <p className="animate-tc-in pb-6 text-[15px] leading-[1.65] text-muted">
                {item.a}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
