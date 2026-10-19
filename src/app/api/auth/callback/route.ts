import { NextRequest, NextResponse } from "next/server";
import { getClientIp, rateLimitAsync } from "@/lib/rate-limit";
import {
  consumeMagicLinkAndCreateSession,
  sessionCookieOptions,
} from "@/product/saas/auth/magic-link";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim();
  const locale =
    request.nextUrl.searchParams.get("locale") === "fr" ? "fr" : "en";

  const loginPath = locale === "fr" ? "/fr/connexion" : "/login";
  const appPath = locale === "fr" ? "/fr/app" : "/app";

  if (!token) {
    return NextResponse.redirect(
      new URL(`${loginPath}?error=missing_token`, request.url),
    );
  }

  const ip = getClientIp(request);
  // Tokens are 256-bit, so guessing is hopeless; this only caps the database
  // work a flood of junk links can cause. When the proxy is not trusted every
  // visitor is "unknown", so that shared bucket gets a much larger budget.
  const budget = await rateLimitAsync({
    key: `auth-callback:${ip}`,
    limit: ip.startsWith("unknown") ? 600 : 60,
    windowMs: 10 * 60_000,
  });
  if (!budget.allowed) {
    return NextResponse.redirect(
      new URL(`${loginPath}?error=rate_limited`, request.url),
    );
  }

  const result = await consumeMagicLinkAndCreateSession({
    rawToken: token,
    userAgent: request.headers.get("user-agent") || undefined,
    ip,
  });

  if (!result.ok) {
    return NextResponse.redirect(
      new URL(
        `${loginPath}?error=${encodeURIComponent(result.error)}`,
        request.url,
      ),
    );
  }

  const response = NextResponse.redirect(new URL(appPath, request.url));
  const opts = sessionCookieOptions(result.maxAge);
  response.cookies.set(opts.name, result.cookieValue, opts);
  return response;
}
