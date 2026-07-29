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
    "frame-src https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export default function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = handleI18n(
    new NextRequest(request.url, {
      headers: requestHeaders,
    }),
  );

  response.headers.set("Content-Security-Policy", buildCsp(nonce, isDev));
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
