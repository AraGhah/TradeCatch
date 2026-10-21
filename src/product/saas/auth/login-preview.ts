import { randomBytes } from "node:crypto";
import {
  loginConfirmationHeaders,
  loginConfirmationHtml,
} from "./login-confirmation";

const noncePattern = /^[A-Za-z0-9_-]{43}$/;

/** Read-only preview shared by Next and the Worker; never loads authentication stores. */
export function loginPreview(request: Request, production: boolean): Response {
  if (request.method === "HEAD")
    return new Response(null, { headers: loginConfirmationHeaders });
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim();
  const locale = url.searchParams.get("locale") === "fr" ? "fr" : "en";
  if (!token || !noncePattern.test(token)) {
    const path = locale === "fr" ? "/fr/connexion" : "/login";
    const target = new URL(path, url);
    target.searchParams.set(
      "error",
      token ? "Invalid or expired link." : "missing_token",
    );
    return new Response(null, {
      status: 303,
      headers: { ...loginConfirmationHeaders, Location: target.href },
    });
  }
  const cookieName = production
    ? "__Host-tc_login_confirmation"
    : "tc_login_confirmation";
  const existing =
    (request.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1) ?? "";
  const nonce = noncePattern.test(existing)
    ? existing
    : randomBytes(32).toString("base64url");
  return new Response(loginConfirmationHtml({ token, nonce, locale }), {
    headers: {
      ...loginConfirmationHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Set-Cookie": `${cookieName}=${nonce}; Path=/; Max-Age=1200; HttpOnly; SameSite=Strict${production ? "; Secure" : ""}`,
    },
  });
}

/** Staging must continue through its Basic access gate and ordinary middleware. */
export function workerLoginPreview(
  request: Request,
  env: {
    TRADECATCH_ENV?: string;
    NEXT_PUBLIC_TRADECATCH_ENV?: string;
    NEXT_PUBLIC_DEMO_MODE?: string;
    STAGING_BASIC_AUTH_USER?: string;
    STAGING_BASIC_AUTH_PASSWORD?: string;
  },
): Response | undefined {
  if (
    [env.TRADECATCH_ENV, env.NEXT_PUBLIC_TRADECATCH_ENV].some((value) =>
      ["staging", "stage", "demo"].includes(value?.trim().toLowerCase() ?? ""),
    ) ||
    env.NEXT_PUBLIC_DEMO_MODE?.trim() === "1" ||
    env.STAGING_BASIC_AUTH_USER ||
    env.STAGING_BASIC_AUTH_PASSWORD ||
    !["GET", "HEAD"].includes(request.method) ||
    new URL(request.url).pathname !== "/api/auth/callback"
  )
    return undefined;
  return loginPreview(request, true);
}
