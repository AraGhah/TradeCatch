import { getTranslations } from "next-intl/server";
import { isDemoModeVisible } from "@/lib/environment";

/**
 * Persistent staging / demo indicator. Shown on every page when the host is
 * marked staging or NEXT_PUBLIC_DEMO_MODE=1. Intentionally high-contrast and
 * non-dismissible so operators never mistake demo data for live customers.
 */
export async function DemoModeBanner() {
  if (!isDemoModeVisible()) return null;

  const t = await getTranslations("demoMode");

  return (
    <div
      role="status"
      aria-live="polite"
      data-tradecatch-demo-mode="1"
      className="sticky top-0 z-[80] border-b border-[rgb(120_60_0/0.35)] bg-[rgb(255_186_73)] text-[rgb(40_24_0)]"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm md:px-6">
        <p className="font-semibold tracking-wide">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em]">
            {t("badge")}
          </span>
          <span className="mx-2 text-[rgb(40_24_0/0.45)]" aria-hidden>
            ·
          </span>
          <span className="font-medium">{t("message")}</span>
        </p>
        <p className="text-xs text-[rgb(40_24_0/0.75)]">{t("hint")}</p>
      </div>
    </div>
  );
}
