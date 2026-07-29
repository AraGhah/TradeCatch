"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { BrandLockup } from "@/components/BrandLockup";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:ring-offset-2";

export function MobileNav({
  links,
  ctaLabel,
  phone,
  phoneHref,
}: {
  links: { href: string; label: string }[];
  ctaLabel: string;
  phone: string;
  phoneHref: string;
}) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
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
    toggleButtonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const overlay = open ? (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[80] flex flex-col bg-navy animate-tc-in"
    >
      <div className="flex h-(--header-h) items-center justify-between px-[clamp(20px,4vw,40px)]">
        <BrandLockup inverted />
        <span id={titleId} className="sr-only">
          {t("mobileNav")}
        </span>
        <button
          ref={closeButtonRef}
          type="button"
          aria-label={t("close")}
          onClick={close}
          className={`flex h-[42px] w-[42px] items-center justify-center rounded-[10px] text-white ${FOCUS_RING}`}
        >
          <span className="text-[22px] leading-none" aria-hidden>
            &#215;
          </span>
        </button>
      </div>

      <nav className="flex flex-1 flex-col overflow-y-auto px-[clamp(20px,4vw,40px)] pt-4">
        {links.map((link) => (
          <Link
            key={link.href}
            // @ts-expect-error - href comes from a typed union at call sites
            href={link.href}
            onClick={close}
            className={`border-b border-white/[0.09] py-5 font-heading text-[26px] font-bold tracking-[-0.03em] text-white ${FOCUS_RING}`}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="px-[clamp(20px,4vw,40px)] pb-10 pt-6">
        <div className="mb-5">
          <LocaleSwitcher inverted />
        </div>
        <a
          href={`tel:${phoneHref}`}
          onClick={close}
          className={`mb-4 block font-mono text-[14px] text-[rgba(255,255,255,0.64)] ${FOCUS_RING}`}
        >
          {phone}
        </a>
        <Link
          href="/book-audit"
          onClick={close}
          className={`flex w-full items-center justify-center gap-2.5 rounded-[12px] bg-orange px-6 py-4 text-[16px] font-bold text-navy shadow-cta ${FOCUS_RING}`}
        >
          {ctaLabel}
        </Link>
      </div>
    </div>
  ) : null;

  return (
    <div>
      <button
        ref={toggleButtonRef}
        type="button"
        aria-label={open ? t("closeMenu") : t("menu")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-[42px] w-[42px] flex-col items-center justify-center gap-[6px] rounded-[10px] border border-[rgba(12,20,30,0.14)] ${FOCUS_RING}`}
      >
        <span className="block h-[1.8px] w-[17px] rounded-full bg-navy" />
        <span className="block h-[1.8px] w-[17px] rounded-full bg-navy" />
      </button>

      {mounted && open ? createPortal(overlay, document.body) : null}
    </div>
  );
}
