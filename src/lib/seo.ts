import type { Metadata } from "next";
import { getPathname } from "@/i18n/navigation";
import type { AppPathnames } from "@/i18n/routing";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tradecatch.ca";

export function buildMetadata({
  locale,
  pathname,
  title,
  description,
}: {
  locale: string;
  pathname: AppPathnames;
  title: string;
  description?: string;
}): Metadata {
  const enPath = getPathname({ href: pathname, locale: "en" });
  const frPath = getPathname({ href: pathname, locale: "fr" });
  const currentPath = locale === "fr" ? frPath : enPath;

  return {
    title,
    description,
    alternates: {
      canonical: `${SITE_URL}${currentPath}`,
      languages: {
        en: `${SITE_URL}${enPath}`,
        fr: `${SITE_URL}${frPath}`,
      },
    },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}${currentPath}`,
      siteName: "TradeCatch",
      locale,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}
