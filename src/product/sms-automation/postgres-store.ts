import { phoneKey } from "@/product/crm/phone";
import { getPgPool } from "@/product/missed-call/postgres-store";
import type { AutomationStore } from "./store";
import type {
  AutomationConfig,
  AutomationRecord,
  AutomationType,
  ConsentBasis,
  ConsentRecord,
  ExecutionRecord,
  HistoryRow,
  JobPayload,
  JobRecord,
  JobStatus,
  MessageCategory,
  ResponseStatus,
  SuppressionRecord,
  TemplateKey,
  TemplateRecord,
} from "./types";

const PHONE_KEY_SQL = (column: string) => `
  CASE
    WHEN length(regexp_replace(${column}, '\\D', '', 'g')) = 11
     AND regexp_replace(${column}, '\\D', '', 'g') LIKE '1%'
    THEN substring(regexp_replace(${column}, '\\D', '', 'g') from 2)
    ELSE regexp_replace(${column}, '\\D', '', 'g')
  END
`;

const iso = (v: unknown) => new Date(v as string | Date).toISOString();
const isoOpt = (v: unknown) => (v ? iso(v) : undefined);

function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function mapAutomation(r: Record<string, unknown>): AutomationRecord {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    type: String(r.type) as AutomationType,
    enabled: Boolean(r.enabled),
    config: json<AutomationConfig>(r.config_json, {} as AutomationConfig),
    successCount: Number(r.success_count ?? 0),
    failureCount: Number(r.failure_count ?? 0),
    responseCount: Number(r.response_count ?? 0),
    lastExecutionStatus: (r.last_execution_status as string) || undefined,
    lastExecutionAt: isoOpt(r.last_execution_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function mapTemplate(r: Record<string, unknown>): TemplateRecord {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    templateKey: String(r.template_key) as TemplateKey,
    locale: r.locale === "en" ? "en" : "fr",
    body: String(r.body),
    customized: Boolean(r.customized),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function mapJob(r: Record<string, unknown>): JobRecord {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    automationId: String(r.automation_id),
    automationType: String(r.automation_type) as AutomationType,
    idempotencyKey: String(r.idempotency_key),
    scheduledAt: iso(r.scheduled_at),
    status: String(r.status) as JobStatus,
    attempts: Number(r.attempts ?? 0),
    claimToken: (r.claim_token as string) || undefined,
    claimedAt: isoOpt(r.claimed_at),
    submittedAt: isoOpt(r.submitted_at),
    providerMessageSid: (r.provider_message_sid as string) || undefined,
    customerPhoneE164: String(r.customer_phone_e164),
    simulated: Boolean(r.simulated),
    cancelReason: (r.cancel_reason as string) || undefined,
    lastError: (r.last_error as string) || undefined,
    responseStatus: (String(r.response_status || "none") as ResponseStatus),
    price: (r.price as string) || undefined,
    priceUnit: (r.price_unit as string) || undefined,
    payload: json<JobPayload>(r.payload_json, {} as JobPayload),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export function createPostgresAutomationStore(databaseUrl: string): AutomationStore {
  const pool = getPgPool(databaseUrl);

  return {
    async upsertAutomation(row) {
      const { rows } = await pool.query(
        `INSERT INTO tc_sms_automations (
           id, organization_id, type, enabled, config_json,
           success_count, failure_count, response_count,
           last_execution_status, last_execution_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (organization_id, type) DO UPDATE
           SET enabled = EXCLUDED.enabled,
               config_json = EXCLUDED.config_json,
               updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          row.id,
          row.organizationId,
          row.type,
          row.enabled,
          JSON.stringify(row.config),
          row.successCount,
          row.failureCount,
          row.responseCount,
          row.lastExecutionStatus ?? null,
          row.lastExecutionAt ?? null,
          row.createdAt,
          row.updatedAt,
        ],
      );
      return mapAutomation(rows[0]);
    },
    async getAutomation(organizationId, id) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_sms_automations WHERE organization_id = $1 AND id = $2`,
        [organizationId, id],
      );
      return rows[0] ? mapAutomation(rows[0]) : null;
    },
    async getAutomationByType(organizationId, type) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_sms_automations WHERE organization_id = $1 AND type = $2`,
        [organizationId, type],
      );
      return rows[0] ? mapAutomation(rows[0]) : null;
    },
    async listAutomations(organizationId) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_sms_automations WHERE organization_id = $1 ORDER BY type`,
        [organizationId],
      );
      return rows.map(mapAutomation);
    },
    async upsertTemplate(row) {
      const { rows } = await pool.query(
        `INSERT INTO tc_sms_templates (
           id, organization_id, template_key, locale, body, customized, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (organization_id, template_key, locale) DO UPDATE
           SET body = EXCLUDED.body,
               customized = EXCLUDED.customized,
               updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          row.id,
          row.organizationId,
          row.templateKey,
          row.locale,
          row.body,
          row.customized,
          row.createdAt,
          row.updatedAt,
        ],
      );
      return mapTemplate(rows[0]);
    },
    async listTemplates(organizationId) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_sms_templates WHERE organization_id = $1 ORDER BY template_key, locale`,
        [organizationId],
      );
      return rows.map(mapTemplate);
    },
    async getTemplate(organizationId, templateKey, locale) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_sms_templates
         WHERE organization_id = $1 AND template_key = $2 AND locale = $3`,
        [organizationId, templateKey, locale],
      );
      return rows[0] ? mapTemplate(rows[0]) : null;
    },
    async insertJob(row) {
      const { rows } = await pool.query(
        `INSERT INTO tc_sms_jobs (
           id, organization_id, automation_id, automation_type, idempotency_key,
           scheduled_at, status, attempts, customer_phone_e164, simulated,
           response_status, payload_json, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [
          row.id,
          row.organizationId,
          row.automationId,
          row.automationType,
          row.idempotencyKey,
          row.scheduledAt,
          row.status,
          row.attempts,
          row.customerPhoneE164,
          row.simulated,
          row.responseStatus,
          JSON.stringify(row.payload),
          row.createdAt,
          row.updatedAt,
        ],
      );
      return rows[0] ? mapJob(rows[0]) : null;
    },
    async getJob(organizationId, id) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_sms_jobs WHERE organization_id = $1 AND id = $2`,
        [organizationId, id],
      );
      return rows[0] ? mapJob(rows[0]) : null;
    },
    async getJobByIdempotency(organizationId, key) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_sms_jobs WHERE organization_id = $1 AND idempotency_key = $2`,
        [organizationId, key],
      );
      return rows[0] ? mapJob(rows[0]) : null;
    },
    async getJobByProviderSid(sid) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_sms_jobs WHERE provider_message_sid = $1`,
        [sid],
      );
      return rows[0] ? mapJob(rows[0]) : null;
    },
    async listJobs(organizationId, limit) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_sms_jobs
         WHERE organization_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [organizationId, limit],
      );
      return rows.map(mapJob);
    },
    async hasJobForQuote(organizationId, quoteThreadId) {
      const { rows } = await pool.query(
        `SELECT 1 FROM tc_sms_jobs
         WHERE organization_id = $1
           AND payload_json->>'quoteThreadId' = $2
           AND status NOT IN ('canceled', 'skipped')
         LIMIT 1`,
        [organizationId, quoteThreadId],
      );
      return rows.length > 0;
    },
    async findRecentJob(input) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_sms_jobs
         WHERE organization_id = $1
           AND automation_type = $2
           AND ${PHONE_KEY_SQL("customer_phone_e164")} = $3
           AND created_at >= $4
           AND status NOT IN ('canceled', 'skipped', 'failed')
         ORDER BY created_at DESC
         LIMIT 1`,
        [
          input.organizationId,
          input.automationType,
          phoneKey(input.phoneE164),
          input.sinceIso,
        ],
      );
      return rows[0] ? mapJob(rows[0]) : null;
    },
    async claimNext(input) {
      await pool.query(
        `UPDATE tc_sms_jobs
         SET status = 'uncertain',
             last_error = 'provider_outcome_unreconciled',
             updated_at = now()
         WHERE status = 'processing'
           AND provider_message_sid IS NOT NULL
           AND claimed_at < now() - interval '10 minutes'`,
      );
      await pool.query(
        `UPDATE tc_sms_jobs
         SET status = 'pending', claim_token = NULL, claimed_at = NULL, updated_at = now()
         WHERE status = 'processing'
           AND provider_message_sid IS NULL
           AND claimed_at < now() - interval '10 minutes'`,
      );
      const { rows } = await pool.query(
        `UPDATE tc_sms_jobs
         SET status = 'processing',
             claim_token = $1,
             claimed_at = $2::timestamptz,
             updated_at = $2::timestamptz
         WHERE id = (
           SELECT id FROM tc_sms_jobs
           WHERE status = 'pending'
             AND ($3::text IS NULL OR organization_id = $3)
             AND ($4::boolean IS NOT TRUE OR simulated = true)
             AND ($5::text IS NULL OR id = $5)
             AND ($5::text IS NOT NULL OR scheduled_at <= $2::timestamptz)
           ORDER BY scheduled_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         RETURNING *`,
        [
          `claim_${Date.now()}`,
          input.nowIso,
          input.organizationId ?? null,
          input.simulatedOnly ?? false,
          input.forceJobId ?? null,
        ],
      );
      return rows[0] ? mapJob(rows[0]) : null;
    },
    async saveJob(job) {
      await pool.query(
        `UPDATE tc_sms_jobs SET
           status = $3,
           attempts = $4,
           claim_token = $5,
           claimed_at = $6,
           submitted_at = $7,
           provider_message_sid = $8,
           simulated = $9,
           cancel_reason = $10,
           last_error = $11,
           response_status = $12,
           price = $13,
           price_unit = $14,
           payload_json = $15::jsonb,
           scheduled_at = $16,
           updated_at = $17
         WHERE id = $1 AND organization_id = $2`,
        [
          job.id,
          job.organizationId,
          job.status,
          job.attempts,
          job.claimToken ?? null,
          job.claimedAt ?? null,
          job.submittedAt ?? null,
          job.providerMessageSid ?? null,
          job.simulated,
          job.cancelReason ?? null,
          job.lastError ?? null,
          job.responseStatus,
          job.price ?? null,
          job.priceUnit ?? null,
          JSON.stringify(job.payload),
          job.scheduledAt,
          job.updatedAt,
        ],
      );
    },
    async cancelPending(input) {
      const { rowCount } = await pool.query(
        `UPDATE tc_sms_jobs
         SET status = 'canceled', cancel_reason = $2, updated_at = now()
         WHERE organization_id = $1
           AND status IN ('pending', 'processing', 'uncertain')
           AND provider_message_sid IS NULL
           AND ($3::text IS NULL OR automation_id = $3)
           AND ($4::text IS NULL OR ${PHONE_KEY_SQL("customer_phone_e164")} = $4)
           AND ($5::text IS NULL OR payload_json->>'quoteThreadId' = $5)
           AND ($6::text IS NULL OR payload_json->>'leadId' = $6)
           AND ($7::text IS NULL OR id <> $7)`,
        [
          input.organizationId,
          input.reason,
          input.automationId ?? null,
          input.phoneE164 ? phoneKey(input.phoneE164) : null,
          input.quoteThreadId ?? null,
          input.leadId ?? null,
          input.exceptJobId ?? null,
        ],
      );
      return rowCount ?? 0;
    },
    async listPendingByPhone(organizationId, phoneE164) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_sms_jobs
         WHERE organization_id = $1
           AND status IN ('pending', 'processing')
           AND ${PHONE_KEY_SQL("customer_phone_e164")} = $2`,
        [organizationId, phoneKey(phoneE164)],
      );
      return rows.map(mapJob);
    },
    async addExecution(row) {
      await pool.query(
        `INSERT INTO tc_sms_executions (
           id, organization_id, automation_id, job_id, status, result, error,
           provider_message_sid, message_body, simulated, at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          row.id,
          row.organizationId,
          row.automationId,
          row.jobId,
          row.status,
          row.result ?? null,
          row.error ?? null,
          row.providerMessageSid ?? null,
          row.messageBody ?? null,
          row.simulated,
          row.at,
        ],
      );
    },
    async listHistory(organizationId, limit) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_sms_jobs
         WHERE organization_id = $1
         ORDER BY updated_at DESC
         LIMIT $2`,
        [organizationId, limit],
      );
      return rows.map(mapJob).map(
        (job): HistoryRow => ({
          jobId: job.id,
          organizationId: job.organizationId,
          customerName: job.payload.customerName,
          customerPhoneE164: job.customerPhoneE164,
          leadId: job.payload.leadId,
          automationType: job.automationType,
          messageBody: job.payload.renderedBody,
          scheduledAt: job.scheduledAt,
          submittedAt: job.submittedAt,
          providerMessageSid: job.providerMessageSid,
          status: job.status,
          responseStatus: job.responseStatus,
          error: job.lastError,
          price: job.price,
          priceUnit: job.priceUnit,
          simulated: job.simulated,
          cancelReason: job.cancelReason,
        }),
      );
    },
    async bumpStats(organizationId, automationId, patch) {
      await pool.query(
        `UPDATE tc_sms_automations SET
           success_count = success_count + $3,
           failure_count = failure_count + $4,
           response_count = response_count + $5,
           last_execution_status = COALESCE($6, last_execution_status),
           last_execution_at = COALESCE($7::timestamptz, last_execution_at),
           updated_at = now()
         WHERE organization_id = $1 AND id = $2`,
        [
          organizationId,
          automationId,
          patch.success ?? 0,
          patch.failure ?? 0,
          patch.response ?? 0,
          patch.lastStatus ?? null,
          patch.lastAt ?? null,
        ],
      );
    },
    async addSuppression(row) {
      const { rows } = await pool.query(
        `INSERT INTO tc_sms_suppressions (
           id, organization_id, phone_e164, phone_key, reason, source, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (organization_id, phone_key) DO NOTHING
         RETURNING *`,
        [
          row.id,
          row.organizationId,
          row.phoneE164,
          row.phoneKey,
          row.reason,
          row.source,
          row.createdAt,
        ],
      );
      if (!rows[0]) {
        const existing = await pool.query(
          `SELECT * FROM tc_sms_suppressions WHERE organization_id = $1 AND phone_key = $2`,
          [row.organizationId, row.phoneKey],
        );
        const found = existing.rows[0];
        return {
          id: String(found.id),
          organizationId: String(found.organization_id),
          phoneE164: String(found.phone_e164),
          phoneKey: String(found.phone_key),
          reason: String(found.reason),
          source: String(found.source),
          createdAt: iso(found.created_at),
        };
      }
      return {
        id: String(rows[0].id),
        organizationId: String(rows[0].organization_id),
        phoneE164: String(rows[0].phone_e164),
        phoneKey: String(rows[0].phone_key),
        reason: String(rows[0].reason),
        source: String(rows[0].source),
        createdAt: iso(rows[0].created_at),
      };
    },
    async isSuppressed(organizationId, phoneE164) {
      const { rows } = await pool.query(
        `SELECT 1 FROM tc_sms_suppressions WHERE organization_id = $1 AND phone_key = $2`,
        [organizationId, phoneKey(phoneE164)],
      );
      return rows.length > 0;
    },
    async addConsent(row) {
      await pool.query(
        `INSERT INTO tc_sms_consent (
           id, organization_id, phone_e164, purpose, basis, evidence, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          row.id,
          row.organizationId,
          row.phoneE164,
          row.purpose,
          row.basis,
          row.evidence,
          row.createdAt,
        ],
      );
      return row;
    },
    async latestConsent(organizationId, phoneE164, purpose) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_sms_consent
         WHERE organization_id = $1 AND purpose = $2
           AND ${PHONE_KEY_SQL("phone_e164")} = $3
         ORDER BY created_at DESC
         LIMIT 1`,
        [organizationId, purpose, phoneKey(phoneE164)],
      );
      const r = rows[0];
      if (!r) return null;
      return {
        id: String(r.id),
        organizationId: String(r.organization_id),
        phoneE164: String(r.phone_e164),
        purpose: String(r.purpose) as MessageCategory,
        basis: String(r.basis) as ConsentBasis,
        evidence: String(r.evidence),
        createdAt: iso(r.created_at),
      };
    },
    async addEvent(input) {
      await pool.query(
        `INSERT INTO tc_sms_automation_events (
           id, organization_id, automation_id, job_id, kind, detail, at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          `evt_${crypto.randomUUID()}`,
          input.organizationId,
          input.automationId ?? null,
          input.jobId ?? null,
          input.kind,
          input.detail ?? null,
          input.at,
        ],
      );
    },
    async claimWebhook(provider, eventId) {
      const { rowCount } = await pool.query(
        `INSERT INTO tc_sms_webhook_events (provider, event_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [provider, eventId],
      );
      return (rowCount ?? 0) > 0;
    },
  };
}
