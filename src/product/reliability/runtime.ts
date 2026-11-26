import { isE2eHarness } from "@/lib/config";
import { providerProbes } from "./probes";
import { scheduledJobFailures } from "./job-health";
import { databaseFailureCode, getPgPool } from "@/lib/postgres-pool";
import type { AlertPayload } from "./alerts";
import { collectSignals, createWebsiteCheck, probeDatabase } from "./collectors";
import { createAdminAlertNotifier } from "./notify";
import { createPostgresReliabilityStore } from "./postgres-store";
import { createReliabilityService, type Probe } from "./service";
import { createMemoryReliabilityStore, type ReliabilityStore } from "./store";
import { resolveThresholds } from "./thresholds";
import { runMonitor } from "./watch";
import type { ServiceName } from "./types";

const globalForReliability = globalThis as unknown as {
  __tradecatchReliability?: ReliabilityStore;
};

function store(): ReliabilityStore {
  if (!globalForReliability.__tradecatchReliability) {
    const url = process.env.DATABASE_URL?.trim();
    const durable =
      process.env.MISSED_CALL_DURABLE_STORE === "1" ||
      process.env.SAAS_DURABLE_STORE === "1";
    globalForReliability.__tradecatchReliability =
      durable && url
        ? createPostgresReliabilityStore(url)
        : createMemoryReliabilityStore();
  }
  return globalForReliability.__tradecatchReliability;
}

export async function probe(): Promise<Probe[]> {
  const probes: Probe[] = [
    {
      service: "api",
      status: "healthy",
      state: "operational",
      detail: "Process responded to this check",
    },
  ];
  const url = process.env.DATABASE_URL?.trim();
  const durableRequired =
    (process.env.MISSED_CALL_DURABLE_STORE === "1" ||
      process.env.SAAS_DURABLE_STORE === "1") &&
    !isE2eHarness();
  let database = false;
  if (!url)
    probes.push(
      durableRequired
        ? {
            service: "database",
            status: "unavailable",
            state: "unconfigured",
            detail: "DATABASE_URL is not set although durable storage is required (NOT_CONFIGURED)",
          }
        : {
            service: "database",
            status: "unknown",
            state: "unconfigured",
            detail: "Database not configured",
          },
    );
  else {
    try {
      await getPgPool(url).query("SELECT 1");
      database = true;
      probes.push({
        service: "database",
        status: "healthy",
        state: "operational",
        detail: "SELECT 1 succeeded",
      });
    } catch (error) {
      probes.push({
        service: "database",
        status: "unavailable",
        state: "configured",
        // The code only (SQLSTATE such as 28P01, or a network/timeout name),
        // never the driver message: it can quote the connection string.
        detail: `Required query failed (${databaseFailureCode(error)})`,
      });
    }
  }
  // E2E runs must never contact real providers inherited from a developer's env.
  probes.push(...(await providerProbes(isE2eHarness() ? {} : process.env)));
  const checks = database || !url ? await store().listHealth() : [];
  const failures = scheduledJobFailures(checks);
  probes.push({
    service: "jobs",
    status: failures.length ? "degraded" : "healthy",
    state: failures.length ? "configured" : "operational",
    detail: failures.length
      ? `${failures.length} job(s) missing, stale or failed: ${failures.join(", ")}`
      : "All expected job results are recent and successful",
  });
  const calendar: Probe = {
    service: "google_calendar",
    status: "unknown",
    state:
      process.env.GOOGLE_CALENDAR_CLIENT_ID &&
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET
        ? "configured"
        : "unconfigured",
    detail: "No authenticated calendar read has been verified",
  };
  const notifications: Probe = {
    service: "notifications",
    status: "unknown",
    state: "configured",
    detail: "No recent real notification operation verified",
  };
  if (database && url) {
    const pool = getPgPool(url);
    try {
      // What the synchronization itself last recorded, not a fresh call with a
      // stored token: counts only, never a business, an address or an event.
      const r = await pool.query(`SELECT
        count(*) FILTER (WHERE c.status = 'connected')::int AS connected,
        count(*) FILTER (WHERE c.status = 'connected'
          AND s.last_synced_at > now() - interval '30 minutes'
          AND s.last_error IS NULL)::int AS healthy,
        count(*) FILTER (WHERE c.status = 'expired')::int AS revoked,
        max(s.last_synced_at) FILTER (WHERE s.last_error IS NULL) AS last_ok
        FROM tc_calendar_connections c
        LEFT JOIN tc_calendar_sync_state s ON s.organization_id = c.organization_id
        WHERE c.token_ciphertext IS NOT NULL AND c.calendar_id IS NOT NULL`);
      const links = await pool.query(
        `SELECT count(*)::int AS failed FROM tc_gcal_event_links WHERE state = 'failed'`,
      );
      const row = r.rows[0];
      const lagging = row.connected - row.healthy;
      const failed = links.rows[0]?.failed ?? 0;
      if (row.connected === 0) {
        calendar.detail = "No business has Google Calendar connected";
      } else if (lagging > 0 || failed > 0) {
        calendar.status = "degraded";
        calendar.detail = `${lagging} of ${row.connected} connected calendar(s) behind or failing; ${failed} change(s) not delivered`;
      } else {
        calendar.status = "healthy";
        calendar.state = "operational";
        if (row.last_ok) calendar.evidenceAt = new Date(row.last_ok).toISOString();
        calendar.detail = `${row.connected} connected calendar(s) synchronized in the last 30 minutes${
          row.revoked ? `; ${row.revoked} need to be reconnected by their owner` : ""
        }`;
      }
    } catch {
      calendar.status = "degraded";
      calendar.detail = "Calendar check unavailable";
    }
    try {
      const r = await pool.query(`SELECT
        count(*) FILTER (WHERE status IN ('failed','dead') OR (status IN ('pending','processing') AND created_at < now()-interval '15 minutes'))::int AS failed,
        max(updated_at) FILTER (WHERE status IN ('sent','submitted','delivered') AND channel <> 'in_app') AS accepted
        FROM tc_notification_deliveries WHERE NOT simulated AND updated_at > now()-interval '24 hours'`);
      const row = r.rows[0];
      if (row.failed > 0) {
        notifications.status = "degraded";
        notifications.detail = `${row.failed} recent failed or delayed real deliveries`;
      } else if (
        row.accepted &&
        !failures.includes("/api/notifications/tick")
      ) {
        notifications.status = "healthy";
        notifications.state = "operational";
        notifications.evidenceAt = new Date(row.accepted).toISOString();
        notifications.detail =
          "Recent real provider acceptance and successful processor; inbox/handset delivery not verified";
      }
    } catch {
      notifications.status = "degraded";
      notifications.detail = "Delivery evidence query failed";
    }
    // Verify a real delivered SMS with the currently authenticated Twilio account.
    const sms = probes.find((p) => p.service === "twilio_sms");
    if (sms?.state === "connected") {
      try {
        const r = await pool.query(
          "SELECT provider_sid FROM tc_notification_deliveries WHERE NOT simulated AND channel='sms' AND status='delivered' AND provider_sid IS NOT NULL AND updated_at > now()-interval '24 hours' ORDER BY updated_at DESC LIMIT 1",
        );
        const sid = r.rows[0]?.provider_sid;
        if (/^SM[a-f0-9]{32}$/i.test(sid || "")) {
          const response = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages/${sid}.json`,
            {
              redirect: "error",
              signal: AbortSignal.timeout(4000),
              headers: {
                authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
              },
            },
          );
          const data = response.ok
            ? ((await response.json()) as {
                calendars?: Record<
                  string,
                  { busy?: unknown[]; errors?: unknown[] }
                >;
                account_sid?: string;
                status?: string;
              })
            : null;
          if (!response.ok) await response.body?.cancel();
          if (
            data?.account_sid === process.env.TWILIO_ACCOUNT_SID &&
            data?.status === "delivered"
          ) {
            sms.status = "healthy";
            sms.state = "delivery_verified";
            sms.evidenceAt = new Date().toISOString();
            sms.detail =
              "One recent real SMS delivery confirmed by Twilio; other destinations not verified";
          }
        }
      } catch {
        sms.detail =
          "Account connected; recent delivery could not be independently verified";
      }
    }
  }
  probes.push(calendar, notifications);
  return probes;
}

function environmentName(): string {
  return isE2eHarness()
    ? "staging"
    : process.env.TRADECATCH_ENV?.trim() ||
        process.env.NODE_ENV ||
        "development";
}

/** Sends one administrator alert email. Needs no database. */
async function notifyAdmin(payload: AlertPayload): Promise<void> {
  const { sendBusinessNotifyEmail } = await import("@/lib/business-notifications");
  return createAdminAlertNotifier({
    env: process.env,
    send: sendBusinessNotifyEmail,
  })(payload);
}

export function getReliabilityService() {
  return createReliabilityService({
    store: store(),
    now: () => new Date(),
    environment: environmentName,
    probe,
    version: () => process.env.TRADECATCH_VERSION?.trim() || "0.1.0",
    thresholds: resolveThresholds(),
    siteUrl: () => process.env.NEXT_PUBLIC_SITE_URL?.trim() || undefined,
    notifyAdmin,
  });
}

/**
 * One run of the once-a-minute monitor against the real system. The database
 * checks and signal queries need PostgreSQL; without it (local development,
 * the e2e harness) they are reported as "not measured" rather than faked, and
 * the site is only probed when it has a real public address.
 */
export async function runMonitorOnce() {
  const service = getReliabilityService();
  const thresholds = service.thresholds;
  const now = () => new Date();
  const url = process.env.DATABASE_URL?.trim();
  const durable =
    process.env.MISSED_CALL_DURABLE_STORE === "1" ||
    process.env.SAAS_DURABLE_STORE === "1";
  const db = url && durable ? getPgPool(url) : undefined;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || undefined;
  return runMonitor({
    store: store(),
    engine: {
      report: service.reportIncident,
      sweepRecovered: service.sweepRecovered,
      recordPastOutage: service.recordPastOutage,
    },
    deliverAlerts: service.deliverAlerts,
    checkWebsite: isE2eHarness()
      ? undefined
      : createWebsiteCheck({
          siteUrl,
          fetchImpl: fetch,
          now,
          timeoutMs: thresholds.website.probeTimeoutMs,
        }),
    checkDatabase: db ? () => probeDatabase(db, thresholds) : undefined,
    collectSignals: db ? () => collectSignals(db, now(), thresholds) : undefined,
    emergencyNotify: notifyAdmin,
    // A durable store without a database URL means the Worker secret is gone:
    // with the bundled .env fallback stripped (scripts/strip-bundled-env-secrets.js)
    // nothing else would notice. The e2e harness runs without one on purpose.
    databaseUnconfigured: durable && !url && !isE2eHarness(),
    thresholds,
    now,
    siteUrl,
    simulated: environmentName() !== "production",
  });
}

/** The shared reliability store (PostgreSQL when durable storage is enabled, otherwise memory). */
export function getReliabilityStore(): ReliabilityStore {
  return store();
}

export function resetReliabilityRuntimeForTests() {
  delete globalForReliability.__tradecatchReliability;
}

export type { ServiceName };
