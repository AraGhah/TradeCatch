"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LocaleSwitcher({ inverted = false }: { inverted?: boolean }) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function switchTo(nextLocale: string) {
    // Pass locale only via the options object. Including `locale` from
    // useParams() in the href object can produce a soft-nav to `/en`, which
    // next-intl then redirects away under localePrefix: "as-needed" and
    // breaks the RSC payload fetch.
    router.replace(pathname, { locale: nextLocale });
  }

  return (
    <div
      className={`inline-flex items-center rounded-full p-0.5 ${
        inverted
          ? "bg-white/10"
          : "bg-[rgb(var(--ink-rgb)/0.06)]"
      }`}
      role="group"
      aria-label="Language"
    >
      {(["en", "fr"] as const).map((code) => {
        const active = locale === code;
        return (
          <button
            key={code}
            type="button"
            onClick={() => switchTo(code)}
            aria-current={active ? "true" : undefined}
            aria-label={code === "en" ? "Switch to English" : "Passer au français"}
            className={`rounded-full px-2.5 py-1 font-mono text-[12px] font-medium tracking-wide transition-colors ${
              active
                ? inverted
                  ? "bg-white text-navy"
                  : "bg-navy text-white"
                : inverted
                  ? "text-white/70 hover:text-white"
                  : "text-muted hover:text-heading"
            }`}
          >
            {code.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
