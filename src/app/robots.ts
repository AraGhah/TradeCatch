import type { MetadataRoute } from "next";
import { isDemoModeVisible } from "@/lib/environment";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tradecatch.ca";

export default function robots(): MetadataRoute.Robots {
  if (isDemoModeVisible()) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
