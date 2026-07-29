import { NextRequest, NextResponse } from "next/server";
import {
  isDurableMissedCallStoreConfigured,
  isResendConfigured,
  isTurnstileConfigured,
  isTwilioConfigured,
  isProductionRuntime,
} from "@/lib/config";
import { authorizeOpsRequest } from "@/lib/ops-auth";

export const dynamic = "force-dynamic";

/**
 * Lightweight health check for uptime monitors.
 *
 * Public: ok / status / timestamp only.
 * Detailed checks: development, or ops bearer auth.
 *
 * `ok` covers marketing-site readiness (Resend + Turnstile).
 * Module A readiness is reported separately under checks when detailed.
 */
export async function GET(request: NextRequest) {
  const checks = {
    resend: isResendConfigured(),
    turnstile: isTurnstileConfigured(),
    leadsWebhook: Boolean(process.env.LEADS_WEBHOOK_URL?.trim()),
    calendar: Boolean(process.env.NEXT_PUBLIC_CALENDAR_URL?.trim()),
    errorWebhook: Boolean(process.env.ERROR_WEBHOOK_URL?.trim()),
    analytics: Boolean(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim()),
    opsAuth: Boolean(
      process.env.MISSED_CALL_OPS_SECRET?.trim() ||
        process.env.CRON_SECRET?.trim(),
    ),
    twilio: isTwilioConfigured(),
    durableMissedCallStore: isDurableMissedCallStoreConfigured(),
  };

  const siteReady =
    !isProductionRuntime() || (checks.resend && checks.turnstile);

  const moduleAReady =
    checks.twilio && checks.durableMissedCallStore && checks.opsAuth;

  const includeDetails =
    !isProductionRuntime() || authorizeOpsRequest(request);

  return NextResponse.json(
    {
      ok: siteReady,
      status: siteReady ? "healthy" : "degraded",
      service: "tradecatch",
      readyMarker: "tradecatch-ready",
      timestamp: new Date().toISOString(),
      ...(includeDetails
        ? {
            checks,
            moduleA: {
              ready: moduleAReady,
              status: moduleAReady ? "ready" : "not_ready",
            },
          }
        : {}),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "x-tradecatch-ready": "1",
        "x-tradecatch-service": "tradecatch",
      },
    },
  );
}
