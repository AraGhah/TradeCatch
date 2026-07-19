"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/50 focus-visible:ring-offset-2";

export function MobileNav({
  links,
  ctaLabel,
}: {
  links: { href: string; label: string }[];
  ctaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // document.body only exists on the client; the portal can't render during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  function close() {
    setOpen(false);
    // Return focus to the toggle button so keyboard users don't lose their
    // place once the panel (and everything inside it) unmounts.
    toggleButtonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const overlay = (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
            aria-hidden="true"
            className="fixed left-0 right-0 top-16 bottom-0 z-40 bg-navy/30 backdrop-blur-[1px]"
          />
          <motion.div
            key="panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
            className="fixed right-0 top-16 bottom-0 z-40 flex w-full max-w-sm flex-col gap-6 overflow-y-auto border-l border-navy/10 bg-white p-6 shadow-2xl"
          >
            <nav className="flex flex-col gap-1">
              {links.map((link) => (
                <Link
                  key={link.href}
                  // @ts-expect-error - href comes from a typed union at call sites
                  href={link.href}
                  onClick={close}
                  className={`rounded-md px-3 py-3 text-base font-medium text-text active:bg-bg ${FOCUS_RING}`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="flex items-center justify-between border-t border-navy/10 pt-6">
              <LocaleSwitcher />
            </div>
            <Link
              href="/book-audit"
              onClick={close}
              className={`rounded-lg bg-orange px-4 py-3 text-center text-sm font-semibold text-navy shadow-cta ${FOCUS_RING}`}
            >
              {ctaLabel}
            </Link>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );

  return (
    <div className="lg:hidden">
      <button
        ref={toggleButtonRef}
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`relative flex h-10 w-10 items-center justify-center rounded-md border border-navy/15 text-navy ${FOCUS_RING}`}
      >
        <span className="relative block h-4 w-5">
          <motion.span
            className="absolute left-0 top-0 block h-0.5 w-5 rounded-full bg-navy"
            animate={open ? { rotate: 45, y: 7 } : { rotate: 0, y: 0 }}
            transition={{ duration: 0.2 }}
          />
          <motion.span
            className="absolute left-0 top-[7px] block h-0.5 w-5 rounded-full bg-navy"
            animate={open ? { opacity: 0 } : { opacity: 1 }}
            transition={{ duration: 0.15 }}
          />
          <motion.span
            className="absolute left-0 top-[14px] block h-0.5 w-5 rounded-full bg-navy"
            animate={open ? { rotate: -45, y: -7 } : { rotate: 0, y: 0 }}
            transition={{ duration: 0.2 }}
          />
        </span>
      </button>

      {mounted ? createPortal(overlay, document.body) : null}
    </div>
  );
}
