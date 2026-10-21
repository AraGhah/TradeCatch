import { isE2eHarness } from "@/lib/config";
import { providerProbes } from "./probes";
import { scheduledJobFailures } from "./job-health";
import { openTokens } from "@/product/scheduling/google";
import { getPgPool } from "@/product/missed-call/postgres-store";
import { createPostgresReliabilityStore } from "./postgres-store";
import { createReliabilityService, type Probe } from "./service";
import { createMemoryReliabilityStore, type ReliabilityStore } from "./store";
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
  let database = false;
  if (!url)
    probes.push({
      service: "database",
      status: "unknown",
      state: "unconfigured",
      detail: "Database not configured",
    });
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
    } catch {
      probes.push({
        service: "database",
        status: "unavailable",
        state: "configured",
        detail: "Required query failed",
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
      const r = await pool.query(
        "SELECT calendar_id,token_ciphertext FROM tc_calendar_connections WHERE status='connected' AND token_ciphertext IS NOT NULL AND calendar_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1",
      );
      if (r.rows[0] && !isE2eHarness()) {
        const row = r.rows[0],
          tokens = openTokens(row.token_ciphertext);
        const response = await fetch(
          "https://www.googleapis.com/calendar/v3/freeBusy",
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(4000),
            headers: {
              authorization: `Bearer ${tokens.accessToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              timeMin: new Date().toISOString(),
              timeMax: new Date(Date.now() + 60_000).toISOString(),
              items: [{ id: row.calendar_id }],
            }),
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
        const item = data?.calendars?.[row.calendar_id];
        calendar.status =
          response.ok && Array.isArray(item?.busy) && !item.errors?.length
            ? "healthy"
            : "degraded";
        calendar.state =
          calendar.status === "healthy" ? "operational" : "configured";
        calendar.detail =
          calendar.status === "healthy"
            ? "One connected calendar availability read succeeded; other calendars and writes not verified"
            : "Connected calendar availability check failed";
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

export function getReliabilityService() {
  return createReliabilityService({
    store: store(),
    now: () => new Date(),
    environment: () =>
      isE2eHarness()
        ? "staging"
        : process.env.TRADECATCH_ENV?.trim() ||
          process.env.NODE_ENV ||
          "development",
    probe,
    version: () => process.env.TRADECATCH_VERSION?.trim() || "0.1.0",
    async notifyAdmin(input) {
      if (input.simulated) return;
      const to =
        process.env.ADMIN_ALERT_EMAIL?.trim() ||
        process.env.RESEND_NOTIFY_EMAIL?.trim();
      if (!to)
        throw new Error("Administrator alert destination not configured");
      const { sendBusinessNotifyEmail } =
        await import("@/lib/business-notifications");
      const result = await sendBusinessNotifyEmail({
        toEmail: to,
        subject: `TradeCatch incident: ${input.title}`,
        title: input.title,
        lines: [{ label: "Severity", value: input.severity }],
      });
      if (!result.sent) throw new Error("Administrator alert delivery failed");
    },
  });
}

export function resetReliabilityRuntimeForTests() {
  delete globalForReliability.__tradecatchReliability;
}

export type { ServiceName };
