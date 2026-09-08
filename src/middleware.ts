import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const handleI18n = createMiddleware(routing);

/**
 * Locale routing only.
 *
 * Next.js 16 deprecates this filename in favour of `proxy.ts`, but Proxy is
 * Node-runtime only. OpenNext Cloudflare 1.20 does not support Node middleware,
 * so the documented Edge-runtime compatibility path is intentionally retained.
 *
 * Do NOT set a per-request CSP nonce here. On OpenNext Cloudflare, HTML/assets
 * can be served with a different nonce than the middleware CSP header; with
 * 'strict-dynamic' that mismatch blocks all client JS (dead buttons/menus).
 * Document CSP lives in next.config.ts instead.
 *
 * Production note: do not bind `next start` to `127.0.0.1` / `0.0.0.0` when
 * using next-intl locale/pathname rewrites. Next.js 16.2.6+ can leak those
 * rewrites as 307 self-redirects (vercel/next.js#94745). Prefer the default
 * hostname (`localhost`) or omit `--hostname`.
 */
export default function middleware(request: NextRequest) {
  return handleI18n(request);
}

// Legacy middleware requires this value in Next 16; `edge` is rejected during
// build even though both names refer to the Edge runtime.
export const runtime = "experimental-edge";

export const config = {
  // Exclude API, Next internals, static files (with extension), and
  // generated app icons so they are never rewritten into a locale path.
  matcher: [
    "/((?!api|trpc|_next|_vercel|icon|apple-icon|favicon\\.ico|.*\\..*).*)",
  ],
};
