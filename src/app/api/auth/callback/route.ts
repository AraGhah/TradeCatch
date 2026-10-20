import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getClientIp, rateLimitAsync } from "@/lib/rate-limit";
import { BodyTooLargeError, readBodyText } from "@/lib/request-body";
import { randomToken } from "@/product/saas/ids";
import {
  loginConfirmationHtml,
  loginConfirmationHeaders as privateHeaders,
} from "@/product/saas/auth/login-confirmation";
import {
  consumeMagicLinkAndCreateSession,
  sessionCookieOptions,
} from "@/product/saas/auth/magic-link";

export const dynamic = "force-dynamic";

const confirmationCookie =
  process.env.NODE_ENV === "production"
    ? "__Host-tc_login_confirmation"
    : "tc_login_confirmation";
const noncePattern = /^[A-Za-z0-9_-]{43}$/;

function localeFor(value: string | null) {
  return value === "fr" ? "fr" : "en";
}

function loginError(request: NextRequest, locale: "en" | "fr", error: string) {
  const path = locale === "fr" ? "/fr/connexion" : "/login";
  return NextResponse.redirect(
    new URL(`${path}?error=${encodeURIComponent(error)}`, request.url),
    {
      status: 303,
      headers: privateHeaders,
    },
  );
}

// Reading or previewing an emailed link must never touch the token store.
export function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim();
  const locale = localeFor(request.nextUrl.searchParams.get("locale"));
  if (!token) return loginError(request, locale, "missing_token");
  if (!noncePattern.test(token))
    return loginError(request, locale, "Invalid or expired link.");

  const existing = request.cookies.get(confirmationCookie)?.value ?? "";
  const nonce = noncePattern.test(existing) ? existing : randomToken(32);
  const response = new NextResponse(
    loginConfirmationHtml({ token, nonce, locale }),
    {
      headers: {
        ...privateHeaders,
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
  response.cookies.set(confirmationCookie, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 20 * 60,
  });
  return response;
}

export function HEAD() {
  return new NextResponse(null, { headers: privateHeaders });
}

export async function POST(request: NextRequest) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/x-www-form-urlencoded"
  ) {
    return new NextResponse("Invalid confirmation form.", {
      status: 415,
      headers: privateHeaders,
    });
  }
  let body: URLSearchParams;
  try {
    body = new URLSearchParams(await readBodyText(request, 4096));
  } catch (error) {
    return new NextResponse("Invalid confirmation form.", {
      status: error instanceof BodyTooLargeError ? 413 : 400,
      headers: privateHeaders,
    });
  }

  // Double-submit check also protects sign-in before there is a session cookie.
  // The host-only HttpOnly cookie cannot be supplied by a different website.
  const cookieNonce = request.cookies.get(confirmationCookie)?.value ?? "";
  const formNonce = body.get("confirmation") ?? "";
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    (fetchSite && fetchSite !== "same-origin") ||
    !noncePattern.test(cookieNonce) ||
    !noncePattern.test(formNonce) ||
    !timingSafeEqual(Buffer.from(cookieNonce), Buffer.from(formNonce)) ||
    body.get("confirm") !== "1"
  ) {
    return new NextResponse(
      "Open your sign-in link again, then confirm to continue.",
      {
        status: 403,
        headers: privateHeaders,
      },
    );
  }

  const token = body.get("token")?.trim();
  const locale = localeFor(body.get("locale"));
  if (!token) return loginError(request, locale, "missing_token");
  if (!noncePattern.test(token))
    return loginError(request, locale, "Invalid or expired link.");

  const ip = getClientIp(request);
  const budget = await rateLimitAsync({
    key: `auth-callback:${ip}`,
    limit: ip.startsWith("unknown") ? 600 : 60,
    windowMs: 10 * 60_000,
  });
  if (!budget.allowed) return loginError(request, locale, "rate_limited");

  try {
    const result = await consumeMagicLinkAndCreateSession({
      rawToken: token,
      userAgent: request.headers.get("user-agent") || undefined,
      ip,
    });
    if (!result.ok) return loginError(request, locale, result.error);

    // A 303 turns the form POST into a fresh GET of the workspace.
    const response = NextResponse.redirect(
      new URL(locale === "fr" ? "/fr/app" : "/app", request.url),
      {
        status: 303,
        headers: privateHeaders,
      },
    );
    const opts = sessionCookieOptions(result.maxAge);
    response.cookies.set(opts.name, result.cookieValue, opts);
    return response;
  } catch {
    console.error("[auth/callback] Sign-in confirmation unavailable");
    return new NextResponse(
      "Sign-in is temporarily unavailable. Please request a new link and try again.",
      {
        status: 503,
        headers: privateHeaders,
      },
    );
  }
}
