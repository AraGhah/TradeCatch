"use client";

import { CTAButton } from "@/components/CTAButton";

/**
 * Mobile-only sticky audit CTA for pricing.
 * Uses --tc-cookie-offset (set by CookieConsent) so it sits above the banner.
 */
export function StickyAuditCta({ label }: { label: string }) {
  return (
    <div
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
