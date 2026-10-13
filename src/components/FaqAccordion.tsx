"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const ease = [0.22, 1, 0.36, 1] as const;

export function FaqAccordion({
  items,
  bordered = false,
}: {
  items: { q: string; a: string }[];
  bordered?: boolean;
}) {
  const [open, setOpen] = useState<number>(-1);
  const baseId = useId();

  return (
    <div
      className={
        bordered
          ? "rounded-[18px] border border-[rgb(var(--ink-rgb)/0.1)] bg-surface px-6"
          : ""
      }
    >
      {items.map((item, i) => {
        const isOpen = open === i;
        const panelId = `${baseId}-panel-${i}`;
        const buttonId = `${baseId}-button-${i}`;
        return (
          <div
            key={item.q}
            className="border-b border-[rgb(var(--ink-rgb)/0.12)] last:border-b-0"
          >
            <button
              type="button"
              id={buttonId}
              onClick={() => setOpen(isOpen ? -1 : i)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className="group flex w-full items-center justify-between gap-4 py-[22px] text-left"
            >
              <span className="font-heading text-[17px] font-semibold tracking-[-0.02em] text-heading transition-colors duration-200 group-hover:text-ember-text sm:text-[18.5px]">
                {item.q}
              </span>
              <motion.span
                className="shrink-0 font-mono text-[18px] font-medium text-ember-text"
                aria-hidden
                animate={{ rotate: isOpen ? 45 : 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 26 }}
              >
                +
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen ? (
                <motion.div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease }}
                  className="overflow-hidden"
                >
                  <p className="pb-6 text-[15px] leading-[1.65] text-muted">
                    {item.a}
                  </p>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
