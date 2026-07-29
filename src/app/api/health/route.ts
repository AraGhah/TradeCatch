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
 * Top-level `ok` is false (HTTP 503) when the marketing site cannot accept leads
 * in production. Module A readiness is never implied by DATABASE_URL alone —
 * only by an explicitly wired durable store flag.
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
    e2eHarness: process.env.TRADECATCH_E2E === "1",
  };

  const siteReady =
    !isProductionRuntime() ||
    checks.e2eHarness ||
    (checks.resend && checks.turnstile);

  const moduleAReady =
    checks.twilio && checks.durableMissedCallStore && checks.opsAuth;

  const includeDetails =
    !isProductionRuntime() || authorizeOpsRequest(request);

  const body = {
    ok: siteReady,
    status: siteReady ? "healthy" : "degraded",
    service: "tradecatch",
    readyMarker: siteReady ? "tradecatch-ready" : "tradecatch-not-ready",
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
  };

  return NextResponse.json(body, {
    status: siteReady ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
      ...(siteReady
        ? {
            "x-tradecatch-ready": "1",
            "x-tradecatch-service": "tradecatch",
          }
        : {
            "x-tradecatch-ready": "0",
            "x-tradecatch-service": "tradecatch",
          }),
    },
  });
}
