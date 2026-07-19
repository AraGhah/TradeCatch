import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal.cookiePolicy" });
  return buildMetadata({
    locale,
    pathname: "/cookie-policy",
    title: t("title"),
    description: t("metaDescription"),
  });
}

export default async function CookiePolicyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("legal.cookiePolicy");

  return (
    <LegalDocument
      title={t("title")}
      sections={t.raw("sections") as { heading: string; body: string }[]}
    />
  );
}
