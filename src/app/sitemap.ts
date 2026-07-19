import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tradecatch.ca";

const PATHS = Object.keys(routing.pathnames);

export default function sitemap(): MetadataRoute.Sitemap {
  return routing.locales.flatMap((locale) =>
    PATHS.map((path) => {
      const pathnames = routing.pathnames[path as keyof typeof routing.pathnames];
      const localizedPath =
        typeof pathnames === "string" ? pathnames : pathnames[locale];

      return {
        url: `${SITE_URL}${locale === routing.defaultLocale ? "" : `/${locale}`}${
          localizedPath === "/" ? "" : localizedPath
        }`,
        lastModified: new Date(),
        changeFrequency: "monthly" as const,
        priority: path === "/" ? 1 : 0.7,
      };
    })
  );
}
