import type { Pool } from "pg";
import { safeDatabaseErrorCode } from "@/lib/postgres-pool";
import { emptySignals, type Signals } from "./rules";
import type { MonitorThresholds } from "./thresholds";
import type { ProbeRecord } from "./types";

/**
 * What the monitor measures (KAN-28): counts read from the tables the product
 * already writes, and a check of the database itself.
 *
 * Each collector is independent. A table that is missing (an older database)
 * or a query that times out disables only that one signal, which is reported
 * as `degraded` so the dashboard can say "not measured" instead of "fine".
 * Nothing here reads message bodies, transcripts, names, phone numbers or
 * payment data: every query returns a count or a business identifier.
 */

type Queryable = Pick<Pool, "query">;

const DAY = 24 * 60 * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

async function counts(
  db: Queryable,
  sql: string,
  params: unknown[],
): Promise<Record<string, number>> {
  const result = await db.query(sql, params);
  const row = (result.rows[0] ?? {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value ?? 0)]));
}

export type CollectedSignals = {
  signals: Signals;
  /** Signals that could not be measured this run. */
  degraded: string[];
};

export async function collectSignals(
  db: Queryable,
  now: Date,
  t: MonitorThresholds,
): Promise<CollectedSignals> {
  const at = now.getTime();
  const signals = emptySignals();
  const degraded: string[] = [];

  async function collect(name: string, run: () => Promise<void>) {
    try {
      await run();
    } catch (error) {
      degraded.push(name);
      console.warn(
        JSON.stringify({
          event: "tradecatch.monitoring.collector_failed",
          collector: name,
          code: safeDatabaseErrorCode(error) ?? "UNKNOWN",
        }),
      );
    }
  }

  // Calls. A caller hanging up is a normal outcome (outcome = caller_hung_up on a
  // completed call) and is only counted for context. A failure is a session the
  // system marked failed. A call with no final status long after it started is
  // a failure to finalize, which is its own signal.
  await collect("calls", async () => {
    const row = await counts(
      db,
      `SELECT
         count(*) FILTER (WHERE started_at >= $1)::int AS total,
         count(*) FILTER (WHERE started_at >= $1 AND (status = 'failed' OR outcome = 'failed'))::int AS failed,
         count(*) FILTER (WHERE started_at >= $1 AND status <> 'failed' AND outcome = 'caller_hung_up')::int AS hung_up,
         count(*) FILTER (WHERE finalized_at IS NULL AND status IN ('in_progress', 'transferring') AND updated_at < $2)::int AS stale
       FROM rc_call_sessions
       WHERE started_at >= $3`,
      [iso(at - t.calls.windowMs), iso(at - t.calls.staleAfterMs), iso(at - DAY)],
    );
    signals.calls = {
      totalSessions: row.total ?? 0,
      failedSessions: row.failed ?? 0,
      hungUpSessions: row.hung_up ?? 0,
      staleUnfinalized: row.stale ?? 0,
    };
  });

  // Text messages: automation follow-ups, missed-call texts and owner alerts.
  // Test (simulated) sends never count; queued ones have not been attempted yet.
  const smsSince = iso(at - t.sms.windowMs);
  let smsFailed = 0;
  let smsTotal = 0;
  await collect("sms_automation", async () => {
    const row = await counts(
      db,
      `SELECT
         count(*) FILTER (WHERE status IN ('submitted', 'sent', 'delivered', 'failed', 'undelivered'))::int AS total,
         count(*) FILTER (WHERE status IN ('failed', 'undelivered'))::int AS failed
       FROM tc_sms_jobs
       WHERE NOT simulated AND updated_at >= $1`,
      [smsSince],
    );
    smsTotal += row.total ?? 0;
    smsFailed += row.failed ?? 0;
  });
  await collect("sms_missed_call", async () => {
    const row = await counts(
      db,
      `SELECT
         count(*) FILTER (WHERE status NOT IN ('queued', 'retry', 'sending'))::int AS total,
         count(*) FILTER (WHERE status IN ('failed', 'undelivered'))::int AS failed
       FROM mc_outbound_messages
       WHERE updated_at >= $1`,
      [smsSince],
    );
    smsTotal += row.total ?? 0;
    smsFailed += row.failed ?? 0;
  });
  await collect("sms_notifications", async () => {
    const row = await counts(
      db,
      `SELECT
         count(*) FILTER (WHERE status IN ('sent', 'submitted', 'delivered', 'failed', 'dead'))::int AS total,
         count(*) FILTER (WHERE status IN ('failed', 'dead'))::int AS failed
       FROM tc_notification_deliveries
       WHERE channel = 'sms' AND NOT simulated AND updated_at >= $1`,
      [smsSince],
    );
    smsTotal += row.total ?? 0;
    smsFailed += row.failed ?? 0;
  });
  signals.sms = { failed: smsFailed, total: smsTotal };

  // Follow-up automations. Quiet-hours sends are dropped (skipped), never left
  // pending, so a pending job long past its time is genuinely stuck.
  await collect("automations", async () => {
    const stuckBefore = iso(at - t.automations.stuckAfterMs);
    const since = iso(at - t.automations.windowMs);
    const row = await counts(
      db,
      `SELECT
         count(*) FILTER (
           WHERE (status = 'pending' AND scheduled_at < $1)
              OR (status = 'processing' AND COALESCE(claimed_at, updated_at) < $1)
         )::int AS stuck,
         count(*) FILTER (WHERE status = 'failed' AND attempts >= 2 AND updated_at >= $2)::int AS exhausted
       FROM tc_sms_jobs
       WHERE NOT simulated AND scheduled_at >= $3`,
      [stuckBefore, since, iso(at - 7 * DAY)],
    );
    const duplicates = await counts(
      db,
      `SELECT count(*)::int AS duplicates FROM (
         SELECT job_id FROM tc_sms_executions
         WHERE status = 'success' AND NOT simulated AND at >= $1
         GROUP BY job_id HAVING count(*) > 1
       ) d`,
      [since],
    );
    signals.automations = {
      stuckJobs: row.stuck ?? 0,
      retryExhausted: row.exhausted ?? 0,
      duplicateExecutions: duplicates.duplicates ?? 0,
    };
  });

  // Calendar: businesses whose connection is expired or revoked (demo and
  // suspended businesses are not worth an alert), and recorded sync/booking failures.
  await collect("calendar_credentials", async () => {
    const result = await db.query(
      `SELECT c.organization_id
       FROM tc_calendar_connections c
       JOIN tc_organizations o ON o.id = c.organization_id
       WHERE c.status IN ('expired', 'error')
         AND o.status = 'active' AND o.account_type <> 'demo'
       ORDER BY c.organization_id
       LIMIT 200`,
    );
    signals.calendar.credentialProblemBusinesses = result.rows.map((row) =>
      String((row as { organization_id: string }).organization_id),
    );
  });
  await collect("calendar_failures", async () => {
    const row = await counts(
      db,
      `SELECT count(*)::int AS failed FROM tc_system_errors
       WHERE service IN ('google_calendar', 'calcom') AND severity <> 'low'
         AND NOT simulated AND created_at >= $1`,
      [iso(at - t.calendar.windowMs)],
    );
    signals.calendar.failedSyncs = row.failed ?? 0;
  });

  // Stripe. Webhook failures and signature failures are recorded by the webhook
  // route itself; inconsistent billing is the unambiguous case of one business
  // holding more than one live subscription (a double charge waiting to happen).
  await collect("stripe_webhooks", async () => {
    const row = await counts(
      db,
      `SELECT
         count(*) FILTER (WHERE operation <> 'webhook.signature' AND severity IN ('high', 'critical'))::int AS failures,
         count(*) FILTER (WHERE operation = 'webhook.signature')::int AS signatures
       FROM tc_system_errors
       WHERE service = 'stripe' AND operation LIKE 'webhook.%'
         AND NOT simulated AND created_at >= $1`,
      [iso(at - t.stripe.windowMs)],
    );
    signals.stripe.webhookFailures = row.failures ?? 0;
    signals.stripe.signatureFailures = row.signatures ?? 0;
  });
  await collect("stripe_billing", async () => {
    const row = await counts(
      db,
      `SELECT count(*)::int AS inconsistent FROM (
         SELECT s.organization_id FROM tc_stripe_subscriptions s
         JOIN tc_organizations o ON o.id = s.organization_id
         WHERE s.status IN ('active', 'trialing', 'past_due')
           AND o.status = 'active' AND o.account_type <> 'demo'
         GROUP BY s.organization_id HAVING count(*) > 1
       ) d`,
      [],
    );
    signals.stripe.inconsistentBilling = row.inconsistent ?? 0;
  });

  return { signals, degraded };
}

export type DatabaseProbe = {
  /** Read and write both worked. */
  ok: boolean;
  readOk: boolean;
  writeOk: boolean;
  durationMs: number;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("database check timed out")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Is the database answering, and can it be written to? A read-only or full
 * database still answers SELECT 1 while every customer write fails, so the check
 * writes a heartbeat row too. It only gives up after `probeAttempts` tries, so
 * one dropped connection is not an outage.
 */
export async function probeDatabase(
  db: Queryable,
  t: MonitorThresholds,
  clock: () => number = Date.now,
): Promise<DatabaseProbe> {
  let readOk = false;
  let writeOk = false;
  for (let attempt = 0; attempt < t.database.probeAttempts; attempt += 1) {
    const started = clock();
    try {
      await withTimeout(db.query("SELECT 1"), t.database.probeTimeoutMs);
      readOk = true;
      await withTimeout(
        db.query(
          `INSERT INTO mc_ops_meta (key, value, updated_at) VALUES ('monitor_write_probe', $1, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
          [String(started)],
        ),
        t.database.probeTimeoutMs,
      );
      writeOk = true;
      return { ok: true, readOk, writeOk, durationMs: Math.max(0, clock() - started) };
    } catch {
      // try again; only the last answer matters
    }
  }
  return { ok: false, readOk, writeOk, durationMs: t.database.probeTimeoutMs };
}

/**
 * One availability check of the public site: a plain GET with no cookies and
 * no credentials. "Reachable" is what is measured, not "authorized": a refused
 * (401/403) or rate-limited (429) probe still proves the site is answering, so
 * those never count as an outage. Server errors, a missing page, a dropped
 * connection and a hung request do.
 */
export async function probeWebsite(input: {
  fetchImpl: typeof fetch;
  url: string;
  target: string;
  timeoutMs: number;
  now: () => Date;
  clock?: () => number;
}): Promise<ProbeRecord> {
  const clock = input.clock ?? Date.now;
  const started = clock();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(input.url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: { "user-agent": "TradeCatch-Monitor/1.0", accept: "text/html,application/json" },
    });
    await response.body?.cancel().catch(() => undefined);
    const status = response.status;
    return {
      at: input.now().toISOString(),
      target: input.target,
      ok: status < 400 || status === 401 || status === 403 || status === 429,
      statusCode: status,
      durationMs: Math.max(0, clock() - started),
    };
  } catch {
    return {
      at: input.now().toISOString(),
      target: input.target,
      ok: false,
      durationMs: Math.max(0, clock() - started),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The website checks the monitor runs, or undefined when there is nothing safe
 * to probe: no public address configured, a local address, or a workers.dev
 * address (a Worker cannot call itself there, so every probe would fail and
 * raise a false outage). The dashboard then reports the site as "not measured".
 */
export function createWebsiteCheck(input: {
  siteUrl: string | undefined;
  fetchImpl: typeof fetch;
  now: () => Date;
  timeoutMs: number;
}): (() => Promise<ProbeRecord[]>) | undefined {
  let origin: URL;
  try {
    origin = new URL(input.siteUrl ?? "");
  } catch {
    return undefined;
  }
  const host = origin.hostname.toLowerCase();
  if (
    origin.protocol !== "https:" ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".workers.dev") ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
  )
    return undefined;
  const targets: { target: string; path: string }[] = [
    { target: "page", path: "/" },
    { target: "api", path: "/api/health" },
  ];
  return () =>
    Promise.all(
      targets.map(({ target, path }) =>
        probeWebsite({
          fetchImpl: input.fetchImpl,
          url: new URL(path, origin).toString(),
          target,
          timeoutMs: input.timeoutMs,
          now: input.now,
        }),
      ),
    );
}
