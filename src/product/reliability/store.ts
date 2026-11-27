import { createId } from "@/lib/id";
import type { MonitorThresholds } from "./thresholds";
import {
  PRIORITY_RANK,
  priorityToSeverity,
  severityToPriority,
  type AlertDelivery,
  type BucketDelta,
  type FailedOperation,
  type FallbackSettings,
  type Incident,
  type Priority,
  type ProbeRecord,
  type Severity,
  type SystemError,
} from "./types";

export type TouchInput = {
  fingerprint: string;
  service: string;
  category: string;
  priority: Priority;
  title: string;
  summary?: string;
  organizationId?: string;
  affectedBusinesses?: number;
  quietMs: number;
  correlationId: string;
  simulated: boolean;
  now: string;
  /** A repeat this soon after a resolve reopens the incident instead of creating one. */
  reopenWithinMs: number;
  /** How many occurrences this call stands for (default 1). */
  occurrences?: number;
  /** Used instead of `occurrences` only when this call creates the incident. */
  initialOccurrences?: number;
};

export type TouchResult = {
  incident: Incident;
  outcome: "created" | "touched" | "reopened";
  /** Priority before this call, when the incident already existed. */
  previousPriority?: Priority;
};

export type AlertSummary = {
  pending: number;
  exhausted: number;
  sentLast24h: number;
  lastFailureAt?: string;
  lastError?: string;
};

export type PruneResult = {
  errors: number;
  incidents: number;
  probes: number;
  buckets: number;
  deliveries: number;
};

export type ReliabilityStore = {
  saveError(row: SystemError): Promise<void>;
  /** Newest first. */
  listErrors(filter?: {
    organizationId?: string;
    service?: string;
    fingerprint?: string;
    limit?: number;
  }): Promise<SystemError[]>;
  /** Errors with this fingerprint at or after `sinceIso`, optionally above low severity. */
  countErrors(fingerprint: string, sinceIso: string): Promise<number>;
  saveIncident(row: Incident): Promise<void>;
  listIncidents(organizationId?: string): Promise<Incident[]>;
  getIncident(id: string): Promise<Incident | null>;
  addIncidentEvent(input: {
    incidentId: string;
    kind: string;
    detail?: string;
    actor?: string;
    at: string;
  }): Promise<void>;
  listIncidentEvents(
    incidentId: string,
  ): Promise<{ kind: string; detail?: string; actor?: string; at: string }[]>;

  /* ---- KAN-28: fingerprinted incident lifecycle ---- */
  touchIncident(input: TouchInput): Promise<TouchResult>;
  /** Active incidents whose condition has been quiet for longer than their quiet period. */
  listRecoverableIncidents(nowIso: string): Promise<Incident[]>;
  resolveIncident(
    id: string,
    input: { at: string; by: string },
  ): Promise<Incident | null>;
  acknowledgeIncident(
    id: string,
    input: { at: string; by: string },
  ): Promise<Incident | null>;
  markIncidentAlerted(
    id: string,
    input: { at: string; priority: Priority },
  ): Promise<void>;

  /* ---- KAN-28: alert outbox (bounded retries, failures visible) ---- */
  /** False when an alert with this idempotency key already exists. */
  enqueueAlert(row: AlertDelivery): Promise<boolean>;
  /** Due rows, leased for `leaseMs` so two runs never send the same one. */
  claimDueAlerts(
    nowIso: string,
    limit: number,
    leaseMs: number,
  ): Promise<AlertDelivery[]>;
  finishAlert(
    id: string,
    patch: {
      status: AlertDelivery["status"];
      attempts: number;
      nextAttemptAt: string;
      lastError?: string;
      sentAt?: string;
    },
  ): Promise<void>;
  listAlertDeliveries(filter?: {
    incidentId?: string;
    failedOnly?: boolean;
    limit?: number;
  }): Promise<AlertDelivery[]>;
  countAlertsSince(sinceIso: string): Promise<number>;
  alertSummary(nowIso: string): Promise<AlertSummary>;

  /* ---- KAN-28: measurements ---- */
  saveProbe(row: ProbeRecord): Promise<void>;
  listProbes(sinceIso: string): Promise<ProbeRecord[]>;
  addBuckets(rows: BucketDelta[]): Promise<void>;
  listBuckets(sinceIso: string): Promise<BucketDelta[]>;
  getMeta(key: string): Promise<{ value: string; updatedAt: string } | null>;
  setMeta(key: string, value: string, at: string): Promise<void>;
  prune(
    nowIso: string,
    retention: MonitorThresholds["retention"],
  ): Promise<PruneResult>;

  saveHealth(input: {
    service: string;
    status: string;
    detail?: string;
    checkedAt: string;
  }): Promise<void>;
  listHealth(): Promise<
    { service: string; status: string; detail?: string; checkedAt: string }[]
  >;
  saveOperation(row: FailedOperation): Promise<FailedOperation | null>;
  listOperations(): Promise<FailedOperation[]>;
  getOperation(id: string): Promise<FailedOperation | null>;
  addRecovery(input: {
    operationId: string;
    outcome: string;
    actor?: string;
    at: string;
  }): Promise<void>;
  saveDeployment(input: {
    id: string;
    version: string;
    environment: string;
    status: string;
    deployedAt: string;
    deployedBy?: string;
  }): Promise<void>;
  listDeployments(): Promise<
    {
      id: string;
      version: string;
      environment: string;
      status: string;
      deployedAt: string;
    }[]
  >;
  saveCost(input: {
    id: string;
    organizationId?: string;
    service: string;
    units: number;
    estimatedCents: number;
    confirmed: boolean;
    simulated: boolean;
    createdAt: string;
  }): Promise<void>;
  listCosts(): Promise<
    {
      service: string;
      units: number;
      estimatedCents: number;
      confirmed: boolean;
      simulated: boolean;
      createdAt: string;
    }[]
  >;
  getFallback(organizationId: string): Promise<FallbackSettings | null>;
  saveFallback(row: FallbackSettings): Promise<void>;
  saveObservation(input: {
    statusClass: string;
    durationMs: number;
    at: string;
  }): Promise<void>;
  listObservations(): Promise<
    { statusClass: string; durationMs: number; at: string }[]
  >;
};

const BUCKET_KEY = (row: { at: string; scope: string }) => `${row.at}|${row.scope}`;

export function createMemoryReliabilityStore(): ReliabilityStore {
  const errors: SystemError[] = [];
  const incidents = new Map<string, Incident>();
  const events: {
    incidentId: string;
    kind: string;
    detail?: string;
    actor?: string;
    at: string;
  }[] = [];
  const health: {
    service: string;
    status: string;
    detail?: string;
    checkedAt: string;
  }[] = [];
  const operations = new Map<string, FailedOperation>();
  const deployments: {
    id: string;
    version: string;
    environment: string;
    status: string;
    deployedAt: string;
  }[] = [];
  const costs: {
    service: string;
    units: number;
    estimatedCents: number;
    confirmed: boolean;
    simulated: boolean;
    createdAt: string;
  }[] = [];
  const fallbacks = new Map<string, FallbackSettings>();
  const observations: {
    statusClass: string;
    durationMs: number;
    at: string;
  }[] = [];
  const alerts = new Map<string, AlertDelivery>();
  const probes: ProbeRecord[] = [];
  const buckets = new Map<string, BucketDelta>();
  const meta = new Map<string, { value: string; updatedAt: string }>();

  const priorityOf = (row: Incident): Priority =>
    row.priority ?? severityToPriority(row.severity);

  return {
    async saveError(row) {
      errors.push(structuredClone(row));
    },
    async listErrors(filter) {
      return errors
        .filter((row) => {
          if (
            filter?.organizationId &&
            row.organizationId !== filter.organizationId
          )
            return false;
          if (filter?.service && row.service !== filter.service) return false;
          if (filter?.fingerprint && row.fingerprint !== filter.fingerprint)
            return false;
          return true;
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, filter?.limit ?? 200)
        .map((row) => structuredClone(row));
    },
    async countErrors(fingerprint, sinceIso) {
      return errors.filter(
        (row) =>
          row.fingerprint === fingerprint &&
          row.severity !== "low" &&
          row.createdAt >= sinceIso,
      ).length;
    },
    async saveIncident(row) {
      incidents.set(row.id, structuredClone(row));
    },
    async listIncidents(organizationId) {
      return [...incidents.values()]
        .filter(
          (row) => !organizationId || row.organizationId === organizationId,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((row) => structuredClone(row));
    },
    async getIncident(id) {
      const row = incidents.get(id);
      return row ? structuredClone(row) : null;
    },
    async addIncidentEvent(input) {
      events.push(structuredClone(input));
    },
    async listIncidentEvents(incidentId) {
      return events
        .filter((row) => row.incidentId === incidentId)
        .map((row) => ({
          kind: row.kind,
          detail: row.detail,
          actor: row.actor,
          at: row.at,
        }));
    },

    async touchIncident(input) {
      const occurrences = input.occurrences ?? 1;
      const active = [...incidents.values()].find(
        (row) => row.fingerprint === input.fingerprint && row.status !== "resolved",
      );
      if (active) {
        const previousPriority = priorityOf(active);
        active.occurrenceCount = (active.occurrenceCount ?? 1) + occurrences;
        active.lastSeenAt = input.now;
        active.quietMs = input.quietMs;
        if (PRIORITY_RANK[input.priority] > PRIORITY_RANK[previousPriority]) {
          active.priority = input.priority;
          active.severity = priorityToSeverity(input.priority);
          active.title = input.title;
        }
        if (input.summary) active.summary = input.summary;
        if (input.affectedBusinesses !== undefined)
          active.affectedBusinesses = Math.max(
            active.affectedBusinesses ?? 0,
            input.affectedBusinesses,
          );
        if (active.organizationId !== input.organizationId)
          active.organizationId = undefined;
        return {
          incident: structuredClone(active),
          outcome: "touched",
          previousPriority,
        };
      }
      const reopenable = [...incidents.values()]
        .filter(
          (row) =>
            row.fingerprint === input.fingerprint &&
            row.status === "resolved" &&
            row.resolvedAt &&
            Date.parse(input.now) - Date.parse(row.resolvedAt) <=
              input.reopenWithinMs,
        )
        .sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""))[0];
      if (reopenable) {
        const previousPriority = priorityOf(reopenable);
        reopenable.status = "open";
        reopenable.resolvedAt = undefined;
        reopenable.resolvedBy = undefined;
        reopenable.acknowledgedAt = undefined;
        reopenable.acknowledgedBy = undefined;
        reopenable.reopenCount = (reopenable.reopenCount ?? 0) + 1;
        reopenable.occurrenceCount =
          (reopenable.occurrenceCount ?? 1) + occurrences;
        reopenable.lastSeenAt = input.now;
        reopenable.quietMs = input.quietMs;
        if (PRIORITY_RANK[input.priority] > PRIORITY_RANK[previousPriority]) {
          reopenable.priority = input.priority;
          reopenable.severity = priorityToSeverity(input.priority);
        }
        return {
          incident: structuredClone(reopenable),
          outcome: "reopened",
          previousPriority,
        };
      }
      const incident: Incident = {
        id: createId("inc"),
        organizationId: input.organizationId,
        service: input.service,
        severity: priorityToSeverity(input.priority),
        title: input.title,
        status: "open",
        correlationId: input.correlationId,
        createdAt: input.now,
        fingerprint: input.fingerprint,
        category: input.category,
        priority: input.priority,
        summary: input.summary,
        occurrenceCount: input.initialOccurrences ?? occurrences,
        firstSeenAt: input.now,
        lastSeenAt: input.now,
        affectedBusinesses: input.affectedBusinesses,
        quietMs: input.quietMs,
        reopenCount: 0,
        simulated: input.simulated,
      };
      incidents.set(incident.id, incident);
      return { incident: structuredClone(incident), outcome: "created" };
    },
    async listRecoverableIncidents(nowIso) {
      return [...incidents.values()]
        .filter(
          (row) =>
            row.fingerprint &&
            row.status !== "resolved" &&
            row.lastSeenAt &&
            row.quietMs !== undefined &&
            Date.parse(row.lastSeenAt) + row.quietMs <= Date.parse(nowIso),
        )
        .map((row) => structuredClone(row));
    },
    async resolveIncident(id, input) {
      const row = incidents.get(id);
      if (!row || row.status === "resolved") return null;
      row.status = "resolved";
      row.resolvedAt = input.at;
      row.resolvedBy = input.by;
      return structuredClone(row);
    },
    async acknowledgeIncident(id, input) {
      const row = incidents.get(id);
      if (!row || row.status === "resolved") return null;
      if (row.status === "open") {
        row.status = "investigating";
        row.acknowledgedAt = input.at;
        row.acknowledgedBy = input.by;
      }
      return structuredClone(row);
    },
    async markIncidentAlerted(id, input) {
      const row = incidents.get(id);
      if (!row) return;
      row.lastAlertedAt = input.at;
      if (
        !row.alertedPriority ||
        PRIORITY_RANK[input.priority] > PRIORITY_RANK[row.alertedPriority]
      )
        row.alertedPriority = input.priority;
    },

    async enqueueAlert(row) {
      if ([...alerts.values()].some((a) => a.idempotencyKey === row.idempotencyKey))
        return false;
      alerts.set(row.id, structuredClone(row));
      return true;
    },
    async claimDueAlerts(nowIso, limit, leaseMs) {
      const due = [...alerts.values()]
        .filter((row) => row.status === "pending" && row.nextAttemptAt <= nowIso)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, limit);
      for (const row of due)
        row.nextAttemptAt = new Date(Date.parse(nowIso) + leaseMs).toISOString();
      return due.map((row) => structuredClone(row));
    },
    async finishAlert(id, patch) {
      const row = alerts.get(id);
      if (!row) return;
      row.status = patch.status;
      row.attempts = patch.attempts;
      row.nextAttemptAt = patch.nextAttemptAt;
      row.lastError = patch.lastError;
      row.sentAt = patch.sentAt ?? row.sentAt;
    },
    async listAlertDeliveries(filter) {
      return [...alerts.values()]
        .filter((row) => !filter?.incidentId || row.incidentId === filter.incidentId)
        .filter(
          (row) =>
            !filter?.failedOnly || row.attempts > 0 && row.status !== "sent",
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, filter?.limit ?? 50)
        .map((row) => structuredClone(row));
    },
    async countAlertsSince(sinceIso) {
      return [...alerts.values()].filter(
        (row) => row.kind !== "digest" && row.createdAt >= sinceIso,
      ).length;
    },
    async alertSummary(nowIso) {
      const rows = [...alerts.values()];
      const failed = rows
        .filter((row) => row.lastError)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const dayAgo = new Date(Date.parse(nowIso) - 24 * 3_600_000).toISOString();
      return {
        pending: rows.filter((row) => row.status === "pending").length,
        exhausted: rows.filter((row) => row.status === "exhausted").length,
        sentLast24h: rows.filter(
          (row) => row.status === "sent" && (row.sentAt ?? "") >= dayAgo,
        ).length,
        lastFailureAt: failed?.createdAt,
        lastError: failed?.lastError,
      };
    },

    async saveProbe(row) {
      probes.push(structuredClone(row));
    },
    async listProbes(sinceIso) {
      return probes
        .filter((row) => row.at >= sinceIso)
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((row) => structuredClone(row));
    },
    async addBuckets(rows) {
      for (const row of rows) {
        const key = BUCKET_KEY(row);
        const existing = buckets.get(key);
        if (!existing) {
          buckets.set(key, structuredClone(row));
          continue;
        }
        existing.total += row.total;
        existing.s2xx += row.s2xx;
        existing.s3xx += row.s3xx;
        existing.s401 += row.s401;
        existing.s403 += row.s403;
        existing.s429 += row.s429;
        existing.s4xxOther += row.s4xxOther;
        existing.s5xx += row.s5xx;
        existing.lat = existing.lat.map((n, i) => n + (row.lat[i] ?? 0));
      }
    },
    async listBuckets(sinceIso) {
      return [...buckets.values()]
        .filter((row) => row.at >= sinceIso)
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((row) => structuredClone(row));
    },
    async getMeta(key) {
      const row = meta.get(key);
      return row ? { ...row } : null;
    },
    async setMeta(key, value, at) {
      meta.set(key, { value, updatedAt: at });
    },
    async prune(nowIso, retention) {
      const now = Date.parse(nowIso);
      const before = (ms: number) => new Date(now - ms).toISOString();
      const day = 24 * 3_600_000;
      const hour = 3_600_000;
      let removed = { errors: 0, incidents: 0, probes: 0, buckets: 0, deliveries: 0 };
      const keepErrors = errors.filter(
        (row) => row.createdAt >= before(retention.errorsDays * day),
      );
      removed.errors = errors.length - keepErrors.length;
      errors.splice(0, errors.length, ...keepErrors);
      for (const [id, row] of incidents)
        if (
          row.status === "resolved" &&
          row.resolvedAt &&
          row.resolvedAt < before(retention.resolvedIncidentsDays * day)
        ) {
          incidents.delete(id);
          removed.incidents += 1;
        }
      const keepProbes = probes.filter(
        (row) => row.at >= before(retention.probeHours * hour),
      );
      removed.probes = probes.length - keepProbes.length;
      probes.splice(0, probes.length, ...keepProbes);
      for (const [key, row] of buckets)
        if (row.at < before(retention.bucketHours * hour)) {
          buckets.delete(key);
          removed.buckets += 1;
        }
      for (const [id, row] of alerts)
        if (
          row.status !== "pending" &&
          row.createdAt < before(retention.alertDeliveryDays * day)
        ) {
          alerts.delete(id);
          removed.deliveries += 1;
        }
      removed = { ...removed };
      return removed;
    },

    async saveHealth(input) {
      health.push(input);
    },
    async listHealth() {
      return [...new Map(health.map((row) => [row.service, row])).values()];
    },
    async saveOperation(row) {
      const existing = [...operations.values()].find(
        (item) =>
          item.idempotencyKey === row.idempotencyKey && item.id !== row.id,
      );
      if (existing) return null;
      operations.set(row.id, structuredClone(row));
      return structuredClone(row);
    },
    async listOperations() {
      return [...operations.values()].map((row) => structuredClone(row));
    },
    async getOperation(id) {
      const row = operations.get(id);
      return row ? structuredClone(row) : null;
    },
    async addRecovery() {
      return;
    },
    async saveDeployment(input) {
      deployments.push(input);
    },
    async listDeployments() {
      return deployments.map((row) => structuredClone(row));
    },
    async saveCost(input) {
      costs.push(input);
    },
    async listCosts() {
      return costs.map((row) => structuredClone(row));
    },
    async getFallback(organizationId) {
      const row = fallbacks.get(organizationId);
      return row ? structuredClone(row) : null;
    },
    async saveFallback(row) {
      fallbacks.set(row.organizationId, structuredClone(row));
    },
    async saveObservation(input) {
      observations.push(input);
    },
    async listObservations() {
      return observations.slice(-500);
    },
  };
}

export function reliabilityId(prefix: string) {
  return createId(prefix);
}

export type { Severity };
