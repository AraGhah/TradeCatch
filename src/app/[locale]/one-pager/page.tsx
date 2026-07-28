import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { OnePagerContent } from "@/components/OnePagerContent";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "onePager" });
  return buildMetadata({
    locale,
    pathname: "/one-pager",
    title: t("title"),
    description: t("metaDescription"),
  });
}

export default async function OnePagerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <OnePagerContent />;
}
