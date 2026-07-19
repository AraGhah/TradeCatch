"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

export function MobileNav({
  links,
  ctaLabel,
}: {
  links: { href: string; label: string }[];
  ctaLabel: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-10 items-center justify-center rounded-md border border-navy/15 text-navy"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>

      {open ? (
        <div className="absolute inset-x-0 top-16 border-b border-navy/10 bg-white px-6 py-6 shadow-lg">
          <nav className="flex flex-col gap-4">
            {links.map((link) => (
              <Link
                key={link.href}
                // @ts-expect-error - href comes from a typed union at call sites
                href={link.href}
                onClick={() => setOpen(false)}
                className="text-base font-medium text-text"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="mt-6 flex items-center justify-between">
            <LocaleSwitcher />
            <Link
              href="/book-audit"
              onClick={() => setOpen(false)}
              className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white"
            >
              {ctaLabel}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
