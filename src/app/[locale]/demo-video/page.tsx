import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { DemoVideoExperience } from "@/components/demo-video/DemoVideoExperience";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "demoVideo" });
  return {
    ...buildMetadata({
      locale,
      pathname: "/demo-video",
      title: t("title"),
      description: t("description"),
    }),
    robots: { index: false, follow: false },
  };
}

export default async function DemoVideoPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <DemoVideoExperience />;
}
