import { getPathname } from "@/i18n/pathname";

/** The shareable link for a referral code, in the reader's language. */
export function referralUrl(code: string, locale: "en" | "fr"): string {
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tradecatch.ca").replace(
    /\/$/,
    "",
  );
  return `${origin}${getPathname({ href: "/referral", locale })}?ref=${encodeURIComponent(code)}`;
}
