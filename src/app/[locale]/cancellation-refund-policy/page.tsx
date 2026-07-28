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
  const t = await getTranslations({
    locale,
    namespace: "legal.cancellationRefundPolicy",
  });
  return buildMetadata({
    locale,
    pathname: "/cancellation-refund-policy",
    title: t("title"),
    description: t("metaDescription"),
  });
}

export default async function CancellationRefundPolicyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("legal.cancellationRefundPolicy");

  return (
    <LegalDocument
      title={t("title")}
      sections={t.raw("sections") as { heading: string; body: string }[]}
    />
  );
}
