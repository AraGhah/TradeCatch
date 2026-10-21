import { createId } from "@/lib/id";
import { getPgPool } from "@/product/missed-call/postgres-store";
import type { ReliabilityStore } from "./store";
import type {
  FailedOperation,
  FallbackSettings,
  Incident,
  SystemError,
} from "./types";

export function createPostgresReliabilityStore(
  connectionString: string,
): ReliabilityStore {
  const pool = getPgPool(connectionString);
  return {
    async saveError(row) {
      await pool.query(
        `INSERT INTO tc_system_errors (
          id, request_id, organization_id, service, operation, error_code, severity, retryable,
          attempt_count, status, detail, environment, simulated, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          row.id,
          row.requestId,
          row.organizationId ?? null,
          row.service,
          row.operation,
          row.errorCode,
          row.severity,
          row.retryable,
          row.attemptCount,
          row.status,
          row.detail ?? null,
          row.environment,
          row.simulated,
          row.createdAt,
        ],
      );
    },
    async listErrors(filter) {
      const res = await pool.query(
        `SELECT * FROM tc_system_errors
         WHERE ($1::text IS NULL OR organization_id = $1)
           AND ($2::text IS NULL OR service = $2)
         ORDER BY created_at DESC LIMIT 200`,
        [filter?.organizationId ?? null, filter?.service ?? null],
      );
      return res.rows.map((row) => ({
        id: String(row.id),
        requestId: String(row.request_id),
        organizationId: row.organization_id
          ? String(row.organization_id)
          : undefined,
        service: String(row.service),
        operation: String(row.operation),
        errorCode: String(row.error_code),
        severity: row.severity,
        retryable: Boolean(row.retryable),
        attemptCount: Number(row.attempt_count),
        status: row.status,
        detail: row.detail ? String(row.detail) : undefined,
        environment: String(row.environment),
        simulated: Boolean(row.simulated),
        createdAt: new Date(String(row.created_at)).toISOString(),
      })) as SystemError[];
    },
    async saveIncident(row) {
      await pool.query(
        `INSERT INTO tc_system_incidents (
          id, organization_id, service, severity, title, status, correlation_id, created_at, acknowledged_at, resolved_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, acknowledged_at = EXCLUDED.acknowledged_at, resolved_at = EXCLUDED.resolved_at`,
        [
          row.id,
          row.organizationId ?? null,
          row.service,
          row.severity,
          row.title,
          row.status,
          row.correlationId,
          row.createdAt,
          row.acknowledgedAt ?? null,
          row.resolvedAt ?? null,
        ],
      );
    },
    async listIncidents(organizationId) {
      const res = await pool.query(
        `SELECT * FROM tc_system_incidents WHERE ($1::text IS NULL OR organization_id = $1) ORDER BY created_at DESC`,
        [organizationId ?? null],
      );
      return res.rows.map(incidentFrom);
    },
    async getIncident(id) {
      const res = await pool.query(
        `SELECT * FROM tc_system_incidents WHERE id = $1`,
        [id],
      );
      return res.rows[0] ? incidentFrom(res.rows[0]) : null;
    },
    async addIncidentEvent(input) {
      await pool.query(
        `INSERT INTO tc_incident_events (id, incident_id, kind, detail, actor, at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          createId("ievt"),
          input.incidentId,
          input.kind,
          input.detail ?? null,
          input.actor ?? null,
          input.at,
        ],
      );
    },
    async listIncidentEvents(incidentId) {
      const res = await pool.query(
        `SELECT kind, detail, at FROM tc_incident_events WHERE incident_id = $1 ORDER BY at`,
        [incidentId],
      );
      return res.rows.map((row) => ({
        kind: String(row.kind),
        detail: row.detail ? String(row.detail) : undefined,
        at: new Date(String(row.at)).toISOString(),
      }));
    },
    async saveHealth(input) {
      await pool.query(
        `INSERT INTO tc_health_checks (id, service, status, detail, checked_at) VALUES ($1,$2,$3,$4,$5)`,
        [
          createId("hc"),
          input.service,
          input.status,
          input.detail ?? null,
          input.checkedAt,
        ],
      );
    },
    async listHealth() {
      const res = await pool.query(
        `SELECT DISTINCT ON (service) service, status, detail, checked_at FROM tc_health_checks ORDER BY service, checked_at DESC, id DESC`,
      );
      return res.rows.map((row) => ({
        service: String(row.service),
        status: String(row.status),
        detail: row.detail ? String(row.detail) : undefined,
        checkedAt: new Date(String(row.checked_at)).toISOString(),
      }));
    },
    async saveOperation(row) {
      const res = await pool.query(
        `INSERT INTO tc_failed_operations (
          id, organization_id, service, operation, idempotency_key, status, retryable, attempts, last_error, simulated, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (idempotency_key) DO UPDATE SET status = EXCLUDED.status, attempts = EXCLUDED.attempts, last_error = EXCLUDED.last_error, updated_at = EXCLUDED.updated_at
        RETURNING id`,
        [
          row.id,
          row.organizationId ?? null,
          row.service,
          row.operation,
          row.idempotencyKey,
          row.status,
          row.retryable,
          row.attempts,
          row.lastError ?? null,
          row.simulated,
          row.createdAt,
          row.updatedAt,
        ],
      );
      return res.rows[0] ? row : null;
    },
    async listOperations() {
      const res = await pool.query(
        `SELECT * FROM tc_failed_operations ORDER BY created_at DESC LIMIT 200`,
      );
      return res.rows.map(operationFrom);
    },
    async getOperation(id) {
      const res = await pool.query(
        `SELECT * FROM tc_failed_operations WHERE id = $1`,
        [id],
      );
      return res.rows[0] ? operationFrom(res.rows[0]) : null;
    },
    async addRecovery(input) {
      await pool.query(
        `INSERT INTO tc_recovery_attempts (id, operation_id, outcome, actor, at) VALUES ($1,$2,$3,$4,$5)`,
        [
          createId("rec"),
          input.operationId,
          input.outcome,
          input.actor ?? null,
          input.at,
        ],
      );
    },
    async saveDeployment(input) {
      await pool.query(
        `INSERT INTO tc_deployments (id, version, environment, status, deployed_at, deployed_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          input.id,
          input.version,
          input.environment,
          input.status,
          input.deployedAt,
          input.deployedBy ?? null,
        ],
      );
    },
    async listDeployments() {
      const res = await pool.query(
        `SELECT id, version, environment, status, deployed_at FROM tc_deployments ORDER BY deployed_at DESC LIMIT 20`,
      );
      return res.rows.map((row) => ({
        id: String(row.id),
        version: String(row.version),
        environment: String(row.environment),
        status: String(row.status),
        deployedAt: new Date(String(row.deployed_at)).toISOString(),
      }));
    },
    async saveCost(input) {
      await pool.query(
        `INSERT INTO tc_usage_costs (id, organization_id, service, units, estimated_cents, confirmed, simulated, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          input.id,
          input.organizationId ?? null,
          input.service,
          input.units,
          input.estimatedCents,
          input.confirmed,
          input.simulated,
          input.createdAt,
        ],
      );
    },
    async listCosts() {
      const res = await pool.query(
        `SELECT service, units, estimated_cents, confirmed, simulated, created_at FROM tc_usage_costs ORDER BY created_at DESC LIMIT 100`,
      );
      return res.rows.map((row) => ({
        service: String(row.service),
        units: Number(row.units),
        estimatedCents: Number(row.estimated_cents),
        confirmed: Boolean(row.confirmed),
        simulated: Boolean(row.simulated),
        createdAt: new Date(String(row.created_at)).toISOString(),
      }));
    },
    async getFallback(organizationId) {
      const res = await pool.query(
        `SELECT * FROM tc_fallback_settings WHERE organization_id = $1`,
        [organizationId],
      );
      const row = res.rows[0];
      if (!row) return null;
      return {
        organizationId,
        aiUnavailable: row.ai_unavailable,
        calendarUnavailable: "collect_request",
        databaseUnavailable: "do_not_claim_saved",
        transferFailed: row.transfer_failed,
        updatedAt: new Date(String(row.updated_at)).toISOString(),
      } as FallbackSettings;
    },
    async saveFallback(row) {
      await pool.query(
        `INSERT INTO tc_fallback_settings (
          organization_id, ai_unavailable, calendar_unavailable, database_unavailable, transfer_failed, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (organization_id) DO UPDATE SET
          ai_unavailable = EXCLUDED.ai_unavailable,
          transfer_failed = EXCLUDED.transfer_failed,
          updated_at = EXCLUDED.updated_at`,
        [
          row.organizationId,
          row.aiUnavailable,
          row.calendarUnavailable,
          row.databaseUnavailable,
          row.transferFailed,
          row.updatedAt,
        ],
      );
    },
    async saveObservation(input) {
      await pool.query(
        `INSERT INTO tc_api_observations (id, status_class, duration_ms, at) VALUES ($1,$2,$3,$4)`,
        [createId("obs"), input.statusClass, input.durationMs, input.at],
      );
    },
    async listObservations() {
      const res = await pool.query(
        `SELECT status_class, duration_ms, at FROM tc_api_observations WHERE at > now() - interval '15 minutes' ORDER BY at DESC LIMIT 500`,
      );
      return res.rows.map((row) => ({
        statusClass: String(row.status_class),
        durationMs: Number(row.duration_ms),
        at: new Date(String(row.at)).toISOString(),
      }));
    },
  };
}

function incidentFrom(row: Record<string, unknown>): Incident {
  return {
    id: String(row.id),
    organizationId: row.organization_id
      ? String(row.organization_id)
      : undefined,
    service: String(row.service),
    severity: row.severity as Incident["severity"],
    title: String(row.title),
    status: row.status as Incident["status"],
    correlationId: String(row.correlation_id),
    createdAt: new Date(String(row.created_at)).toISOString(),
    acknowledgedAt: row.acknowledged_at
      ? new Date(String(row.acknowledged_at)).toISOString()
      : undefined,
    resolvedAt: row.resolved_at
      ? new Date(String(row.resolved_at)).toISOString()
      : undefined,
  };
}

function operationFrom(row: Record<string, unknown>): FailedOperation {
  return {
    id: String(row.id),
    organizationId: row.organization_id
      ? String(row.organization_id)
      : undefined,
    service: String(row.service),
    operation: String(row.operation),
    idempotencyKey: String(row.idempotency_key),
    status: row.status as FailedOperation["status"],
    retryable: Boolean(row.retryable),
    attempts: Number(row.attempts),
    lastError: row.last_error ? String(row.last_error) : undefined,
    simulated: Boolean(row.simulated),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}
