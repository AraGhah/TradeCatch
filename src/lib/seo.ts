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
        "en-CA": `${SITE_URL}${enPath}`,
        "fr-CA": `${SITE_URL}${frPath}`,
        "x-default": `${SITE_URL}${enPath}`,
      },
    },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}${currentPath}`,
      siteName: "TradeCatch",
      locale: locale === "fr" ? "fr_CA" : "en_CA",
      type: "website",
      // No public OG image asset exists yet; omit images rather than publish a
      // broken or misleading social preview URL.
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}
