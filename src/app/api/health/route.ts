import { NextResponse } from "next/server";
import {
  isResendConfigured,
  isTurnstileConfigured,
  isProductionRuntime,
} from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Lightweight health check for uptime monitors (Better Stack, UptimeRobot,
 * Pingdom, Vercel Monitoring, etc.). Point your monitor at /api/health.
 */
export async function GET() {
  const checks = {
    resend: isResendConfigured(),
    turnstile: isTurnstileConfigured(),
    leadsWebhook: Boolean(process.env.LEADS_WEBHOOK_URL?.trim()),
    calendar: Boolean(process.env.NEXT_PUBLIC_CALENDAR_URL?.trim()),
    errorWebhook: Boolean(process.env.ERROR_WEBHOOK_URL?.trim()),
    analytics: Boolean(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim()),
  };

  const productionReady =
    !isProductionRuntime() || (checks.resend && checks.turnstile);

  // Always 200 for uptime / liveness probes. Config readiness is in the body
  // (`ok` / `status`) so monitors can assert on JSON without false alarms
  // when secrets are temporarily missing during setup.
  return NextResponse.json(
    {
      ok: productionReady,
      status: productionReady ? "healthy" : "degraded",
      service: "tradecatch",
      timestamp: new Date().toISOString(),
      checks,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
