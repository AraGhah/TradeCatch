import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tradecatch.ca";

// Fixed content revision date — bump when marketing copy/structure meaningfully
// changes. Avoid `new Date()` which reports "just modified" on every build.
const CONTENT_LAST_MODIFIED = new Date("2026-07-26");

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
        lastModified: CONTENT_LAST_MODIFIED,
        changeFrequency: "monthly" as const,
        priority: path === "/" ? 1 : 0.7,
      };
    }),
  );
}
