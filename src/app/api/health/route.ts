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
import { getProductionSafetyIssues } from "@/lib/production-safety";
import {
  loadClientAccountFromEnv,
  validateClientConfig,
} from "@/product/missed-call/client-config";
import { getPgPool } from "@/product/missed-call/postgres-store";
import { OUTBOUND_STALE_SENDING_MS } from "@/product/missed-call/store";
import { receptionistReadiness } from "@/product/receptionist/runtime";

export const dynamic = "force-dynamic";

const REQUIRED_SCHEMA_MIGRATIONS = [
  "schema.sql",
  "002_saas_foundation",
  "003_starter_features",
  "004_growth_and_settings",
  "005_crm_webhook_dlq",
] as const;

function hasValidProductionClientRouting(): boolean {
  const strictProductionEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
  };
  // Readiness never permits the explicit demo bypass, even if it was set by
  // mistake. Production safety reports that flag separately.
  delete strictProductionEnv.MISSED_CALL_ALLOW_DEMO;

  try {
    const loaded = loadClientAccountFromEnv(strictProductionEnv);
    return loaded.source === "env" && validateClientConfig(loaded.client).ok;
  } catch {
    return false;
  }
}

/**
 * Health checks for uptime monitors and operators.
 *
 * Public production requests are cheap liveness checks and never touch the
 * database. Detailed readiness checks run in development or with ops bearer
 * auth.
 *
 * Top-level `ok` is false (HTTP 503) when the production safety or Module A
 * contract is broken. Optional lead-delivery integrations remain visible in
 * detailed checks without turning an otherwise working service into an outage.
 */
export async function GET(request: NextRequest) {
  const production = isProductionRuntime();
  const authorization = request.headers.get("authorization");
  const authorized = authorizeOpsRequest(request);
  const includeDetails = !production || authorized;

  if (production && authorization !== null && !authorized) {
    return NextResponse.json(
      {
        ok: false,
        status: "unauthorized",
        service: "tradecatch",
        timestamp: new Date().toISOString(),
      },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "WWW-Authenticate": "Bearer",
          "x-tradecatch-service": "tradecatch",
        },
      },
    );
  }

  if (production && !includeDetails) {
    return NextResponse.json(
      {
        ok: true,
        degraded: false,
        status: "live",
        service: "tradecatch",
        livenessMarker: "tradecatch-live",
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "x-tradecatch-live": "1",
          "x-tradecatch-service": "tradecatch",
        },
      },
    );
  }

  const e2eHarness = isE2eHarness();
  const productionSafetyIssues =
    production && !e2eHarness ? getProductionSafetyIssues() : [];
  const durableConfigured = isDurableMissedCallStoreConfigured();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  let database: boolean | null = null;
  let schemaOk: boolean | null = null;
  let diagnosticsComplete = false;
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
             AND to_regclass('public.tc_organizations') IS NOT NULL
             AND to_regclass('public.tc_quote_threads') IS NOT NULL
             AND to_regclass('public.tc_appointments') IS NOT NULL
             AND to_regclass('public.tc_crm_dlq') IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM information_schema.columns
               WHERE table_name = 'mc_workflows' AND column_name = 'revision'
             )
             AND (
               SELECT COUNT(DISTINCT id)
               FROM mc_schema_migrations
               WHERE id = ANY($1::text[])
             ) = cardinality($1::text[])
           ) AS ok`,
          [REQUIRED_SCHEMA_MIGRATIONS],
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
        diagnosticsComplete = true;
      } catch (error) {
        database = false;
        schemaOk = false;
        queue = null;
        escalationsLastTick = null;
        escalationsFresh = false;
        diagnosticsComplete = false;
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
    clientRouting: hasValidProductionClientRouting(),
    durableMissedCallStore: durableConfigured,
    database,
    schemaOk,
    diagnosticsComplete,
    queue: queue ?? null,
    escalationsLastTick,
    escalationsFresh,
    e2eHarness,
    productionSafety: {
      ok: productionSafetyIssues.length === 0,
      issues: productionSafetyIssues,
    },
  };

  const siteReady =
    !production || checks.e2eHarness || checks.productionSafety.ok;

  const moduleAReady =
    checks.twilio &&
    checks.clientRouting &&
    checks.durableMissedCallStore &&
    checks.database === true &&
    checks.schemaOk === true &&
    checks.diagnosticsComplete &&
    checks.opsAuth;
  const moduleAExpected =
    (production && !checks.e2eHarness) ||
    checks.twilio ||
    checks.durableMissedCallStore;
  const queueBackedUp =
    Boolean(queue) &&
    ((queue?.queued ?? 0) + (queue?.retry ?? 0) > 100 ||
      (queue?.staleSending ?? 0) > 10);
  const cronStale =
    moduleAExpected &&
    checks.durableMissedCallStore &&
    checks.escalationsFresh !== true;
  const degraded =
    !siteReady ||
    (moduleAExpected && !moduleAReady) ||
    queueBackedUp ||
    Boolean(cronStale);

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
          // Informational only — never affects `ok`. Omitted unless the AI
          // receptionist is configured, so it never boots for other deployments.
          ...(process.env.RECEPTIONIST_CONFIG_JSON?.trim() ||
          process.env.RECEPTIONIST_ENABLED === "1"
            ? { receptionist: receptionistReadiness() }
            : {}),
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
