"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

/** Tasteful Growth upsell — no modal spam. */
export function GrowthUpsell() {
  const t = useTranslations("app");
  return (
    <aside className="rounded-md border border-navy/10 bg-white px-5 py-4">
      <p className="text-sm font-semibold text-navy">{t("upsell.title")}</p>
      <p className="mt-1 text-sm text-navy/70">{t("upsell.body")}</p>
      <Link
        href="/pricing"
        className="mt-3 inline-flex text-sm font-semibold text-orange underline-offset-2 hover:underline"
      >
        {t("upsell.cta")}
      </Link>
    </aside>
  );
}
