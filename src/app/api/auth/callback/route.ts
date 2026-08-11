import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/rate-limit";
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

  const result = await consumeMagicLinkAndCreateSession({
    rawToken: token,
    userAgent: request.headers.get("user-agent") || undefined,
    ip: getClientIp(request),
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
