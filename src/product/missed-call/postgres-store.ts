import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type {
  CallRecord,
  ClientAccount,
  LeadRecord,
  MissedCallWorkflow,
  OutboundMessageRecord,
  SmsSuppressionRecord,
} from "./types";
import type { MissedCallStore } from "./store";

function normalizePhone(n: string): string {
  return n.replace(/[^\d+]/g, "");
}

const ACTIVE = ["started", "awaiting_customer", "awaiting_technician", "awaiting_human"];

let pool: Pool | null = null;

export function getPgPool(connectionString: string): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 8_000,
    });
  }
  return pool;
}

export async function closePgPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

async function q<T extends QueryResultRow>(
  client: Pool | PoolClient,
  text: string,
  params?: unknown[],
) {
  return client.query<T>(text, params);
}

/**
 * Postgres-backed MissedCallStore. Enable with:
 *   DATABASE_URL=...
 *   MISSED_CALL_DURABLE_STORE=1
 * Apply schema.sql before first use.
 */
export function createPostgresStore(connectionString: string): MissedCallStore {
  const db = getPgPool(connectionString);

  return {
    async getClient(id) {
      const { rows } = await q<{ payload: ClientAccount }>(
        db,
        `SELECT payload FROM mc_clients WHERE id = $1`,
        [id],
      );
      return rows[0]?.payload ?? null;
    },

    async saveClient(client) {
      await q(
        db,
        `INSERT INTO mc_clients (id, payload, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (id) DO UPDATE
           SET payload = EXCLUDED.payload, updated_at = now()`,
        [client.id, JSON.stringify(client)],
      );
    },

    async findClientBySmsFromNumber(n) {
      const needle = normalizePhone(n);
      const { rows } = await q<{ payload: ClientAccount }>(
        db,
        `SELECT payload FROM mc_clients`,
      );
      for (const row of rows) {
        if (normalizePhone(row.payload.smsFromNumber) === needle) {
          return row.payload;
        }
      }
      return null;
    },

    async saveCall(call) {
      await q(
        db,
        `INSERT INTO mc_calls (
           id, client_account_id, caller_e164, twilio_call_sid,
           called_at, disposition, payload
         ) VALUES ($1,$2,$3,$4,$5::timestamptz,$6,$7::jsonb)
         ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`,
        [
          call.id,
          call.clientAccountId,
          call.callerE164,
          call.twilioCallSid ?? null,
          call.calledAt,
          call.disposition,
          JSON.stringify(call),
        ],
      );
    },

    async getCall(id) {
      const { rows } = await q<{ payload: CallRecord }>(
        db,
        `SELECT payload FROM mc_calls WHERE id = $1`,
        [id],
      );
      return rows[0]?.payload ?? null;
    },

    async findCallByTwilioSid(sid) {
      const { rows } = await q<{ payload: CallRecord }>(
        db,
        `SELECT payload FROM mc_calls WHERE twilio_call_sid = $1`,
        [sid],
      );
      return rows[0]?.payload ?? null;
    },

    async findActiveWorkflowByDedupeKey(dedupeKey) {
      const { rows } = await q<{ payload: MissedCallWorkflow }>(
        db,
        `SELECT payload FROM mc_workflows
         WHERE dedupe_key = $1
           AND status = ANY($2::text[])
           AND deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT 1`,
        [dedupeKey, ACTIVE],
      );
      return rows[0]?.payload ?? null;
    },

    async findActiveWorkflowByCaller(clientAccountId, callerE164) {
      const { rows } = await q<{ payload: MissedCallWorkflow }>(
        db,
        `SELECT payload FROM mc_workflows
         WHERE client_account_id = $1
           AND caller_e164 = $2
           AND status = ANY($3::text[])
           AND deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT 1`,
        [clientAccountId, callerE164, ACTIVE],
      );
      return rows[0]?.payload ?? null;
    },

    async findRecentWorkflowByCaller(clientAccountId, callerE164, withinMs, now) {
      const at = now ?? new Date();
      const since = new Date(at.getTime() - withinMs).toISOString();
      const { rows } = await q<{ payload: MissedCallWorkflow }>(
        db,
        `SELECT payload FROM mc_workflows
         WHERE client_account_id = $1
           AND caller_e164 = $2
           AND updated_at >= $3::timestamptz
           AND deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT 1`,
        [clientAccountId, callerE164, since],
      );
      return rows[0]?.payload ?? null;
    },

    async findWorkflowByTechnicianPhone(techPhoneE164, actionToken) {
      const needle = normalizePhone(techPhoneE164);
      const { rows } = await q<{ payload: MissedCallWorkflow }>(
        db,
        `SELECT payload FROM mc_workflows
         WHERE status = ANY($1::text[])
           AND deleted_at IS NULL
         ORDER BY updated_at DESC`,
        [ACTIVE],
      );
      for (const row of rows) {
        const wf = row.payload;
        const open = [...wf.technicianAlerts]
          .reverse()
          .find(
            (a) =>
              normalizePhone(a.phone) === needle &&
              !a.respondedAt &&
              (!actionToken ||
                a.actionToken.toUpperCase() === actionToken.toUpperCase()),
          );
        if (open) return wf;
      }
      return null;
    },

    async listWorkflowsAwaitingTechnician() {
      const { rows } = await q<{ payload: MissedCallWorkflow }>(
        db,
        `SELECT payload FROM mc_workflows
         WHERE status IN ('awaiting_technician', 'awaiting_human')
           AND deleted_at IS NULL`,
      );
      return rows.map((r) => r.payload);
    },

    async listWorkflowsAwaitingCustomer() {
      const { rows } = await q<{ payload: MissedCallWorkflow }>(
        db,
        `SELECT payload FROM mc_workflows
         WHERE status = 'awaiting_customer' AND deleted_at IS NULL`,
      );
      return rows.map((r) => r.payload);
    },

    async saveWorkflow(workflow) {
      await q(
        db,
        `INSERT INTO mc_workflows (
           id, client_account_id, call_id, caller_e164, status, dedupe_key,
           assigned_technician_id, escalation_stage, outcome, payload,
           created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::timestamptz,$12::timestamptz
         )
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           assigned_technician_id = EXCLUDED.assigned_technician_id,
           escalation_stage = EXCLUDED.escalation_stage,
           outcome = EXCLUDED.outcome,
           payload = EXCLUDED.payload,
           updated_at = EXCLUDED.updated_at`,
        [
          workflow.id,
          workflow.clientAccountId,
          workflow.callId,
          workflow.callerE164,
          workflow.status,
          workflow.dedupeKey,
          workflow.assignedTechnicianId ?? null,
          workflow.escalationStage,
          workflow.outcome,
          JSON.stringify(workflow),
          workflow.createdAt,
          workflow.updatedAt,
        ],
      );
    },

    async getWorkflow(id) {
      const { rows } = await q<{ payload: MissedCallWorkflow }>(
        db,
        `SELECT payload FROM mc_workflows WHERE id = $1`,
        [id],
      );
      return rows[0]?.payload ?? null;
    },

    async saveLead(lead) {
      await q(
        db,
        `INSERT INTO mc_leads (
           id, client_account_id, workflow_id, caller_e164, payload,
           created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::timestamptz,$7::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           payload = EXCLUDED.payload,
           updated_at = EXCLUDED.updated_at`,
        [
          lead.id,
          lead.clientAccountId,
          lead.workflowId,
          lead.callerE164,
          JSON.stringify(lead),
          lead.createdAt,
          lead.updatedAt,
        ],
      );
    },

    async getLead(id) {
      const { rows } = await q<{ payload: LeadRecord }>(
        db,
        `SELECT payload FROM mc_leads WHERE id = $1`,
        [id],
      );
      return rows[0]?.payload ?? null;
    },

    async getLeadByWorkflowId(workflowId) {
      const { rows } = await q<{ payload: LeadRecord }>(
        db,
        `SELECT payload FROM mc_leads WHERE workflow_id = $1`,
        [workflowId],
      );
      return rows[0]?.payload ?? null;
    },

    async listLeads(clientAccountId) {
      const { rows } = clientAccountId
        ? await q<{ payload: LeadRecord }>(
            db,
            `SELECT payload FROM mc_leads
             WHERE client_account_id = $1
             ORDER BY updated_at DESC`,
            [clientAccountId],
          )
        : await q<{ payload: LeadRecord }>(
            db,
            `SELECT payload FROM mc_leads ORDER BY updated_at DESC`,
          );
      return rows.map((r) => r.payload);
    },

    async isSmsSuppressed(clientAccountId, phoneE164) {
      const { rows } = await q(
        db,
        `SELECT 1 FROM mc_sms_suppressions
         WHERE client_account_id = $1 AND phone_e164 = $2 AND channel = 'sms'
         LIMIT 1`,
        [clientAccountId, normalizePhone(phoneE164)],
      );
      return rows.length > 0;
    },

    async addSmsSuppression(record: SmsSuppressionRecord) {
      await q(
        db,
        `INSERT INTO mc_sms_suppressions (
           client_account_id, phone_e164, channel, source, at,
           provider_status, provider_detail, reconsent_evidence, note
         ) VALUES ($1,$2,'sms',$3,$4::timestamptz,$5,$6,$7::jsonb,$8)
         ON CONFLICT (client_account_id, phone_e164, channel) DO UPDATE SET
           source = EXCLUDED.source,
           at = EXCLUDED.at,
           provider_status = EXCLUDED.provider_status,
           provider_detail = EXCLUDED.provider_detail,
           note = EXCLUDED.note`,
        [
          record.clientAccountId,
          normalizePhone(record.phoneE164),
          record.source,
          record.at,
          record.providerStatus,
          record.providerDetail ?? null,
          record.reConsentEvidence
            ? JSON.stringify(record.reConsentEvidence)
            : null,
          record.note ?? null,
        ],
      );
    },

    async claimInboundMessageSid(messageSid) {
      const { rowCount } = await q(
        db,
        `INSERT INTO mc_inbound_message_sids (message_sid)
         VALUES ($1)
         ON CONFLICT (message_sid) DO NOTHING`,
        [messageSid],
      );
      return (rowCount ?? 0) > 0;
    },

    async enqueueOutbound(message) {
      await q(
        db,
        `INSERT INTO mc_outbound_messages (
           id, workflow_id, client_account_id, to_e164, from_e164, body, detail,
           status, provider_sid, attempts, last_error, created_at, updated_at, sent_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,$13::timestamptz,$14::timestamptz
         )
         ON CONFLICT (id) DO NOTHING`,
        [
          message.id,
          message.workflowId ?? null,
          message.clientAccountId,
          message.toE164,
          message.fromE164,
          message.body,
          message.detail ?? null,
          message.status,
          message.providerSid ?? null,
          message.attempts,
          message.lastError ?? null,
          message.createdAt,
          message.updatedAt,
          message.sentAt ?? null,
        ],
      );
    },

    async claimOutboundForSend(limit) {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<{
          id: string;
          workflow_id: string | null;
          client_account_id: string;
          to_e164: string;
          from_e164: string;
          body: string;
          detail: string | null;
          status: string;
          provider_sid: string | null;
          attempts: number;
          last_error: string | null;
          created_at: Date;
          updated_at: Date;
          sent_at: Date | null;
        }>(
          `UPDATE mc_outbound_messages AS m
           SET status = 'sending', updated_at = now()
           FROM (
             SELECT id FROM mc_outbound_messages
             WHERE status IN ('queued', 'retry')
             ORDER BY created_at ASC
             FOR UPDATE SKIP LOCKED
             LIMIT $1
           ) AS picked
           WHERE m.id = picked.id
           RETURNING m.id, m.workflow_id, m.client_account_id, m.to_e164, m.from_e164,
                     m.body, m.detail, m.status, m.provider_sid, m.attempts, m.last_error,
                     m.created_at, m.updated_at, m.sent_at`,
          [limit],
        );
        await client.query("COMMIT");
        return rows.map((row) => ({
          id: row.id,
          workflowId: row.workflow_id ?? undefined,
          clientAccountId: row.client_account_id,
          toE164: row.to_e164,
          fromE164: row.from_e164,
          body: row.body,
          detail: row.detail ?? undefined,
          status: row.status as OutboundMessageRecord["status"],
          providerSid: row.provider_sid ?? undefined,
          attempts: row.attempts,
          lastError: row.last_error ?? undefined,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
          sentAt: row.sent_at?.toISOString(),
        }));
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async markOutboundSent(id, providerSid) {
      await q(
        db,
        `UPDATE mc_outbound_messages
         SET status = 'sent',
             provider_sid = $2,
             attempts = attempts + 1,
             sent_at = now(),
             updated_at = now(),
             last_error = NULL
         WHERE id = $1`,
        [id, providerSid],
      );
    },

    async markOutboundFailed(id, error, nextStatus) {
      await q(
        db,
        `UPDATE mc_outbound_messages
         SET status = $2,
             last_error = $3,
             attempts = attempts + 1,
             updated_at = now()
         WHERE id = $1`,
        [id, nextStatus, error],
      );
    },
  };
}
