import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isCrossSiteMutation } from "./lib/csrf";
import { contentLengthExceeds } from "./lib/request-body";
import { routing } from "./i18n/routing";
import { enforceStagingAccess } from "./lib/staging-middleware";

const handleI18n = createMiddleware(routing);

// Most /api/* routes read the body directly with request.json()/formData(),
// which buffers the whole payload before any validation runs. A handful of
// routes already bound their own read (see src/lib/request-body.ts); this is
// the backstop for the rest, rejecting a declared oversized body before it
// reaches any handler. No route under /api/* legitimately needs a request
// body (as opposed to a response) over this size.
const DEFAULT_MAX_API_BODY_BYTES = 2 * 1024 * 1024;
// The few routes that really take a file. Each also bounds its own read.
const LARGE_BODY_ROUTES: Record<string, number> = {
  // Voice sample (up to 10 MB) plus multipart framing.
  "/api/app/receptionist/voice/clone": 11 * 1024 * 1024,
};
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Hostnames this deployment answers to: what the request was sent to, and the configured public site. */
function acceptedHosts(request: NextRequest): Array<string | null> {
  let site: string | null = null;
  try {
    const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    site = configured ? new URL(configured).host : null;
  } catch {
    site = null;
  }
  return [request.nextUrl.host, request.headers.get("host"), request.headers.get("x-forwarded-host"), site];
}

/**
 * Staging HTTP Basic gate (when configured) + locale routing.
 *
 * Next.js Proxy uses the default Node.js runtime. The installed OpenNext
 * adapter bundles this entry point for Cloudflare Workers.
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
export default function proxy(request: NextRequest) {
  const stagingGate = enforceStagingAccess(request);
  if (stagingGate) return stagingGate;

  // API routes must not go through next-intl locale rewrites.
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/")) {
    // Second layer behind SameSite cookies; see src/lib/csrf.ts.
    if (isCrossSiteMutation({ method: request.method, headers: request.headers, hosts: acceptedHosts(request) })) {
      return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
    }
    if (
      BODY_METHODS.has(request.method) &&
      contentLengthExceeds(
        request,
        LARGE_BODY_ROUTES[path] ?? DEFAULT_MAX_API_BODY_BYTES,
      )
    ) {
      return NextResponse.json({ error: "Payload too large." }, { status: 413 });
    }
    return NextResponse.next();
  }
  if (path === "/health" || path === "/ready") {
    return NextResponse.next();
  }

  return handleI18n(request);
}

export const config = {
  // Include API paths so the staging Basic gate can protect them. Locale
  // rewrites still skip /api via the handler above.
  matcher: [
    "/((?!_next|_vercel|icon|apple-icon|favicon\\.ico|.*\\..*).*)",
  ],
};
