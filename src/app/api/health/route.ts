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
import { OUTBOUND_STALE_SENDING_MS } from "@/product/missed-call/store";

export const dynamic = "force-dynamic";

/**
 * Lightweight health check for uptime monitors.
 *
 * Public: ok / status / timestamp only.
 * Detailed checks: development, or ops bearer auth.
 *
 * Top-level `ok` is false (HTTP 503) when the marketing site cannot accept leads
 * in production. Module A marks the deployment `degraded` whenever Twilio or the
 * durable-store flag is present but Module A is not fully ready.
 */
export async function GET(request: NextRequest) {
  const durableConfigured = isDurableMissedCallStoreConfigured();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  let database: boolean | null = null;
  let schemaOk: boolean | null = null;
  let queue:
    | {
        queued: number;
        retry: number;
        sending: number;
        staleSending: number;
      }
    | null
    | undefined;
  let escalationsLastTick: string | null = null;
  let escalationsFresh: boolean | null = null;

  if (durableConfigured) {
    database = false;
    schemaOk = false;
    if (databaseUrl) {
      try {
        const pool = getPgPool(databaseUrl);
        await pool.query("SELECT 1");
        database = true;
        const schema = await pool.query<{ ok: boolean }>(
          `SELECT (
             to_regclass('public.mc_workflows') IS NOT NULL
             AND to_regclass('public.mc_outbound_messages') IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM information_schema.columns
               WHERE table_name = 'mc_workflows' AND column_name = 'revision'
             )
           ) AS ok`,
        );
        schemaOk = Boolean(schema.rows[0]?.ok);

        const stats = await pool.query<{
          queued: string;
          retry: string;
          sending: string;
          stale_sending: string;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'queued')::text AS queued,
             COUNT(*) FILTER (WHERE status = 'retry')::text AS retry,
             COUNT(*) FILTER (WHERE status = 'sending')::text AS sending,
             COUNT(*) FILTER (
               WHERE status = 'sending'
                 AND updated_at < now() - ($1::bigint * interval '1 millisecond')
             )::text AS stale_sending
           FROM mc_outbound_messages`,
          [OUTBOUND_STALE_SENDING_MS],
        );
        const row = stats.rows[0];
        queue = {
          queued: Number(row?.queued ?? 0),
          retry: Number(row?.retry ?? 0),
          sending: Number(row?.sending ?? 0),
          staleSending: Number(row?.stale_sending ?? 0),
        };

        const tick = await pool.query<{ value: string; updated_at: Date }>(
          `SELECT value, updated_at FROM mc_ops_meta WHERE key = 'escalations_last_tick'`,
        );
        if (tick.rows[0]) {
          escalationsLastTick = tick.rows[0].value;
          const ageMs =
            Date.now() - new Date(tick.rows[0].updated_at).getTime();
          // Cron runs every minute; warn if older than 10 minutes.
          escalationsFresh = ageMs < 10 * 60 * 1000;
        } else {
          escalationsFresh = false;
        }
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
    authSecret: Boolean(
      process.env.AUTH_SECRET?.trim() ||
        process.env.SESSION_SECRET?.trim() ||
        process.env.MISSED_CALL_OPS_SECRET?.trim(),
    ),
    twilio: isTwilioConfigured(),
    durableMissedCallStore: durableConfigured,
    database,
    schemaOk,
    queue: queue ?? null,
    escalationsLastTick,
    escalationsFresh,
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
    checks.schemaOk === true &&
    checks.opsAuth;
  const moduleAExpected = checks.twilio || checks.durableMissedCallStore;
  const queueBackedUp =
    Boolean(queue) &&
    ((queue?.queued ?? 0) + (queue?.retry ?? 0) > 100 ||
      (queue?.staleSending ?? 0) > 10);
  const cronStale =
    moduleAExpected &&
    checks.durableMissedCallStore &&
    checks.escalationsFresh === false;
  const degraded =
    !siteReady ||
    (moduleAExpected && !moduleAReady) ||
    queueBackedUp ||
    Boolean(cronStale);

  const includeDetails = !isProductionRuntime() || authorizeOpsRequest(request);

  // Ready probes must not report healthy when Module A is expected but broken,
  // or when the lead pipeline cannot accept traffic.
  const ready = siteReady && !degraded;

  const body = {
    ok: ready,
    degraded,
    status: degraded ? "degraded" : "healthy",
    service: "tradecatch",
    readyMarker: ready ? "tradecatch-ready" : "tradecatch-not-ready",
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
    status: ready ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
      ...(ready
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
