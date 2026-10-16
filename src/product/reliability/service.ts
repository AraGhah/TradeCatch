import { reliabilityId, type ReliabilityStore } from "./store";
import { redactDiagnostic, type HealthStatus, type ServiceHealth, type ServiceName, type Severity } from "./types";

export class ReliabilityError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ReliabilityError";
  }
}

const REQUIRED = new Set<ServiceName>(["api", "database", "jobs"]);

export type Probe = { service: ServiceName; status: HealthStatus; detail?: string };

export type ReliabilityDeps = {
  store: ReliabilityStore;
  now: () => Date;
  environment: () => string;
  probe: () => Promise<Probe[]>;
  notifyAdmin?: (input: { title: string; severity: Severity; simulated: boolean }) => Promise<void>;
  version?: () => string;
};

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.max(0, index)];
}

export function createReliabilityService(deps: ReliabilityDeps) {
  async function openIncident(input: { service: string; severity: Severity; title: string; organizationId?: string; correlationId: string; simulated: boolean }) {
    const open = (await deps.store.listIncidents()).find(
      (row) => row.status !== "resolved" && row.service === input.service && row.organizationId === input.organizationId,
    );
    if (open) return open;
    const incident = {
      id: reliabilityId("inc"),
      organizationId: input.organizationId,
      service: input.service,
      severity: input.severity,
      title: input.title,
      status: "open" as const,
      correlationId: input.correlationId,
      createdAt: deps.now().toISOString(),
    };
    await deps.store.saveIncident(incident);
    await deps.store.addIncidentEvent({ incidentId: incident.id, kind: "opened", at: incident.createdAt });
    await deps.notifyAdmin?.({ title: incident.title, severity: incident.severity, simulated: input.simulated });
    return incident;
  }

  return {
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
        createdAt: deps.now().toISOString(),
      };
      await deps.store.saveError(row);
      const recent = (await deps.store.listErrors({ service: input.service })).filter(
        (item) => Date.parse(item.createdAt) > deps.now().getTime() - 5 * 60_000 && item.severity !== "low",
      );
      if (input.severity === "critical" || recent.length >= 3) {
        await openIncident({
          service: input.service,
          severity: input.severity === "critical" ? "critical" : "high",
          title: `${input.service} ${input.errorCode}`,
          organizationId: input.organizationId,
          correlationId: requestId,
          simulated: row.simulated,
        });
      }
      return row;
    },

    async recordRequest(status: number, durationMs: number) {
      const statusClass = status >= 500 ? "5xx" : status >= 400 ? "4xx" : "2xx";
      await deps.store.saveObservation({ statusClass, durationMs, at: deps.now().toISOString() });
    },

    async overview() {
      const probes = await deps.probe();
      const checkedAt = deps.now().toISOString();
      const services: ServiceHealth[] = probes.map((probe) => ({
        ...probe,
        checkedAt,
        required: REQUIRED.has(probe.service),
      }));
      for (const service of services) {
        await deps.store.saveHealth({ service: service.service, status: service.status, detail: service.detail, checkedAt });
      }
      const requiredDown = services.some((service) => service.required && service.status === "unavailable");
      const requiredDegraded = services.some((service) => service.required && (service.status === "degraded" || service.status === "unknown"));
      const overall: HealthStatus = requiredDown ? "unavailable" : requiredDegraded ? "degraded" : "healthy";
      const observations = await deps.store.listObservations();
      const durations = observations.map((row) => row.durationMs);
      const serverErrors = observations.filter((row) => row.statusClass === "5xx").length;
      const errorRate = observations.length === 0 ? 0 : serverErrors / observations.length;
      return {
        overall,
        services,
        requests: observations.length,
        success: observations.filter((row) => row.statusClass === "2xx").length,
        clientErrors: observations.filter((row) => row.statusClass === "4xx").length,
        serverErrors,
        errorRate,
        averageMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
        p95Ms: percentile(durations, 0.95),
        incidents: (await deps.store.listIncidents()).filter((row) => row.status !== "resolved"),
        recentErrors: (await deps.store.listErrors()).slice(-8).reverse(),
      };
    },

    async listErrors(filter?: { organizationId?: string; service?: string }) {
      return deps.store.listErrors(filter);
    },

    async listIncidents(organizationId?: string) {
      return deps.store.listIncidents(organizationId);
    },

    async acknowledge(id: string, actor: string) {
      const incident = await deps.store.getIncident(id);
      if (!incident) throw new ReliabilityError("Incident not found.", 404);
      incident.status = "investigating";
      incident.acknowledgedAt = deps.now().toISOString();
      await deps.store.saveIncident(incident);
      await deps.store.addIncidentEvent({ incidentId: id, kind: "acknowledged", actor, at: incident.acknowledgedAt });
      return incident;
    },

    async resolve(id: string, actor: string) {
      const incident = await deps.store.getIncident(id);
      if (!incident) throw new ReliabilityError("Incident not found.", 404);
      incident.status = "resolved";
      incident.resolvedAt = deps.now().toISOString();
      await deps.store.saveIncident(incident);
      await deps.store.addIncidentEvent({ incidentId: id, kind: "resolved", actor, at: incident.resolvedAt });
      return incident;
    },

    async recordFailedOperation(input: {
      organizationId?: string;
      service: string;
      operation: string;
      idempotencyKey: string;
      retryable: boolean;
      error: string;
      simulated?: boolean;
    }) {
      const existing = (await deps.store.listOperations()).find((row) => row.idempotencyKey === input.idempotencyKey);
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
      if (!row.retryable || row.status === "dead" || row.status === "resolved") {
        throw new ReliabilityError("This operation cannot be retried.", 409);
      }
      if (row.attempts >= 3) {
        row.status = "dead";
        row.updatedAt = deps.now().toISOString();
        await deps.store.saveOperation(row);
        await deps.store.addRecovery({ operationId: id, outcome: "dead", actor, at: row.updatedAt });
        return row;
      }
      row.attempts += 1;
      row.status = row.attempts >= 3 ? "dead" : "retrying";
      row.updatedAt = deps.now().toISOString();
      await deps.store.saveOperation(row);
      await deps.store.addRecovery({ operationId: id, outcome: row.status, actor, at: row.updatedAt });
      return row;
    },

    async recordDeployment(input?: { status?: "successful" | "failed" | "rolled_back"; version?: string }) {
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

    async recordUsage(input: { service: string; units: number; centsPerUnit: number; organizationId?: string; simulated?: boolean }) {
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
      const total = (await deps.store.listCosts()).reduce((sum, row) => sum + row.estimatedCents, 0);
      const budget = Number(process.env.RELIABILITY_BUDGET_CENTS || 10_000);
      let level: Severity | null = null;
      if (total >= budget) level = "critical";
      else if (total >= budget * 0.8) level = "high";
      else if (total >= budget * 0.5) level = "medium";
      if (level) {
        await openIncident({
          service: "costs",
          severity: level,
          title: "Estimated operating cost threshold",
          correlationId: reliabilityId("req"),
          simulated: input.simulated !== false,
        });
      }
      return { estimatedCents, totalEstimatedCents: total, confirmed: false as const };
    },

    async costs() {
      const rows = await deps.store.listCosts();
      return {
        estimated: true as const,
        confirmed: false as const,
        totalEstimatedCents: rows.reduce((sum, row) => sum + row.estimatedCents, 0),
        rows,
      };
    },

    async recordSchedulerTick() {
      await deps.store.saveHealth({ service: "scheduler_tick", status: "healthy", detail: "cron invoked", checkedAt: deps.now().toISOString() });
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
      return (await deps.store.getFallback(organizationId)) ?? {
        organizationId,
        aiUnavailable: "transfer" as const,
        calendarUnavailable: "collect_request" as const,
        databaseUnavailable: "do_not_claim_saved" as const,
        transferFailed: "voicemail" as const,
        updatedAt: deps.now().toISOString(),
      };
    },

    async saveFallback(row: Awaited<ReturnType<ReliabilityStore["getFallback"]>> & object) {
      const next = { ...row, updatedAt: deps.now().toISOString() };
      await deps.store.saveFallback(next);
      return next;
    },

    /** A database outage must not be reported as a successful write. */
    databaseResult<T>(available: boolean, value: T): { ok: true; value: T } | { ok: false; error: "database_unavailable" } {
      if (!available) return { ok: false, error: "database_unavailable" };
      return { ok: true, value };
    },
  };
}

export type ReliabilityService = ReturnType<typeof createReliabilityService>;
