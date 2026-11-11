import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/** App-area 404: Next sets HTTP 404 when this renders via notFound(). */
export default async function AppNotFound() {
  const t = await getTranslations("notFound");
  return (
    <section className="rounded-md border border-navy/10 bg-white px-4 py-10 text-center">
      <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
        {t("title")}
      </h1>
      <p className="mt-3 text-sm text-navy/70">{t("body")}</p>
      <p className="mt-6">
        <Link href="/app" className="text-sm font-semibold text-navy underline">
          {t("appCta")}
        </Link>
      </p>
    </section>
  );
}
