import type { Pool } from "pg";
import { createId } from "@/lib/id";
import { getPgPool } from "@/lib/postgres-pool";
import type {
  AlertSummary,
  PruneResult,
  ReliabilityStore,
  TouchInput,
  TouchResult,
} from "./store";
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
  type SystemError,
} from "./types";

const iso = (value: unknown) => new Date(String(value)).toISOString();
const isoOrUndefined = (value: unknown) => (value ? iso(value) : undefined);
const isUniqueViolation = (error: unknown) =>
  (error as { code?: string } | null)?.code === "23505";
/** SQL expression ranking a priority text column the same way PRIORITY_RANK does. */
const RANK_SQL = (column: string) =>
  `(CASE ${column} WHEN 'critical' THEN 2 WHEN 'high' THEN 1 ELSE 0 END)`;
/** A row's priority, falling back to its severity for incidents that predate priorities. */
const PRIORITY_SQL = `COALESCE(priority, CASE severity WHEN 'critical' THEN 'critical' WHEN 'high' THEN 'high' ELSE 'warning' END)`;

/** A connection string (production) or a ready pool (tests run the real SQL on PGlite). */
export function createPostgresReliabilityStore(
  source: string | Pick<Pool, "query">,
): ReliabilityStore {
  const pool = typeof source === "string" ? getPgPool(source) : source;

  /** One live incident per fingerprint, enforced by tc_system_incidents_live_fingerprint. */
  async function touchOnce(input: TouchInput): Promise<TouchResult | null> {
    const occurrences = input.occurrences ?? 1;
    const newRank = PRIORITY_RANK[input.priority];
    const touched = await pool.query(
      `WITH prev AS (
         SELECT id, ${PRIORITY_SQL} AS priority
         FROM tc_system_incidents
         WHERE fingerprint = $1 AND status <> 'resolved'
         FOR UPDATE
       )
       UPDATE tc_system_incidents i SET
         occurrence_count = i.occurrence_count + $2,
         last_seen_at = $3::timestamptz,
         quiet_ms = $4,
         summary = COALESCE($5::text, i.summary),
         affected_businesses = CASE
           WHEN $6::int IS NULL THEN i.affected_businesses
           ELSE GREATEST(COALESCE(i.affected_businesses, 0), $6::int) END,
         organization_id = CASE
           WHEN i.organization_id IS NOT DISTINCT FROM $7::text THEN i.organization_id
           ELSE NULL END,
         priority = CASE WHEN $8::int > ${RANK_SQL("prev.priority")} THEN $9::text ELSE prev.priority END,
         severity = CASE WHEN $8::int > ${RANK_SQL("prev.priority")} THEN $10::text ELSE i.severity END,
         title = CASE WHEN $8::int > ${RANK_SQL("prev.priority")} THEN $11::text ELSE i.title END
       FROM prev
       WHERE i.id = prev.id
       RETURNING i.*, prev.priority AS prev_priority`,
      [
        input.fingerprint,
        occurrences,
        input.now,
        input.quietMs,
        input.summary ?? null,
        input.affectedBusinesses ?? null,
        input.organizationId ?? null,
        newRank,
        input.priority,
        priorityToSeverity(input.priority),
        input.title,
      ],
    );
    if (touched.rows[0])
      return {
        incident: incidentFrom(touched.rows[0]),
        outcome: "touched",
        previousPriority: touched.rows[0].prev_priority as Priority,
      };

    const reopened = await pool.query(
      `WITH cand AS (
         SELECT id, ${PRIORITY_SQL} AS priority
         FROM tc_system_incidents
         WHERE fingerprint = $1 AND status = 'resolved'
           AND resolved_at > $3::timestamptz - ($4 * interval '1 millisecond')
         ORDER BY resolved_at DESC LIMIT 1
         FOR UPDATE
       )
       UPDATE tc_system_incidents i SET
         status = 'open', resolved_at = NULL, resolved_by = NULL,
         acknowledged_at = NULL, acknowledged_by = NULL,
         reopen_count = i.reopen_count + 1,
         occurrence_count = i.occurrence_count + $2,
         last_seen_at = $3::timestamptz,
         quiet_ms = $5,
         priority = CASE WHEN $6::int > ${RANK_SQL("cand.priority")} THEN $7::text ELSE cand.priority END,
         severity = CASE WHEN $6::int > ${RANK_SQL("cand.priority")} THEN $8::text ELSE i.severity END
       FROM cand
       WHERE i.id = cand.id
       RETURNING i.*, cand.priority AS prev_priority`,
      [
        input.fingerprint,
        occurrences,
        input.now,
        input.reopenWithinMs,
        input.quietMs,
        newRank,
        input.priority,
        priorityToSeverity(input.priority),
      ],
    );
    if (reopened.rows[0])
      return {
        incident: incidentFrom(reopened.rows[0]),
        outcome: "reopened",
        previousPriority: reopened.rows[0].prev_priority as Priority,
      };

    const created = await pool.query(
      `INSERT INTO tc_system_incidents (
         id, organization_id, service, severity, title, status, correlation_id, created_at,
         fingerprint, category, priority, summary, occurrence_count, first_seen_at, last_seen_at,
         affected_businesses, quiet_ms, reopen_count, simulated
       ) VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9,$10,$11,$12,$7,$7,$13,$14,0,$15)
       RETURNING *`,
      [
        createId("inc"),
        input.organizationId ?? null,
        input.service,
        priorityToSeverity(input.priority),
        input.title,
        input.correlationId,
        input.now,
        input.fingerprint,
        input.category,
        input.priority,
        input.summary ?? null,
        input.initialOccurrences ?? occurrences,
        input.affectedBusinesses ?? null,
        input.quietMs,
        input.simulated,
      ],
    );
    return { incident: incidentFrom(created.rows[0]), outcome: "created" };
  }

  return {
    async saveError(row) {
      await pool.query(
        `INSERT INTO tc_system_errors (
          id, request_id, organization_id, service, operation, error_code, severity, retryable,
          attempt_count, status, detail, environment, simulated, created_at, fingerprint
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
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
          row.fingerprint ?? null,
        ],
      );
    },
    async listErrors(filter) {
      const res = await pool.query(
        `SELECT * FROM tc_system_errors
         WHERE ($1::text IS NULL OR organization_id = $1)
           AND ($2::text IS NULL OR service = $2)
           AND ($3::text IS NULL OR fingerprint = $3)
         ORDER BY created_at DESC LIMIT $4`,
        [
          filter?.organizationId ?? null,
          filter?.service ?? null,
          filter?.fingerprint ?? null,
          Math.min(500, Math.max(1, filter?.limit ?? 200)),
        ],
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
        createdAt: iso(row.created_at),
        fingerprint: row.fingerprint ? String(row.fingerprint) : undefined,
      })) as SystemError[];
    },
    async countErrors(fingerprint, sinceIso) {
      const res = await pool.query(
        `SELECT count(*)::int AS n FROM tc_system_errors
         WHERE fingerprint = $1 AND created_at >= $2::timestamptz AND severity <> 'low'`,
        [fingerprint, sinceIso],
      );
      return Number(res.rows[0]?.n ?? 0);
    },
    async saveIncident(row) {
      await pool.query(
        `INSERT INTO tc_system_incidents (
          id, organization_id, service, severity, title, status, correlation_id, created_at, acknowledged_at, resolved_at,
          fingerprint, category, priority, summary, occurrence_count, first_seen_at, last_seen_at,
          acknowledged_by, resolved_by, affected_businesses, quiet_ms, reopen_count, last_alerted_at, alerted_priority, simulated
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
        ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, acknowledged_at = EXCLUDED.acknowledged_at, resolved_at = EXCLUDED.resolved_at,
          acknowledged_by = EXCLUDED.acknowledged_by, resolved_by = EXCLUDED.resolved_by`,
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
          row.fingerprint ?? null,
          row.category ?? null,
          row.priority ?? null,
          row.summary ?? null,
          row.occurrenceCount ?? 1,
          row.firstSeenAt ?? null,
          row.lastSeenAt ?? null,
          row.acknowledgedBy ?? null,
          row.resolvedBy ?? null,
          row.affectedBusinesses ?? null,
          row.quietMs ?? null,
          row.reopenCount ?? 0,
          row.lastAlertedAt ?? null,
          row.alertedPriority ?? null,
          row.simulated ?? false,
        ],
      );
    },
    async listIncidents(organizationId) {
      const res = await pool.query(
        // Active incidents first: the dashboard and the per-area status read this
        // list, and an old incident that is still open must never be crowded out
        // by newer resolved ones.
        `SELECT * FROM tc_system_incidents WHERE ($1::text IS NULL OR organization_id = $1)
         ORDER BY (status = 'resolved'), created_at DESC LIMIT 500`,
        [organizationId ?? null],
      );
      return res.rows.map(incidentFrom);
    },

    async touchIncident(input) {
      // Two runs can race to create the same incident; the unique index
      // rejects the loser, which then simply touches the winner's row.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result = await touchOnce(input);
          if (result) return result;
        } catch (error) {
          if (!isUniqueViolation(error) || attempt === 2) throw error;
        }
      }
      throw new Error("Could not record the incident");
    },
    async listRecoverableIncidents(nowIso) {
      const res = await pool.query(
        `SELECT * FROM tc_system_incidents
         WHERE fingerprint IS NOT NULL AND status <> 'resolved'
           AND last_seen_at IS NOT NULL AND quiet_ms IS NOT NULL
           AND last_seen_at + (quiet_ms * interval '1 millisecond') <= $1::timestamptz
         ORDER BY created_at LIMIT 200`,
        [nowIso],
      );
      return res.rows.map(incidentFrom);
    },
    async resolveIncident(id, input) {
      const res = await pool.query(
        `UPDATE tc_system_incidents SET status = 'resolved', resolved_at = $2::timestamptz, resolved_by = $3
         WHERE id = $1 AND status <> 'resolved' RETURNING *`,
        [id, input.at, input.by],
      );
      return res.rows[0] ? incidentFrom(res.rows[0]) : null;
    },
    async acknowledgeIncident(id, input) {
      const res = await pool.query(
        `UPDATE tc_system_incidents SET status = 'investigating', acknowledged_at = $2::timestamptz, acknowledged_by = $3
         WHERE id = $1 AND status = 'open' RETURNING *`,
        [id, input.at, input.by],
      );
      if (res.rows[0]) return incidentFrom(res.rows[0]);
      const current = await pool.query(
        `SELECT * FROM tc_system_incidents WHERE id = $1 AND status = 'investigating'`,
        [id],
      );
      return current.rows[0] ? incidentFrom(current.rows[0]) : null;
    },
    async markIncidentAlerted(id, input) {
      await pool.query(
        `UPDATE tc_system_incidents SET last_alerted_at = $2::timestamptz,
           alerted_priority = CASE
             WHEN alerted_priority IS NULL OR $4::int > ${RANK_SQL("alerted_priority")} THEN $3::text
             ELSE alerted_priority END
         WHERE id = $1`,
        [id, input.at, input.priority, PRIORITY_RANK[input.priority]],
      );
    },

    async enqueueAlert(row) {
      const res = await pool.query(
        `INSERT INTO tc_alert_deliveries (id, incident_id, kind, priority, status, attempts, next_attempt_at, idempotency_key, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [
          row.id,
          row.incidentId,
          row.kind,
          row.priority,
          row.status,
          row.attempts,
          row.nextAttemptAt,
          row.idempotencyKey,
          row.createdAt,
        ],
      );
      return (res.rowCount ?? res.rows.length) > 0;
    },
    async claimDueAlerts(nowIso, limit, leaseMs) {
      const res = await pool.query(
        `UPDATE tc_alert_deliveries SET next_attempt_at = $1::timestamptz + ($3 * interval '1 millisecond')
         WHERE id IN (
           SELECT id FROM tc_alert_deliveries
           WHERE status = 'pending' AND next_attempt_at <= $1::timestamptz
           ORDER BY created_at LIMIT $2
           FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
        [nowIso, limit, leaseMs],
      );
      return res.rows.map(alertFrom);
    },
    async finishAlert(id, patch) {
      await pool.query(
        `UPDATE tc_alert_deliveries SET status = $2, attempts = $3, next_attempt_at = $4::timestamptz,
           last_error = $5, sent_at = COALESCE($6::timestamptz, sent_at)
         WHERE id = $1`,
        [
          id,
          patch.status,
          patch.attempts,
          patch.nextAttemptAt,
          patch.lastError ?? null,
          patch.sentAt ?? null,
        ],
      );
    },
    async listAlertDeliveries(filter) {
      const res = await pool.query(
        `SELECT * FROM tc_alert_deliveries
         WHERE ($1::text IS NULL OR incident_id = $1)
           AND (NOT $2::boolean OR (attempts > 0 AND status <> 'sent'))
         ORDER BY created_at DESC LIMIT $3`,
        [
          filter?.incidentId ?? null,
          Boolean(filter?.failedOnly),
          Math.min(200, Math.max(1, filter?.limit ?? 50)),
        ],
      );
      return res.rows.map(alertFrom);
    },
    async countAlertsSince(sinceIso) {
      const res = await pool.query(
        `SELECT count(*)::int AS n FROM tc_alert_deliveries WHERE kind <> 'digest' AND created_at >= $1::timestamptz`,
        [sinceIso],
      );
      return Number(res.rows[0]?.n ?? 0);
    },
    async alertSummary(nowIso): Promise<AlertSummary> {
      const counts = await pool.query(
        `SELECT
           count(*) FILTER (WHERE status = 'pending')::int AS pending,
           count(*) FILTER (WHERE status = 'exhausted')::int AS exhausted,
           count(*) FILTER (WHERE status = 'sent' AND sent_at >= $1::timestamptz - interval '24 hours')::int AS sent
         FROM tc_alert_deliveries`,
        [nowIso],
      );
      const failure = await pool.query(
        `SELECT created_at, last_error FROM tc_alert_deliveries
         WHERE last_error IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      );
      return {
        pending: Number(counts.rows[0]?.pending ?? 0),
        exhausted: Number(counts.rows[0]?.exhausted ?? 0),
        sentLast24h: Number(counts.rows[0]?.sent ?? 0),
        lastFailureAt: isoOrUndefined(failure.rows[0]?.created_at),
        lastError: failure.rows[0]?.last_error
          ? String(failure.rows[0].last_error)
          : undefined,
      };
    },

    async saveProbe(row: ProbeRecord) {
      await pool.query(
        `INSERT INTO tc_monitor_probes (id, target, ok, status_code, duration_ms, at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [createId("probe"), row.target, row.ok, row.statusCode ?? null, row.durationMs, row.at],
      );
    },
    async listProbes(sinceIso) {
      const res = await pool.query(
        `SELECT target, ok, status_code, duration_ms, at FROM tc_monitor_probes
         WHERE at >= $1::timestamptz ORDER BY at DESC LIMIT 2000`,
        [sinceIso],
      );
      return res.rows.map((row) => ({
        target: String(row.target),
        ok: Boolean(row.ok),
        statusCode: row.status_code === null ? undefined : Number(row.status_code),
        durationMs: Number(row.duration_ms),
        at: iso(row.at),
      }));
    },
    async addBuckets(rows: BucketDelta[]) {
      if (rows.length === 0) return;
      const columns = 17;
      const params: unknown[] = [];
      const tuples = rows.map((row, index) => {
        params.push(
          row.at,
          row.scope,
          row.total,
          row.s2xx,
          row.s3xx,
          row.s401,
          row.s403,
          row.s429,
          row.s4xxOther,
          row.s5xx,
          ...[0, 1, 2, 3, 4, 5, 6].map((bin) => row.lat[bin] ?? 0),
        );
        const base = index * columns;
        return `(${Array.from({ length: columns }, (_, i) => `$${base + i + 1}`).join(",")})`;
      });
      await pool.query(
        `INSERT INTO tc_monitor_buckets (bucket_at, scope, total, s2xx, s3xx, s401, s403, s429, s4xx_other, s5xx, lat0, lat1, lat2, lat3, lat4, lat5, lat6)
         VALUES ${tuples.join(",")}
         ON CONFLICT (bucket_at, scope) DO UPDATE SET
           total = tc_monitor_buckets.total + EXCLUDED.total,
           s2xx = tc_monitor_buckets.s2xx + EXCLUDED.s2xx,
           s3xx = tc_monitor_buckets.s3xx + EXCLUDED.s3xx,
           s401 = tc_monitor_buckets.s401 + EXCLUDED.s401,
           s403 = tc_monitor_buckets.s403 + EXCLUDED.s403,
           s429 = tc_monitor_buckets.s429 + EXCLUDED.s429,
           s4xx_other = tc_monitor_buckets.s4xx_other + EXCLUDED.s4xx_other,
           s5xx = tc_monitor_buckets.s5xx + EXCLUDED.s5xx,
           lat0 = tc_monitor_buckets.lat0 + EXCLUDED.lat0,
           lat1 = tc_monitor_buckets.lat1 + EXCLUDED.lat1,
           lat2 = tc_monitor_buckets.lat2 + EXCLUDED.lat2,
           lat3 = tc_monitor_buckets.lat3 + EXCLUDED.lat3,
           lat4 = tc_monitor_buckets.lat4 + EXCLUDED.lat4,
           lat5 = tc_monitor_buckets.lat5 + EXCLUDED.lat5,
           lat6 = tc_monitor_buckets.lat6 + EXCLUDED.lat6`,
        params,
      );
    },
    async listBuckets(sinceIso) {
      const res = await pool.query(
        `SELECT * FROM tc_monitor_buckets WHERE bucket_at >= $1::timestamptz ORDER BY bucket_at DESC LIMIT 2000`,
        [sinceIso],
      );
      return res.rows.map((row) => ({
        at: iso(row.bucket_at),
        scope: row.scope === "page" ? ("page" as const) : ("api" as const),
        total: Number(row.total),
        s2xx: Number(row.s2xx),
        s3xx: Number(row.s3xx),
        s401: Number(row.s401),
        s403: Number(row.s403),
        s429: Number(row.s429),
        s4xxOther: Number(row.s4xx_other),
        s5xx: Number(row.s5xx),
        lat: [0, 1, 2, 3, 4, 5, 6].map((bin) => Number(row[`lat${bin}`] ?? 0)),
      }));
    },
    async getMeta(key) {
      const res = await pool.query(
        `SELECT value, updated_at FROM mc_ops_meta WHERE key = $1`,
        [key],
      );
      return res.rows[0]
        ? { value: String(res.rows[0].value), updatedAt: iso(res.rows[0].updated_at) }
        : null;
    },
    async setMeta(key, value, at) {
      await pool.query(
        `INSERT INTO mc_ops_meta (key, value, updated_at) VALUES ($1,$2,$3::timestamptz)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [key, value, at],
      );
    },
    async prune(nowIso, retention): Promise<PruneResult> {
      const del = async (sql: string, interval: string) => {
        const res = await pool.query(sql, [nowIso, interval]);
        return res.rowCount ?? 0;
      };
      return {
        errors: await del(
          `DELETE FROM tc_system_errors WHERE created_at < $1::timestamptz - $2::interval`,
          `${retention.errorsDays} days`,
        ),
        incidents: await del(
          `DELETE FROM tc_system_incidents WHERE status = 'resolved' AND resolved_at < $1::timestamptz - $2::interval`,
          `${retention.resolvedIncidentsDays} days`,
        ),
        probes: await del(
          `DELETE FROM tc_monitor_probes WHERE at < $1::timestamptz - $2::interval`,
          `${retention.probeHours} hours`,
        ),
        buckets: await del(
          `DELETE FROM tc_monitor_buckets WHERE bucket_at < $1::timestamptz - $2::interval`,
          `${retention.bucketHours} hours`,
        ),
        deliveries: await del(
          `DELETE FROM tc_alert_deliveries WHERE status <> 'pending' AND created_at < $1::timestamptz - $2::interval`,
          `${retention.alertDeliveryDays} days`,
        ),
      };
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
        `SELECT kind, detail, actor, at FROM tc_incident_events WHERE incident_id = $1 ORDER BY at, id LIMIT 500`,
        [incidentId],
      );
      return res.rows.map((row) => ({
        kind: String(row.kind),
        detail: row.detail ? String(row.detail) : undefined,
        actor: row.actor ? String(row.actor) : undefined,
        at: iso(row.at),
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
    acknowledgedAt: isoOrUndefined(row.acknowledged_at),
    resolvedAt: isoOrUndefined(row.resolved_at),
    fingerprint: row.fingerprint ? String(row.fingerprint) : undefined,
    category: row.category ? String(row.category) : undefined,
    priority: row.priority
      ? (String(row.priority) as Priority)
      : severityToPriority(row.severity as Incident["severity"]),
    summary: row.summary ? String(row.summary) : undefined,
    occurrenceCount: Number(row.occurrence_count ?? 1),
    firstSeenAt: isoOrUndefined(row.first_seen_at),
    lastSeenAt: isoOrUndefined(row.last_seen_at),
    acknowledgedBy: row.acknowledged_by ? String(row.acknowledged_by) : undefined,
    resolvedBy: row.resolved_by ? String(row.resolved_by) : undefined,
    affectedBusinesses:
      row.affected_businesses === null || row.affected_businesses === undefined
        ? undefined
        : Number(row.affected_businesses),
    quietMs:
      row.quiet_ms === null || row.quiet_ms === undefined
        ? undefined
        : Number(row.quiet_ms),
    reopenCount: Number(row.reopen_count ?? 0),
    lastAlertedAt: isoOrUndefined(row.last_alerted_at),
    alertedPriority: row.alerted_priority
      ? (String(row.alerted_priority) as Priority)
      : undefined,
    simulated: Boolean(row.simulated),
  };
}

function alertFrom(row: Record<string, unknown>): AlertDelivery {
  return {
    id: String(row.id),
    incidentId: row.incident_id ? String(row.incident_id) : null,
    kind: row.kind as AlertDelivery["kind"],
    priority: row.priority as Priority,
    status: row.status as AlertDelivery["status"],
    attempts: Number(row.attempts),
    nextAttemptAt: iso(row.next_attempt_at),
    lastError: row.last_error ? String(row.last_error) : undefined,
    idempotencyKey: String(row.idempotency_key),
    createdAt: iso(row.created_at),
    sentAt: isoOrUndefined(row.sent_at),
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
