"use client";

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
  const pathname = usePathname();
  const isPilotShell =
    pathname === "/login" ||
    pathname === "/app" ||
    pathname.startsWith("/app/");

  return (
    <>
      {isPilotShell ? null : header}
      <main className="flex-1">{children}</main>
      {isPilotShell ? null : footer}
    </>
  );
}
