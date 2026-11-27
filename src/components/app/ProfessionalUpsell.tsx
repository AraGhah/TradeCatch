"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

/** A quiet note on the Essential overview about what Professional adds. No modal, no nagging. */
export function ProfessionalUpsell() {
  const t = useTranslations("app");
  return (
    <aside className="rounded-xl border border-navy/10 bg-white p-5 shadow-[0_1px_2px_rgb(12_20_30/0.04)] sm:p-6">
      <p className="text-sm font-semibold text-navy">{t("upsell.title")}</p>
      <p className="mt-1 text-sm text-navy/70">{t("upsell.body")}</p>
      <Link
        href="/pricing"
        className="mt-3 inline-flex text-sm font-semibold text-navy underline underline-offset-2"
      >
        {t("upsell.cta")}
      </Link>
    </aside>
  );
}
