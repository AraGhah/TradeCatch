"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";

/**
 * Hides marketing Header/Footer on the founder pilot shell (/login, /app/*)
 * so the contractor workspace does not look like the public site chrome.
 */
export function MarketingChrome({
  header,
  footer,
  children,
}: {
  header: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const isPilotShell =
    pathname === "/login" ||
    pathname === "/app" ||
    pathname.startsWith("/app/");

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-[100] focus-visible:rounded-md focus-visible:bg-navy focus-visible:px-4 focus-visible:py-3 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-white focus-visible:shadow-lg focus-visible:outline-2 focus-visible:outline-orange focus-visible:outline-offset-2"
      >
        {t("skipToContent")}
      </a>
      {isPilotShell ? null : header}
      <main id="main-content" tabIndex={-1} className="flex-1">
        {children}
      </main>
      {isPilotShell ? null : footer}
    </>
  );
}
