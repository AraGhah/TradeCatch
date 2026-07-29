"use client";

import { useEffect, useRef } from "react";
import { CTAButton } from "@/components/CTAButton";

/**
 * Mobile-only sticky audit CTA for pricing.
 * Uses --tc-cookie-offset (set by CookieConsent) so it sits above the banner.
 * Also reserves body padding so footer content is not covered.
 */
export function StickyAuditCta({ label }: { label: string }) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;

    const apply = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty(
        "--tc-sticky-cta-offset",
        `${height}px`,
      );
      document.body.style.paddingBottom =
        "calc(var(--tc-cookie-offset, 0px) + var(--tc-sticky-cta-offset, 0px))";
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.setProperty("--tc-sticky-cta-offset", "0px");
      document.body.style.paddingBottom =
        "calc(var(--tc-cookie-offset, 0px) + var(--tc-sticky-cta-offset, 0px))";
    };
  }, []);

  return (
    <div
      ref={barRef}
      className="pointer-events-none fixed inset-x-0 z-40 p-3 md:hidden"
      style={{ bottom: "var(--tc-cookie-offset, 0px)" }}
    >
      <div className="pointer-events-auto mx-auto max-w-lg border border-[rgba(12,20,30,0.12)] bg-white/95 p-3 shadow-[0_-8px_30px_-18px_rgba(12,20,30,0.35)] backdrop-blur-sm">
        <CTAButton href="/book-audit" variant="ember" className="w-full">
          {label}
        </CTAButton>
      </div>
    </div>
  );
}
