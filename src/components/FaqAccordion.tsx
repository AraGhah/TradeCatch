"use client";

import { useState } from "react";

export function FaqAccordion({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="divide-y divide-navy/10 rounded-xl border border-navy/10 bg-white shadow-sm">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
            >
              <span className="font-semibold text-navy">{item.q}</span>
              <span className="shrink-0 text-xl text-blue">{isOpen ? "−" : "+"}</span>
            </button>
            {isOpen ? (
              <p className="px-6 pb-5 text-sm leading-relaxed text-text/80">{item.a}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
