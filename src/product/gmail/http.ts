import { NextResponse } from "next/server";
import { getPathname } from "@/i18n/pathname";
import { readGmailEnv } from "./oauth";

export type GmailLocale = "en" | "fr";

/** Notice codes the settings page is allowed to render; anything else is ignored. */
export const GMAIL_NOTICES = [
  "connected",
  "denied",
  "needs_reconnect",
  "rate_limited",
  "sync_failed",
  "config_error",
  "not_configured",
] as const;
export type GmailNotice = (typeof GMAIL_NOTICES)[number];

export function asNotice(value: string | null | undefined): GmailNotice | null {
  return GMAIL_NOTICES.find((notice) => notice === value) ?? null;
}

/**
 * Absolute URL on the configured public origin. `request.url` is not used for
 * redirects because behind the Worker it can be an internal address.
 */
export function siteRedirect(
  pathname: "/app/settings" | "/login" | "/app/mail",
  locale: GmailLocale,
  notice?: GmailNotice,
): NextResponse {
  const base = readGmailEnv().siteUrl || "http://localhost:3000";
  const url = new URL(getPathname({ href: pathname, locale }), `${base}/`);
  if (notice) url.searchParams.set("gmail", notice);
  return NextResponse.redirect(url);
}

/**
 * Defence in depth for cookie-authenticated POSTs (the session cookie is
 * SameSite=Lax already): refuse a request whose Origin is another site.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    return new URL(origin).host === host || origin === readGmailEnv().siteUrl;
  } catch {
    return false;
  }
}

export function forbiddenOrigin() {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

/** RFC 6266 header that survives non-ASCII and quote/CRLF characters in a filename. */
export function attachmentDisposition(filename: string): string {
  const clean = filename.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "attachment";
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}
