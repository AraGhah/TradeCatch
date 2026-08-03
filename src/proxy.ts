import createMiddleware from "next-intl/middleware";
import { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const handleI18n = createMiddleware(routing);

function buildCsp(nonce: string, isDev: boolean): string {
  // Nonce + strict-dynamic: trusted scripts may load further scripts (e.g. gtag).
  // style-src keeps 'unsafe-inline' for Tailwind/runtime styles until hashed
  // style extraction is complete — tracked as hardening, not a known XSS vector.
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "https://www.googletagmanager.com",
    "https://challenges.cloudflare.com",
    isDev ? "'unsafe-eval'" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://www.google-analytics.com",
    "font-src 'self'",
    "connect-src 'self' https://www.google-analytics.com https://analytics.google.com https://challenges.cloudflare.com",
    // Only for the optional post-audit calendar embed (CalendarBookingCta) —
    // limited to the two hosts it actually allows iframing (cal.com,
    // calendly.com); anything else falls back to a plain new-tab link.
    "frame-src https://challenges.cloudflare.com https://cal.com https://calendly.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * Pass the original NextRequest into next-intl (never rebuild from URL alone —
 * that drops internal routing metadata and causes self-redirect loops).
 * Prefer mutating headers on the incoming request; fall back to cloning from
 * the request object (not request.url) so nextUrl / cookies stay intact.
 *
 * Production note: do not bind `next start` to `127.0.0.1` / `0.0.0.0` when
 * using next-intl locale/pathname rewrites. Next.js 16.2.6+ can leak those
 * rewrites as 307 self-redirects (vercel/next.js#94745). Prefer the default
 * hostname (`localhost`) or omit `--hostname`.
 */
export default function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const csp = buildCsp(nonce, isDev);

  try {
    request.headers.set("x-nonce", nonce);
  } catch {
    // Some runtimes expose immutable headers — clone from the Request object.
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    const cloned = new NextRequest(request, { headers });
    const response = handleI18n(cloned);
    response.headers.set("Content-Security-Policy", csp);
    response.headers.set("x-nonce", nonce);
    return response;
  }

  const response = handleI18n(request);
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-nonce", nonce);
  return response;
}

export const config = {
  // Exclude API, Next internals, static files (with extension), and
  // generated app icons so they are never rewritten into a locale path.
  matcher: [
    "/((?!api|trpc|_next|_vercel|icon|apple-icon|favicon\\.ico|.*\\..*).*)",
  ],
};
