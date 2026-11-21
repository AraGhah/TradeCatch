/**
 * Headers for the page an emailed set-password link opens. The secret is in the
 * URL fragment, so no server sees it, but the page itself must still never be
 * cached, indexed, or reported as the referrer of a later request (for example
 * if a link on the page were followed). Used by next.config.ts for the English
 * and French paths. The document CSP from the catch-all rule still applies.
 */
export const passwordLinkPageHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

/** The two public addresses of the page (English and French). */
export const PASSWORD_LINK_PAGE_PATHS = [
  "/set-password",
  "/fr/definir-mot-de-passe",
] as const;
