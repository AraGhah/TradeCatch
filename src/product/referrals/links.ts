import { getPathname } from "@/i18n/pathname";

/** The public domain share links are built on: the configured site, never the request's host. */
export function publicOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  try {
    if (configured) return new URL(configured).origin;
  } catch {
    // A malformed value falls through to the production domain.
  }
  return "https://tradecatch.ca";
}

/** The shareable link for a referral code, in the reader's language. */
export function referralUrl(code: string, locale: "en" | "fr"): string {
  return `${publicOrigin()}${getPathname({ href: "/referral", locale })}?ref=${encodeURIComponent(code)}`;
}
