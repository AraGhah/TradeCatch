import { LAST_RUN_META, parseHeartbeat } from "./watch";
import {
  AlertNotConfiguredError,
  deliverDueAlerts,
  serviceLabel,
  type AlertPayload,
} from "./alerts";
import { ReliabilityError } from "./errors";
import { incidentFingerprint } from "./fingerprint";
import { createIncidentEngine, type IncidentReport } from "./incidents";
import { summarizeTraffic } from "./rules";
import { sanitizeAlertText } from "./sanitize";
import { reliabilityId, type ReliabilityStore } from "./store";
import { DEFAULT_THRESHOLDS, type MonitorThresholds } from "./thresholds";
import {
  redactDiagnostic,
  type HealthStatus,
  type Priority,
  type ServiceHealth,
  type ServiceName,
  type Severity,
} from "./types";

/** One error type for the whole module: the admin routes import it from here. */
export { ReliabilityError };

const REQUIRED = new Set<ServiceName>(["api", "database", "jobs"]);
const MINUTE = 60_000;
/** The traffic shown on the dashboard covers this long. */
const TRAFFIC_WINDOW_MS = 15 * MINUTE;

const ERROR_PRIORITY: Partial<Record<Severity, Priority>> = {
  critical: "critical",
  high: "high",
  medium: "warning",
};

export type Probe = Omit<ServiceHealth, "checkedAt" | "required">;

export type MonitorStatus = {
  /** never: no run recorded. stale: the last run is older than the gap threshold. */
  state: "running" | "stale" | "never";
  lastRunAt: string | null;
  ageMs: number | null;
  website: "ok" | "failing" | "not_measured";
  database: "ok" | "slow" | "unavailable" | "not_measured";
  degraded: string[];
};

export type ReliabilityDeps = {
  store: ReliabilityStore;
  now: () => Date;
  environment: () => string;
  probe: () => Promise<Probe[]>;
  /**
   * Sends one administrator alert. Receives the finished, already-sanitized
   * payload. A function written for the older `{ title, severity, simulated }`
   * input still fits.
   */
  notifyAdmin?: (input: AlertPayload) => Promise<void>;
  version?: () => string;
  thresholds?: MonitorThresholds;
  /** Public origin used for the "open in the dashboard" link in alert emails. */
  siteUrl?: () => string | undefined;
};

export function createReliabilityService(deps: ReliabilityDeps) {
  const thresholds = deps.thresholds ?? DEFAULT_THRESHOLDS;
  const engine = createIncidentEngine({
    store: deps.store,
    thresholds,
    now: deps.now,
  });

  /**
   * Sends whatever alerts are due. Never throws: a failed send is recorded on
   * the alert (and retried later), not raised to the caller.
   */
  async function deliverAlerts() {
    return deliverDueAlerts({
      store: deps.store,
      notify:
        deps.notifyAdmin ??
        (async () => {
          throw new AlertNotConfiguredError();
        }),
      now: deps.now,
      thresholds,
      siteUrl: deps.siteUrl?.(),
    });
  }

  return {
    thresholds,
    deliverAlerts,
    /** Records that a condition is present now; opens, updates or reopens its incident. */
    reportIncident: (report: IncidentReport) => engine.report(report),
    /** Resolves incidents whose condition stayed clear, announcing recoveries. */
    sweepRecovered: () => engine.sweepRecovered(),
    /** Stores an outage that has already ended (the database could not store it while it happened). */
    recordPastOutage: (input: Parameters<typeof engine.recordPastOutage>[0]) =>
      engine.recordPastOutage(input),

    async recordError(input: {
      organizationId?: string;
      service: string;
      operation: string;
      errorCode: string;
      severity: Severity;
      retryable: boolean;
      detail?: string;
      requestId?: string;
      simulated?: boolean;
    }) {
      const requestId = input.requestId || reliabilityId("req");
      const now = deps.now();
      const fingerprint = incidentFingerprint({
        service: input.service,
        operation: input.operation,
        code: input.errorCode,
      });
      const row = {
        id: reliabilityId("err"),
        requestId,
        organizationId: input.organizationId,
        service: input.service,
        operation: input.operation,
        errorCode: input.errorCode,
        severity: input.severity,
        retryable: input.retryable,
        attemptCount: 1,
        status: "open" as const,
        detail: input.detail ? redactDiagnostic(input.detail) : undefined,
        environment: deps.environment(),
        simulated: Boolean(input.simulated),
        createdAt: now.toISOString(),
        fingerprint,
      };
      await deps.store.saveError(row);

      // One failure is noise; the same failure repeating is an incident.
      // Critical errors do not wait. Only the queue is written here: the email
      // goes out from the monitor run, never from a customer's request.
      const priority = ERROR_PRIORITY[input.severity];
      if (!priority) return row;
      let occurrences = 1;
      if (input.severity !== "critical") {
        const rule =
          input.severity === "high"
            ? thresholds.errors.high
            : thresholds.errors.medium;
        occurrences = await deps.store.countErrors(
          fingerprint,
          new Date(now.getTime() - rule.windowMs).toISOString(),
        );
        if (occurrences < rule.count) return row;
      }
      const operation = sanitizeAlertText(input.operation, 80);
      const code = sanitizeAlertText(input.errorCode, 60);
      await engine.report({
        fingerprint,
        service: input.service,
        category: operation,
        priority,
        title: `${serviceLabel(input.service)}: ${code}`,
        summary: `${operation} failed with ${code}.`,
        organizationId: input.organizationId,
        quietMs:
          thresholds.errors.quietMs[
            input.severity === "critical"
              ? "critical"
              : input.severity === "high"
                ? "high"
                : "medium"
          ],
        correlationId: requestId,
        simulated: row.simulated,
        initialOccurrences: occurrences,
      });
      return row;
    },

    /** When the monitor last ran, and what it could and could not measure. */
    async monitor(): Promise<MonitorStatus> {
      const beat = parseHeartbeat(await deps.store.getMeta(LAST_RUN_META));
      if (!beat)
        return {
          state: "never",
          lastRunAt: null,
          ageMs: null,
          website: "not_measured",
          database: "not_measured",
          degraded: [],
        };
      const ageMs = Math.max(0, deps.now().getTime() - Date.parse(beat.at));
      return {
        state: ageMs > thresholds.monitor.gapMs ? "stale" : "running",
        lastRunAt: beat.at,
        ageMs,
        website: beat.website ?? "not_measured",
        database: beat.database ?? "not_measured",
        degraded: beat.degraded ?? [],
      };
    },

    /** Delivery state of administrator alerts, for the dashboard. */
    async alertStatus() {
      return {
        summary: await deps.store.alertSummary(deps.now().toISOString()),
        failed: await deps.store.listAlertDeliveries({
          failedOnly: true,
          limit: 20,
        }),
      };
    },

    /** An incident with its history, alert deliveries and the errors behind it. */
    async incidentDetail(id: string) {
      const incident = await deps.store.getIncident(id);
      if (!incident) return null;
      const [events, deliveries, errors] = await Promise.all([
        deps.store.listIncidentEvents(id),
        deps.store.listAlertDeliveries({ incidentId: id, limit: 50 }),
        incident.fingerprint
          ? deps.store.listErrors({ fingerprint: incident.fingerprint, limit: 25 })
          : Promise.resolve([]),
      ]);
      return { incident, events, deliveries, errors };
    },

    async overview(options: { notifyOnFailure?: boolean } = {}) {
      const probes = await deps.probe();
      const checkedAt = deps.now().toISOString();
      const services: ServiceHealth[] = probes.map((probe) => ({
        ...probe,
        status:
          probe.state &&
          !["operational", "delivery_verified"].includes(probe.state) &&
          probe.status === "healthy"
            ? "unknown"
            : probe.status,
        checkedAt,
        required: REQUIRED.has(probe.service),
      }));
      for (const service of services) {
        await deps.store.saveHealth({
          service: service.service,
          status: service.status,
          detail: service.detail,
          checkedAt,
        });
      }
      if (options.notifyOnFailure) {
        for (const service of services) {
          if (
            service.status === "unavailable" ||
            service.status === "degraded" ||
            (service.required && service.status === "unknown")
          ) {
            const name = `health:${service.service}`;
            await engine.report({
              fingerprint: incidentFingerprint({ service: name }),
              service: name,
              category: "health_check",
              priority:
                service.service === "database" &&
                service.status === "unavailable"
                  ? "critical"
                  : service.required
                    ? "high"
                    : "warning",
              title: `${serviceLabel(service.service)} health check failed or remains unverified`,
              summary: service.detail
                ? sanitizeAlertText(service.detail, 200)
                : undefined,
              quietMs: thresholds.healthChecks.quietMs,
              correlationId: reliabilityId("health"),
              simulated: deps.environment() !== "production",
            });
          }
        }
        // A check that has stayed healthy resolves its incident; alerts that
        // could not be sent earlier (even for a probe that has since
        // recovered) are retried here.
        await engine.sweepRecovered();
        await deliverAlerts();
      }
      const requiredDown = services.some(
        (service) => service.required && service.status === "unavailable",
      );
      const requiredDegraded = services.some(
        (service) =>
          service.required &&
          (service.status === "degraded" || service.status === "unknown"),
      );
      const overall: HealthStatus = requiredDown
        ? "unavailable"
        : requiredDegraded
          ? "degraded"
          : "healthy";
      // Real request outcomes recorded by the Worker (per-minute buckets), never
      // anything simulated. With no traffic recorded the numbers are zero and
      // `trafficAvailable` says so, so a quiet system is not shown as a fast one.
      const now = deps.now();
      const traffic = summarizeTraffic(
        await deps.store.listBuckets(
          new Date(now.getTime() - TRAFFIC_WINDOW_MS).toISOString(),
        ),
        now,
        TRAFFIC_WINDOW_MS,
        "api",
      );
      return {
        overall,
        services,
        requests: traffic.requests,
        success: traffic.success,
        clientErrors: traffic.clientErrors,
        serverErrors: traffic.serverErrors,
        authErrors: traffic.authErrors,
        rateLimited: traffic.rateLimited,
        errorRate: traffic.errorRate,
        /** Upper bound of the latency bin holding the median / 95th percentile. */
        p50Ms: traffic.p50Ms,
        p95Ms: traffic.p95Ms,
        trafficAvailable: traffic.requests > 0,
        incidents: (await deps.store.listIncidents()).filter(
          (row) => row.status !== "resolved",
        ),
        recentErrors: (await deps.store.listErrors({ limit: 8 })),
      };
    },

    async listErrors(filter?: { organizationId?: string; service?: string }) {
      return deps.store.listErrors(filter);
    },

    async listIncidents(organizationId?: string) {
      return deps.store.listIncidents(organizationId);
    },

    /** Active -> Acknowledged. Idempotent; refused (409) once resolved. */
    acknowledge: (id: string, actor: string) => engine.acknowledge(id, actor),

    /** Manual resolve. Idempotent. A condition that is still present reopens it. */
    resolve: (id: string, actor: string) => engine.resolve(id, actor),

    async recordFailedOperation(input: {
      organizationId?: string;
      service: string;
      operation: string;
      idempotencyKey: string;
      retryable: boolean;
      error: string;
      simulated?: boolean;
    }) {
      const existing = (await deps.store.listOperations()).find(
        (row) => row.idempotencyKey === input.idempotencyKey,
      );
      if (existing) return existing;
      const row = {
        id: reliabilityId("op"),
        organizationId: input.organizationId,
        service: input.service,
        operation: input.operation,
        idempotencyKey: input.idempotencyKey,
        status: "failed" as const,
        retryable: input.retryable,
        attempts: 1,
        lastError: redactDiagnostic(input.error),
        simulated: input.simulated !== false,
        createdAt: deps.now().toISOString(),
        updatedAt: deps.now().toISOString(),
      };
      return (await deps.store.saveOperation(row)) ?? row;
    },

    async retryOperation(id: string, actor: string) {
      const row = await deps.store.getOperation(id);
      if (!row) throw new ReliabilityError("Operation not found.", 404);
      if (
        !row.retryable ||
        row.status === "dead" ||
        row.status === "resolved"
      ) {
        throw new ReliabilityError("This operation cannot be retried.", 409);
      }
      if (row.attempts >= 3) {
        row.status = "dead";
        row.updatedAt = deps.now().toISOString();
        await deps.store.saveOperation(row);
        await deps.store.addRecovery({
          operationId: id,
          outcome: "dead",
          actor,
          at: row.updatedAt,
        });
        return row;
      }
      row.attempts += 1;
      row.status = row.attempts >= 3 ? "dead" : "retrying";
      row.updatedAt = deps.now().toISOString();
      await deps.store.saveOperation(row);
      await deps.store.addRecovery({
        operationId: id,
        outcome: row.status,
        actor,
        at: row.updatedAt,
      });
      return row;
    },

    async recordDeployment(input?: {
      status?: "successful" | "failed" | "rolled_back";
      version?: string;
    }) {
      const row = {
        id: reliabilityId("dep"),
        version: input?.version || deps.version?.() || "unknown",
        environment: deps.environment(),
        status: input?.status || "successful",
        deployedAt: deps.now().toISOString(),
      };
      await deps.store.saveDeployment(row);
      return row;
    },

    async listDeployments() {
      return deps.store.listDeployments();
    },

    async recordUsage(input: {
      service: string;
      units: number;
      centsPerUnit: number;
      organizationId?: string;
      simulated?: boolean;
    }) {
      const estimatedCents = Math.round(input.units * input.centsPerUnit);
      await deps.store.saveCost({
        id: reliabilityId("cost"),
        organizationId: input.organizationId,
        service: input.service,
        units: input.units,
        estimatedCents,
        confirmed: false,
        simulated: input.simulated !== false,
        createdAt: deps.now().toISOString(),
      });
      const total = (await deps.store.listCosts()).reduce(
        (sum, row) => sum + row.estimatedCents,
        0,
      );
      const budget = Number(process.env.RELIABILITY_BUDGET_CENTS || 10_000);
      let level: Priority | null = null;
      if (total >= budget) level = "critical";
      else if (total >= budget * 0.8) level = "high";
      else if (total >= budget * 0.5) level = "warning";
      if (level) {
        await engine.report({
          fingerprint: "costs:budget",
          service: "costs",
          category: "budget",
          priority: level,
          title: "Estimated operating cost threshold",
          summary: `Estimated spend has reached ${Math.round((total / budget) * 100)}% of the budget.`,
          // Spend only grows, so this stays open for a day after the last report.
          quietMs: 24 * 60 * MINUTE,
          correlationId: reliabilityId("req"),
          simulated: input.simulated !== false,
        });
      }
      return {
        estimatedCents,
        totalEstimatedCents: total,
        confirmed: false as const,
      };
    },

    async costs() {
      const rows = await deps.store.listCosts();
      return {
        estimated: true as const,
        confirmed: false as const,
        totalEstimatedCents: rows.reduce(
          (sum, row) => sum + row.estimatedCents,
          0,
        ),
        rows,
      };
    },

    async recordSchedulerTick() {
      await deps.store.saveHealth({
        service: "scheduler_tick",
        status: "healthy",
        detail: "cron invoked",
        checkedAt: deps.now().toISOString(),
      });
    },

    /** Every recorded failed operation, newest first. Read-only. */
    async listFailedOperations() {
      return (await deps.store.listOperations()).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
    },

    async jobs() {
      const operations = await deps.store.listOperations();
      return {
        pending: operations.filter((row) => row.status === "retrying").length,
        failed: operations.filter((row) => row.status === "failed").length,
        dead: operations.filter((row) => row.status === "dead").length,
        resolved: operations.filter((row) => row.status === "resolved").length,
      };
    },

    async fallback(organizationId: string) {
      return (
        (await deps.store.getFallback(organizationId)) ?? {
          organizationId,
          aiUnavailable: "transfer" as const,
          calendarUnavailable: "collect_request" as const,
          databaseUnavailable: "do_not_claim_saved" as const,
          transferFailed: "voicemail" as const,
          updatedAt: deps.now().toISOString(),
        }
      );
    },

    async saveFallback(
      row: Awaited<ReturnType<ReliabilityStore["getFallback"]>> & object,
    ) {
      const next = { ...row, updatedAt: deps.now().toISOString() };
      await deps.store.saveFallback(next);
      return next;
    },

    /** A database outage must not be reported as a successful write. */
    databaseResult<T>(
      available: boolean,
      value: T,
    ): { ok: true; value: T } | { ok: false; error: "database_unavailable" } {
      if (!available) return { ok: false, error: "database_unavailable" };
      return { ok: true, value };
    },
  };
}

export type ReliabilityService = ReturnType<typeof createReliabilityService>;
