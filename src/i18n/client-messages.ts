import type { AbstractIntlMessages } from "next-intl";

/**
 * Namespaces read by client components on the public marketing pages. Server
 * components read the catalog on the server and never need these. Anything
 * a client component calls `useTranslations("x")` on must be listed here,
 * otherwise it renders the raw key. The signed-in app, admin and login pages
 * get the full catalog instead (see FullMessagesProvider).
 */
export const PUBLIC_CLIENT_NAMESPACES = [
  "site",
  "nav",
  "cta",
  "cookieBanner",
  "emailContact",
  "errors",
  "bookAudit",
  "demoVideo",
  "demoMode",
  "onePager",
  "referrals",
  "websiteRequest",
] as const;

export function pickMessages(
  messages: AbstractIntlMessages,
  namespaces: readonly string[],
): AbstractIntlMessages {
  const picked: AbstractIntlMessages = {};
  for (const namespace of namespaces) {
    if (namespace in messages) picked[namespace] = messages[namespace];
  }
  return picked;
}
