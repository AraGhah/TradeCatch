import { getTranslations, setRequestLocale } from "next-intl/server";
import { Container } from "@/components/Container";
import { HelpCatalog } from "@/components/support/HelpCatalog";

export default async function PublicHelpPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("app.help");
  return (
    <Container className="py-12">
      <h1 className="font-[family-name:var(--font-archivo)] text-3xl font-extrabold text-navy">{t("headline")}</h1>
      <p className="mt-2 max-w-2xl text-sm text-navy/70">{t("publicIntro")}</p>
      <div className="mt-6">
        <HelpCatalog locale={locale === "fr" ? "fr" : "en"} query={q ?? ""} base="public" />
      </div>
    </Container>
  );
}
