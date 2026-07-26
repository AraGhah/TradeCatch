"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useParams } from "next/navigation";

export function LocaleSwitcher({ inverted = false }: { inverted?: boolean }) {
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
    <div
      className={`inline-flex items-center rounded-full p-0.5 ${
        inverted
          ? "bg-white/10"
          : "bg-[rgba(12,20,30,0.06)]"
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
                  : "text-muted hover:text-navy"
            }`}
          >
            {code.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
