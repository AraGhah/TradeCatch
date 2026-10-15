import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import {
  authorizeStagingBasicAuth,
  getStagingBasicCredentials,
  stagingUnauthorizedResponse,
} from "@/lib/staging-access";

/**
 * Edge-safe staging gate. Prefer Cloudflare Access in front of the Worker;
 * this is the in-app fallback when STAGING_BASIC_AUTH_* is configured.
 *
 * Exempt:
 * - /api/health (uptime monitors)
 * - /api/twilio/* (provider webhooks cannot send HTTP Basic)
 * - Authorization: Bearer … (ops / cron — route-level auth still applies)
 */
export function enforceStagingAccess(
  request: NextRequest,
): Response | NextResponse | null {
  const envName =
    process.env.TRADECATCH_ENV?.trim().toLowerCase() ||
    process.env.NEXT_PUBLIC_TRADECATCH_ENV?.trim().toLowerCase() ||
    "";
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE?.trim() === "1";
  const isStaging =
    envName === "staging" ||
    envName === "stage" ||
    envName === "demo" ||
    demoMode;

  if (!isStaging) return null;
  if (!getStagingBasicCredentials()) return null;

  const path = request.nextUrl.pathname;
  if (
    path === "/api/health" ||
    path.endsWith("/api/health") ||
    path.startsWith("/api/twilio/")
  ) {
    return null;
  }

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return null;
  }

  if (authorizeStagingBasicAuth(authorization)) {
    return null;
  }

  return stagingUnauthorizedResponse();
}
