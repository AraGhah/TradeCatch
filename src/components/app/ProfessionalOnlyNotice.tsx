import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/**
 * Shown in place of an appointments page on the Essential plan. The server
 * refuses the same requests (requireSchedulingAccess); this is the readable
 * version of that refusal for someone who followed an old link.
 */
export async function ProfessionalOnlyNotice() {
  const t = await getTranslations("app.professionalOnly");
  return (
    <section className="max-w-xl rounded-md border border-navy/10 bg-white px-5 py-5">
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
        {t("title")}
      </h1>
      <p className="mt-2 text-navy/70">{t("body")}</p>
      <Link
        href="/pricing"
        className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-navy underline underline-offset-2"
      >
        {t("cta")}
      </Link>
    </section>
  );
}
