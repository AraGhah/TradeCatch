"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useParams } from "next/navigation";

export function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams();

  function switchTo(nextLocale: string) {
    router.replace(
      // @ts-expect-error - pathname is a known route pattern at runtime
      { pathname, params },
      { locale: nextLocale }
    );
  }

  return (
    <div className="flex items-center gap-1 text-sm font-medium">
      <button
        type="button"
        onClick={() => switchTo("en")}
        aria-current={locale === "en" ? "true" : undefined}
        aria-label="Switch to English"
        className={`rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
          locale === "en" ? "bg-navy text-white" : "text-navy/70 hover:text-navy"
        }`}
      >
        EN
      </button>
      <span className="text-navy/20" aria-hidden>/</span>
      <button
        type="button"
        onClick={() => switchTo("fr")}
        aria-current={locale === "fr" ? "true" : undefined}
        aria-label="Passer au français"
        className={`rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
          locale === "fr" ? "bg-navy text-white" : "text-navy/70 hover:text-navy"
        }`}
      >
        FR
      </button>
    </div>
  );
}
