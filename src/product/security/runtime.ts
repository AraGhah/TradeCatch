import type { Pool } from "pg";
import { getPgPool } from "@/lib/postgres-pool";
import { getSaasStore } from "@/product/saas/runtime";
import { requireSealingSecret } from "@/product/saas/auth/secret";
import { sanitizeChanges } from "./audit-changes";
import { createSecurityService } from "./service";
import {
  clampAuditPage,
  createMemorySecurityStore,
  type AuditEvent,
  type AuditOutcome,
  type SecurityStore,
} from "./store";

const globalForSecurity = globalThis as unknown as { __tradecatchSecurity?: SecurityStore };

function store(): SecurityStore {
  if (!globalForSecurity.__tradecatchSecurity) {
    const url = process.env.DATABASE_URL?.trim();
    const durable = process.env.MISSED_CALL_DURABLE_STORE === "1" || process.env.SAAS_DURABLE_STORE === "1";
    globalForSecurity.__tradecatchSecurity = durable && url ? createPostgresSecurityStore(url) : createMemorySecurityStore();
  }
  return globalForSecurity.__tradecatchSecurity;
}

export function getSecurityService() {
  return createSecurityService({
    store: store(),
    now: () => new Date(),
    secret: () => requireSealingSecret(),
    listSessions: (userId) => getSaasStore().listSessionsForUser(userId),
    revokeSession: (id, at) => getSaasStore().revokeSession(id, at),
  });
}

export function resetSecurityRuntimeForTests() {
  delete globalForSecurity.__tradecatchSecurity;
}

/** `pool` is injectable so tests can run the real SQL against an embedded Postgres. */
export function createPostgresSecurityStore(
  connectionString: string,
  pool: Pick<Pool, "query"> = getPgPool(connectionString),
): SecurityStore {
  return {
    async saveAudit(row) {
      try {
        await pool.query(
          `INSERT INTO tc_audit_logs (id, organization_id, actor_user_id, actor_email, actor_role, action, target, detail, outcome, changes, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
          [
            row.id,
            row.organizationId ?? null,
            row.actorUserId ?? null,
            row.actorEmail ?? null,
            row.actorRole ?? null,
            row.action,
            row.target ?? null,
            row.detail ?? null,
            row.outcome ?? "success",
            row.changes?.length ? JSON.stringify(row.changes) : null,
            row.createdAt,
          ],
        );
      } catch (error) {
        // 42703 = undefined_column: the database has not had migration
        // 041_admin_console yet. Keep recording the original fields rather
        // than silently losing the audit trail during a rollout.
        if ((error as { code?: string }).code !== "42703") throw error;
        await pool.query(
          `INSERT INTO tc_audit_logs (id, organization_id, actor_user_id, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [row.id, row.organizationId ?? null, row.actorUserId ?? null, row.action, row.target ?? null, row.detail ?? null, row.createdAt],
        );
      }
    },
    async listAudit(organizationId) {
      const res = await pool.query(`SELECT * FROM tc_audit_logs WHERE ($1::text IS NULL OR organization_id = $1) ORDER BY created_at DESC LIMIT 200`, [organizationId ?? null]);
      return res.rows.map(auditRowFrom);
    },
    async searchAudit(filter) {
      const { limit, offset } = clampAuditPage(filter);
      const where: string[] = [];
      const params: unknown[] = [];
      const add = (sql: string, value: unknown) => {
        params.push(value);
        where.push(sql.replace("?", `$${params.length}`));
      };
      if (filter.action) add("action = ?", filter.action);
      if (filter.actorUserId) add("actor_user_id = ?", filter.actorUserId);
      if (filter.organizationId) add("organization_id = ?", filter.organizationId);
      if (filter.outcome) add("outcome = ?", filter.outcome);
      if (filter.from) add("created_at >= ?::date", filter.from);
      if (filter.to) add("created_at < (?::date + 1)", filter.to);
      const q = filter.q?.trim();
      if (q) {
        // Escape LIKE wildcards so a search for "100%" matches literally.
        params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
        const p = `$${params.length}`;
        where.push(
          `(action ILIKE ${p} OR target ILIKE ${p} OR detail ILIKE ${p} OR actor_email ILIKE ${p} OR organization_id ILIKE ${p})`,
        );
      }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const total = await pool.query(`SELECT count(*)::int AS n FROM tc_audit_logs ${clause}`, params);
      const res = await pool.query(
        `SELECT * FROM tc_audit_logs ${clause} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      return { rows: res.rows.map(auditRowFrom), total: Number(total.rows[0]?.n || 0) };
    },
    async saveAttempt(email, at) {
      await pool.query(`INSERT INTO tc_login_attempts (id, email, created_at) VALUES ($1,$2,$3)`, [`att_${crypto.randomUUID()}`, email, at]);
    },
    async countAttempts(email, sinceMs, nowMs) {
      const res = await pool.query(`SELECT count(*)::int AS n FROM tc_login_attempts WHERE email = $1 AND created_at >= $2`, [email, new Date(nowMs - sinceMs).toISOString()]);
      return Number(res.rows[0]?.n || 0);
    },
    async saveMfa(input) {
      await pool.query(
        `INSERT INTO tc_mfa_secrets (user_id, secret_ciphertext, enabled, updated_at) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id) DO UPDATE SET secret_ciphertext = EXCLUDED.secret_ciphertext, enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
        [input.userId, input.ciphertext, input.enabled, input.updatedAt],
      );
    },
    async getMfa(userId) {
      const res = await pool.query(`SELECT secret_ciphertext, enabled FROM tc_mfa_secrets WHERE user_id = $1`, [userId]);
      const row = res.rows[0];
      return row ? { ciphertext: String(row.secret_ciphertext), enabled: Boolean(row.enabled) } : null;
    },
    async saveMfaVerification(input) {
      await pool.query(
        `INSERT INTO tc_mfa_verifications (session_id, user_id, verified_at) VALUES ($1,$2,$3)
         ON CONFLICT (session_id) DO UPDATE SET verified_at = EXCLUDED.verified_at`,
        [input.sessionId, input.userId, input.verifiedAt],
      );
    },
    async hasMfaVerification(sessionId) {
      const res = await pool.query(`SELECT 1 FROM tc_mfa_verifications WHERE session_id = $1`, [sessionId]);
      return Boolean(res.rows[0]);
    },
    async saveRecording(row) {
      await pool.query(
        `INSERT INTO tc_recording_permissions (organization_id, disclosure_enabled, recording_enabled, retention_days, on_denied, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (organization_id) DO UPDATE SET
           disclosure_enabled = EXCLUDED.disclosure_enabled,
           recording_enabled = EXCLUDED.recording_enabled,
           retention_days = EXCLUDED.retention_days,
           on_denied = EXCLUDED.on_denied,
           updated_at = EXCLUDED.updated_at`,
        [row.organizationId, row.disclosureEnabled, row.recordingEnabled, row.retentionDays, row.onDenied, row.updatedAt],
      );
      await pool.query(
        `INSERT INTO tc_data_retention_policies (id, organization_id, category, retain_days)
         VALUES ($1,$2,'recordings',$3), ($4,$2,'transcripts',$3)
         ON CONFLICT (organization_id, category) DO UPDATE SET retain_days = EXCLUDED.retain_days`,
        [`ret_${row.organizationId}_recordings`, row.organizationId, row.retentionDays, `ret_${row.organizationId}_transcripts`],
      );
    },
    async getRecording(organizationId) {
      const res = await pool.query(`SELECT * FROM tc_recording_permissions WHERE organization_id = $1`, [organizationId]);
      const row = res.rows[0];
      if (!row) return null;
      return {
        organizationId,
        disclosureEnabled: Boolean(row.disclosure_enabled),
        recordingEnabled: Boolean(row.recording_enabled),
        retentionDays: Number(row.retention_days),
        onDenied: row.on_denied,
        updatedAt: new Date(String(row.updated_at)).toISOString(),
      };
    },
    async saveConsent(input) {
      await pool.query(
        `INSERT INTO tc_consent_records (id, organization_id, subject_ref, purpose, status, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [input.id, input.organizationId, input.subjectRef, input.purpose, input.status, input.createdAt],
      );
    },
    async saveRequest(row) {
      await pool.query(
        `INSERT INTO tc_privacy_requests (id, organization_id, kind, status, subject_ref, created_at, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, completed_at = EXCLUDED.completed_at`,
        [row.id, row.organizationId, row.kind, row.status, row.subjectRef, row.createdAt, row.completedAt ?? null],
      );
    },
    async listRequests(organizationId) {
      const res = await pool.query(`SELECT * FROM tc_privacy_requests WHERE organization_id = $1 ORDER BY created_at DESC`, [organizationId]);
      return res.rows.map(requestFrom);
    },
    async getRequest(id) {
      const res = await pool.query(`SELECT * FROM tc_privacy_requests WHERE id = $1`, [id]);
      return res.rows[0] ? requestFrom(res.rows[0]) : null;
    },
    async saveIncident(row) {
      await pool.query(
        `INSERT INTO tc_security_incidents (id, organization_id, severity, summary, status, created_at, resolved_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [row.id, row.organizationId ?? null, row.severity, row.summary, row.status, row.createdAt, row.resolvedAt ?? null],
      );
    },
    async listIncidents() {
      const res = await pool.query(`SELECT * FROM tc_security_incidents ORDER BY created_at DESC LIMIT 100`);
      return res.rows.map((row) => ({
        id: String(row.id),
        organizationId: row.organization_id ? String(row.organization_id) : undefined,
        severity: row.severity,
        summary: String(row.summary),
        status: row.status,
        createdAt: new Date(String(row.created_at)).toISOString(),
        resolvedAt: row.resolved_at ? new Date(String(row.resolved_at)).toISOString() : undefined,
      }));
    },
    async claimWebhook(provider, eventId) {
      const res = await pool.query(
        `INSERT INTO tc_webhook_receipts (provider, event_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING event_id`,
        [provider, eventId],
      );
      return Boolean(res.rows[0]);
    },
  };
}

function auditRowFrom(row: Record<string, unknown>): AuditEvent {
  const changes = Array.isArray(row.changes) ? sanitizeChanges(row.changes) : undefined;
  return {
    id: String(row.id),
    organizationId: row.organization_id ? String(row.organization_id) : undefined,
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : undefined,
    actorEmail: row.actor_email ? String(row.actor_email) : undefined,
    actorRole: row.actor_role ? String(row.actor_role) : undefined,
    action: String(row.action),
    target: row.target ? String(row.target) : undefined,
    detail: row.detail ? String(row.detail) : undefined,
    outcome: row.outcome ? (String(row.outcome) as AuditOutcome) : undefined,
    changes,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function requestFrom(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    kind: row.kind as "access" | "correction" | "deletion",
    status: row.status as "open" | "completed",
    subjectRef: String(row.subject_ref),
    createdAt: new Date(String(row.created_at)).toISOString(),
    completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : undefined,
  };
}
