import { NextRequest, NextResponse } from "next/server";
import {
  isDurableMissedCallStoreConfigured,
  isResendConfigured,
  isTurnstileConfigured,
  isTwilioConfigured,
  isProductionRuntime,
  isE2eHarness,
} from "@/lib/config";
import { authorizeOpsRequest } from "@/lib/ops-auth";
import { getPgPool } from "@/product/missed-call/postgres-store";

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
  const durableConfigured = isDurableMissedCallStoreConfigured();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  let database: boolean | null = null;
  if (durableConfigured) {
    database = false;
    if (databaseUrl) {
      try {
        await getPgPool(databaseUrl).query("SELECT 1");
        database = true;
      } catch (error) {
        console.error("[health] durable database check failed", error);
      }
    }
  }

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
    durableMissedCallStore: durableConfigured,
    database,
    e2eHarness: isE2eHarness(),
  };

  const siteReady =
    !isProductionRuntime() ||
    checks.e2eHarness ||
    (checks.resend && checks.turnstile);

  const moduleAReady =
    checks.twilio &&
    checks.durableMissedCallStore &&
    checks.database === true &&
    checks.opsAuth;
  const degraded = !siteReady || (checks.durableMissedCallStore && !moduleAReady);

  const includeDetails =
    !isProductionRuntime() || authorizeOpsRequest(request);

  const body = {
    ok: siteReady,
    degraded,
    status: degraded ? "degraded" : "healthy",
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
