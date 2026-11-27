import { createId } from "@/lib/id";
import { databaseFailureCode, safeDatabaseErrorCode } from "@/lib/postgres-pool";
import {
  AlertNotConfiguredError,
  composeDatabaseOutageNotice,
  safePayload,
  type AlertNotifier,
  type DeliveryRun,
} from "./alerts";
import type { CollectedSignals, DatabaseProbe } from "./collectors";
import type { IncidentEngine } from "./incidents";
import {
  DATABASE_SERVICE,
  DATABASE_UNAVAILABLE_FINGERPRINT,
  evaluateApiTraffic,
  evaluateDatabaseSlow,
  evaluateSignals,
  evaluateWebsite,
  type Finding,
} from "./rules";
import type { ReliabilityStore } from "./store";
import type { MonitorThresholds } from "./thresholds";
import type { ProbeRecord } from "./types";

/**
 * The once-a-minute monitor run (KAN-28).
 *
 * Checks the site and the database, reads the real counts the product already
 * records, applies the threshold rules, and hands what it finds to the incident
 * engine, which decides whether an administrator is emailed. It then resolves
 * incidents whose condition has cleared and sends any alerts that are due.
 *
 * Two promises shape everything here:
 *  - it never throws. Monitoring is not allowed to break the thing it watches,
 *    so every stage is isolated: a failed stage is logged with a short code and
 *    the next one still runs.
 *  - an outage of the database is still reported. The database cannot store an
 *    incident about itself, so that one case is emailed directly, and the
 *    incident is recorded afterwards, from the gap in this run's own heartbeat.
 */

export const LAST_RUN_META = "monitor_last_run";

export type MonitorDeps = {
  store: ReliabilityStore;
  engine: Pick<IncidentEngine, "report" | "sweepRecovered" | "recordPastOutage">;
  deliverAlerts: () => Promise<DeliveryRun>;
  /** Undefined when there is no safe address to probe: reported as "not measured". */
  checkWebsite?: () => Promise<ProbeRecord[]>;
  /** Undefined when no database is configured. */
  checkDatabase?: () => Promise<DatabaseProbe>;
  collectSignals?: () => Promise<CollectedSignals>;
  /** Sends one alert without touching the database. */
  emergencyNotify?: AlertNotifier;
  /**
   * Durable storage is required but DATABASE_URL is missing. The store then
   * falls back to memory, which would make every run look healthy while
   * nothing is saved; it is reported as a database outage instead.
   */
  databaseUnconfigured?: boolean;
  thresholds: MonitorThresholds;
  now: () => Date;
  siteUrl?: string;
  /** Staging and test environments record incidents but never email anyone. */
  simulated?: boolean;
};

export type MonitorRun = {
  ranAt: string;
  checks: {
    website: "ok" | "failing" | "not_measured";
    database: "ok" | "slow" | "unavailable" | "not_measured";
  };
  findings: number;
  incidentsOpened: number;
  incidentsResolved: number;
  /** Signals that could not be measured this run. */
  degraded: string[];
  alerts: DeliveryRun;
  emergency?: "sent" | "failed" | "not_configured";
  /** Why storage failed, when it did (see databaseFailureCode). */
  storageFailure?: string;
  pastOutageRecorded: boolean;
  pruned: boolean;
};

/** What the monitor records about its own last run (the dashboard reads it). */
export type Heartbeat = {
  at: string;
  prunedAt?: string;
  website?: MonitorRun["checks"]["website"];
  database?: MonitorRun["checks"]["database"];
  /** Signals that could not be measured in that run. */
  degraded?: string[];
};

const MINUTE = 60_000;
/** How far back probes and request buckets are read: more than any rule needs. */
const LOOKBACK_MS = 15 * MINUTE;

function logStage(stage: string, error: unknown) {
  console.warn(
    JSON.stringify({
      event: "tradecatch.monitoring.stage_failed",
      stage,
      code: safeDatabaseErrorCode(error) ?? "UNKNOWN",
    }),
  );
}

export function parseHeartbeat(
  meta: { value: string; updatedAt: string } | null,
): Heartbeat | null {
  if (!meta) return null;
  try {
    const parsed = JSON.parse(meta.value) as Partial<Heartbeat>;
    if (typeof parsed.at === "string" && Number.isFinite(Date.parse(parsed.at)))
      return {
        at: parsed.at,
        prunedAt: typeof parsed.prunedAt === "string" ? parsed.prunedAt : undefined,
        website: parsed.website,
        database: parsed.database,
        degraded: Array.isArray(parsed.degraded)
          ? parsed.degraded.filter((name): name is string => typeof name === "string")
          : [],
      };
  } catch {
    // fall through to the column timestamp
  }
  return Number.isFinite(Date.parse(meta.updatedAt)) ? { at: meta.updatedAt } : null;
}

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function runMonitor(deps: MonitorDeps): Promise<MonitorRun> {
  const now = deps.now();
  const at = now.toISOString();
  const t = deps.thresholds;
  const simulated = Boolean(deps.simulated);
  const run: MonitorRun = {
    ranAt: at,
    checks: { website: "not_measured", database: "not_measured" },
    findings: 0,
    incidentsOpened: 0,
    incidentsResolved: 0,
    degraded: [],
    alerts: { attempted: 0, sent: 0, failed: 0, exhausted: 0 },
    pastOutageRecorded: false,
    pruned: false,
  };

  // 1. Checks that need nothing from the database.
  const [dbProbe, sites] = await Promise.all([
    deps.checkDatabase
      ? deps.checkDatabase().catch<DatabaseProbe>((error) => {
          logStage("database_probe", error);
          return {
            ok: false,
            readOk: false,
            writeOk: false,
            durationMs: t.database.probeTimeoutMs,
            failureCode: databaseFailureCode(error),
          };
        })
      : undefined,
    deps.checkWebsite
      ? deps.checkWebsite().catch((error) => {
          logStage("website_probe", error);
          return undefined;
        })
      : undefined,
  ]);
  if (sites) run.checks.website = sites.every((site) => site.ok) ? "ok" : "failing";
  if (dbProbe)
    run.checks.database = !dbProbe.ok
      ? "unavailable"
      : dbProbe.durationMs >= t.database.slowMs
        ? "slow"
        : "ok";

  // 2. Can anything be stored? Reading the heartbeat answers that and gives the
  // time of the last good run in one query.
  let lastRun: Heartbeat | null = null;
  let storageFailure: string | undefined;
  if (deps.databaseUnconfigured) {
    storageFailure = "NOT_CONFIGURED";
    run.checks.database = "unavailable";
  } else
    try {
      lastRun = parseHeartbeat(await deps.store.getMeta(LAST_RUN_META));
    } catch (error) {
      storageFailure = databaseFailureCode(error);
      logStage("storage", error);
    }

  if (storageFailure) {
    // The storage error is the operation that actually failed; the probe's code
    // only stands in when the storage error carried none.
    const code =
      storageFailure === "UNKNOWN" && dbProbe?.failureCode ? dbProbe.failureCode : storageFailure;
    run.storageFailure = code;
    run.emergency = await sendEmergency(deps, now, simulated, code, dbProbe);
    console.error(
      JSON.stringify({
        event: "tradecatch.monitoring.database_unavailable",
        emergency: run.emergency,
        code,
      }),
    );
    return run;
  }

  async function stage<T>(name: string, work: () => Promise<T>): Promise<T | undefined> {
    try {
      return await work();
    } catch (error) {
      logStage(name, error);
      return undefined;
    }
  }

  // 3. An earlier outage that ended before this run: no successful run for too
  // long means monitoring or its database was down. Recorded with its true start.
  if (lastRun && dbProbe?.ok !== false) {
    const gap = now.getTime() - Date.parse(lastRun.at);
    if (gap >= t.monitor.gapMs) {
      // Ties this resolution to the "Database is unavailable" emails sent while
      // nothing could be stored: theirs are the only references in this range.
      const windowMs = t.monitor.emergencyWindowMs;
      const firstWindow = Math.floor(Date.parse(lastRun.at) / windowMs);
      const lastWindow = Math.floor(now.getTime() / windowMs);
      const recorded = await stage("past_outage", () =>
        deps.engine.recordPastOutage({
          fingerprint: DATABASE_UNAVAILABLE_FINGERPRINT,
          service: DATABASE_SERVICE,
          category: "health_check",
          priority: "critical",
          title: "Database or monitoring was unavailable",
          summary:
            `No successful monitor run for ${Math.round(gap / MINUTE)} minutes, from ${lastRun!.at} to ${at}. ` +
            `Any database-down alert in this period: between dbdown-${firstWindow} and dbdown-${lastWindow}.` +
            // A database that answers again is no proof it was down: the
            // scheduled Worker run itself may have been stopped (Cloudflare
            // "exceededResources"), as it was three times on 2026-11-26. Last,
            // so a cut at the alert's length limit only shortens this hint.
            (dbProbe?.ok ? " If none came, the monitor run itself was stopped." : ""),
          correlationId: createId("gap"),
          startedAt: lastRun!.at,
          simulated,
        }),
      );
      run.pastOutageRecorded = Boolean(recorded);
    }
  }

  // 4. Remember what was just measured, then judge it.
  const lookback = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  const records: ProbeRecord[] = [...(sites ?? [])];
  if (dbProbe)
    records.push({ at, target: "database", ok: dbProbe.ok, durationMs: dbProbe.durationMs });
  for (const record of records) await stage("save_probe", () => deps.store.saveProbe(record));

  const findings: Finding[] = [];
  if (dbProbe && !dbProbe.ok)
    findings.push({
      fingerprint: DATABASE_UNAVAILABLE_FINGERPRINT,
      service: DATABASE_SERVICE,
      category: "health_check",
      priority: "critical",
      title: "Database is unavailable",
      summary:
        dbProbe.readOk && !dbProbe.writeOk
          ? `The database answers reads but rejects writes (${t.database.probeAttempts} attempts).`
          : `The database did not answer ${t.database.probeAttempts} checks in a row.`,
      quietMs: t.database.quietMs,
    });
  const probes = (await stage("read_probes", () => deps.store.listProbes(lookback))) ?? [];
  findings.push(
    ...evaluateWebsite(
      probes.filter((probe) => probe.target !== "database"),
      t,
      sites ?? [],
    ),
  );
  if (deps.checkDatabase) findings.push(...evaluateDatabaseSlow(probes, t));
  const buckets = (await stage("read_buckets", () => deps.store.listBuckets(lookback))) ?? [];
  findings.push(...evaluateApiTraffic(buckets, now, t));
  // Counts are only ever read from real tables. With no database to read them
  // from, or a collector that failed, the dashboard must say "not measured".
  run.degraded = ["signals"];
  if (deps.collectSignals) {
    const collected = await stage("collect_signals", () => deps.collectSignals!());
    if (collected) {
      run.degraded = collected.degraded;
      findings.push(...evaluateSignals(collected.signals, t));
    }
  }
  run.findings = findings.length;

  // 5. Hand every finding to the incident engine, one at a time and isolated.
  for (const finding of findings) {
    const outcome = await stage("report", () =>
      deps.engine.report({ ...finding, correlationId: createId("mon"), simulated }),
    );
    if (outcome && (outcome.outcome === "created" || outcome.outcome === "reopened"))
      run.incidentsOpened += 1;
  }

  // 6. Close what has cleared, and send what is due (including retries).
  const resolved = await stage("sweep", () => deps.engine.sweepRecovered());
  run.incidentsResolved = resolved?.length ?? 0;
  const delivered = await stage("deliver", () => deps.deliverAlerts());
  if (delivered) run.alerts = delivered;

  // 7. Old data is removed about once an hour, not every minute.
  let prunedAt = lastRun?.prunedAt;
  if (!prunedAt || now.getTime() - Date.parse(prunedAt) >= t.monitor.pruneEveryMs) {
    const pruned = await stage("prune", () => deps.store.prune(at, t.retention));
    if (pruned) {
      prunedAt = at;
      run.pruned = true;
    }
  }

  // 8. Heartbeat, with what the dashboard shows about this run.
  await stage("heartbeat", () =>
    deps.store.setMeta(
      LAST_RUN_META,
      JSON.stringify({
        at,
        prunedAt,
        website: run.checks.website,
        database: run.checks.database,
        degraded: run.degraded,
      }),
      at,
    ),
  );
  return run;
}

async function sendEmergency(
  deps: MonitorDeps,
  now: Date,
  simulated: boolean,
  failureCode: string,
  probe: DatabaseProbe | undefined,
): Promise<"sent" | "failed" | "not_configured"> {
  if (simulated) return "not_configured";
  if (!deps.emergencyNotify) return "not_configured";
  try {
    const payload = safePayload(
      composeDatabaseOutageNotice({
        now,
        siteUrl: deps.siteUrl,
        windowMs: deps.thresholds.monitor.emergencyWindowMs,
        failureCode,
        check: probe ? { readOk: probe.readOk, writeOk: probe.writeOk } : undefined,
      }),
    );
    await raceTimeout(deps.emergencyNotify(payload), deps.thresholds.alerts.retry.sendTimeoutMs);
    return "sent";
  } catch (error) {
    return error instanceof AlertNotConfiguredError ? "not_configured" : "failed";
  }
}
