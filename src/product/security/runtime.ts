import { getPgPool } from "@/product/missed-call/postgres-store";
import { getSaasStore } from "@/product/saas/runtime";
import { requireSealingSecret } from "@/product/saas/auth/secret";
import { createSecurityService } from "./service";
import { createMemorySecurityStore, type SecurityStore } from "./store";

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

function createPostgresSecurityStore(connectionString: string): SecurityStore {
  const pool = getPgPool(connectionString);
  return {
    async saveAudit(row) {
      await pool.query(
        `INSERT INTO tc_audit_logs (id, organization_id, actor_user_id, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [row.id, row.organizationId ?? null, row.actorUserId ?? null, row.action, row.target ?? null, row.detail ?? null, row.createdAt],
      );
    },
    async listAudit(organizationId) {
      const res = await pool.query(`SELECT * FROM tc_audit_logs WHERE ($1::text IS NULL OR organization_id = $1) ORDER BY created_at DESC LIMIT 200`, [organizationId ?? null]);
      return res.rows.map((row) => ({
        id: String(row.id),
        organizationId: row.organization_id ? String(row.organization_id) : undefined,
        actorUserId: row.actor_user_id ? String(row.actor_user_id) : undefined,
        action: String(row.action),
        target: row.target ? String(row.target) : undefined,
        detail: row.detail ? String(row.detail) : undefined,
        createdAt: new Date(String(row.created_at)).toISOString(),
      }));
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
