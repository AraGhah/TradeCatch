import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type {
  CallRecord,
  ClientAccount,
  LeadRecord,
  MissedCallWorkflow,
  OutboundMessageRecord,
  SmsSuppressionRecord,
} from "./types";
import {
  bumpWorkflowVersion,
  ConcurrentWorkflowUpdateError,
  DuplicateActiveWorkflowError,
  OUTBOUND_STALE_SENDING_MS,
  type MissedCallStore,
} from "./store";

function normalizePhone(n: string): string {
  return n.replace(/[^\d+]/g, "");
}

const ACTIVE = [
  "started",
  "awaiting_customer",
  "awaiting_technician",
  "awaiting_human",
];

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
 * Optimistic-concurrency workflow upsert. Caller must hold a transaction
 * (BEGIN) so SELECT FOR UPDATE and the subsequent write share one connection.
 */
async function persistWorkflow(
  client: PoolClient,
  workflow: MissedCallWorkflow,
): Promise<void> {
  const existing = await q<{
    payload: MissedCallWorkflow;
    revision: number;
  }>(
    client,
    `SELECT payload, COALESCE(revision, 0)::int AS revision
     FROM mc_workflows WHERE id = $1 FOR UPDATE`,
    [workflow.id],
  );
  const row = existing.rows[0];
  const existingWf = row
    ? { ...row.payload, version: row.payload.version ?? row.revision }
    : null;
  bumpWorkflowVersion(existingWf, workflow);
  const revision = workflow.version ?? 1;

  if (!row) {
    try {
      await q(
        client,
        `INSERT INTO mc_workflows (
           id, client_account_id, call_id, caller_e164, status, dedupe_key,
           assigned_technician_id, escalation_stage, outcome, payload,
           revision, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::timestamptz,$13::timestamptz
         )`,
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
          revision,
          workflow.createdAt,
          workflow.updatedAt,
        ],
      );
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      // 23505 on mc_workflows_active_dedupe — concurrent webhook won the race.
      if (code === "23505") {
        throw new DuplicateActiveWorkflowError(workflow.dedupeKey);
      }
      throw err;
    }
    await projectWorkflowSideTables(client, workflow);
    return;
  }

  const updated = await q(
    client,
    `UPDATE mc_workflows SET
       status = $2,
       assigned_technician_id = $3,
       escalation_stage = $4,
       outcome = $5,
       payload = $6::jsonb,
       revision = $7,
       updated_at = $8::timestamptz
     WHERE id = $1 AND COALESCE(revision, 0) = $9`,
    [
      workflow.id,
      workflow.status,
      workflow.assignedTechnicianId ?? null,
      workflow.escalationStage,
      workflow.outcome,
      JSON.stringify(workflow),
      revision,
      workflow.updatedAt,
      row.revision,
    ],
  );
  if ((updated.rowCount ?? 0) === 0) {
    throw new ConcurrentWorkflowUpdateError(workflow.id);
  }
  await projectWorkflowSideTables(client, workflow);
}

async function projectWorkflowSideTables(
  client: PoolClient,
  workflow: MissedCallWorkflow,
): Promise<void> {
  for (const alert of workflow.technicianAlerts) {
    await q(
      client,
      `INSERT INTO mc_technician_alerts (
         workflow_id, technician_id, phone, action_token, stage,
         sent_at, responded_at, response
       ) VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8)
       ON CONFLICT (workflow_id, action_token) DO UPDATE SET
         responded_at = EXCLUDED.responded_at,
         response = EXCLUDED.response`,
      [
        workflow.id,
        alert.technicianId,
        alert.phone,
        alert.actionToken,
        alert.stage,
        alert.sentAt,
        alert.respondedAt ?? null,
        alert.response ?? null,
      ],
    );
  }

  // Append only newer audit events (payload is source of truth; table is queryable).
  for (const event of workflow.events.slice(-20)) {
    await q(
      client,
      `INSERT INTO mc_audit_events (workflow_id, at, event_type, detail, actor)
       SELECT $1, $2::timestamptz, $3, $4, $5
       WHERE NOT EXISTS (
         SELECT 1 FROM mc_audit_events
         WHERE workflow_id = $1
           AND at = $2::timestamptz
           AND event_type = $3
           AND COALESCE(detail, '') = COALESCE($4, '')
       )`,
      [workflow.id, event.at, event.type, event.detail ?? null, "system"],
    );
  }
}

async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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
        `INSERT INTO mc_clients (id, payload, sms_from_e164, created_at, updated_at)
         VALUES ($1, $2::jsonb, $3, now(), now())
         ON CONFLICT (id) DO UPDATE SET
           payload = EXCLUDED.payload,
           sms_from_e164 = EXCLUDED.sms_from_e164,
           updated_at = now()`,
        [client.id, JSON.stringify(client), client.smsFromNumber],
      );
    },

    async findClientBySmsFromNumber(n) {
      const needle = normalizePhone(n);
      const { rows } = await q<{ payload: ClientAccount }>(
        db,
        `SELECT payload FROM mc_clients
         WHERE sms_from_e164 = $1
            OR regexp_replace(COALESCE(sms_from_e164, ''), '[^0-9+]', '', 'g') = $2
         LIMIT 1`,
        [n, needle],
      );
      if (rows[0]) return rows[0].payload;
      // Fallback for rows created before sms_from_e164 existed.
      const { rows: all } = await q<{ payload: ClientAccount }>(
        db,
        `SELECT payload FROM mc_clients WHERE sms_from_e164 IS NULL`,
      );
      for (const row of all) {
        if (normalizePhone(row.payload.smsFromNumber) === needle) {
          return row.payload;
        }
      }
      return null;
    },

    async saveCall(call) {
      // Prefer atomic insert that returns the canonical row when twilio_call_sid
      // collides under concurrent status callbacks.
      if (call.twilioCallSid) {
        const inserted = await q<{ payload: CallRecord }>(
          db,
          `INSERT INTO mc_calls (
             id, client_account_id, caller_e164, twilio_call_sid,
             called_at, disposition, payload
           ) VALUES ($1,$2,$3,$4,$5::timestamptz,$6,$7::jsonb)
           ON CONFLICT (twilio_call_sid) DO NOTHING
           RETURNING payload`,
          [
            call.id,
            call.clientAccountId,
            call.callerE164,
            call.twilioCallSid,
            call.calledAt,
            call.disposition,
            JSON.stringify(call),
          ],
        );
        if (inserted.rows[0]?.payload) return inserted.rows[0].payload;
        const existing = await q<{ payload: CallRecord }>(
          db,
          `SELECT payload FROM mc_calls WHERE twilio_call_sid = $1`,
          [call.twilioCallSid],
        );
        if (existing.rows[0]?.payload) return existing.rows[0].payload;
      }
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
      return call;
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

    async findRecentWorkflowByCaller(
      clientAccountId,
      callerE164,
      withinMs,
      now,
    ) {
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
      const { rows: indexed } = await q<{ workflow_id: string }>(
        db,
        `SELECT workflow_id FROM mc_technician_alerts
         WHERE regexp_replace(phone, '[^0-9+]', '', 'g') = $1
           AND responded_at IS NULL
           AND ($2::text IS NULL OR upper(action_token) = upper($2))
         ORDER BY sent_at DESC
         LIMIT 1`,
        [needle, actionToken ?? null],
      );
      if (indexed[0]) {
        const { rows } = await q<{ payload: MissedCallWorkflow }>(
          db,
          `SELECT payload FROM mc_workflows
           WHERE id = $1 AND deleted_at IS NULL`,
          [indexed[0].workflow_id],
        );
        if (rows[0]) return rows[0].payload;
      }

      // Fallback for alerts not yet projected into mc_technician_alerts.
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

    async findWorkflowByCallId(callId) {
      const { rows } = await q<{ payload: MissedCallWorkflow }>(
        db,
        `SELECT payload FROM mc_workflows
         WHERE call_id = $1 AND deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT 1`,
        [callId],
      );
      return rows[0]?.payload ?? null;
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
      await withTransaction(db, (client) => persistWorkflow(client, workflow));
    },

    async saveWorkflowAndEnqueueOutbound(workflow, message) {
      await withTransaction(db, async (client) => {
        await persistWorkflow(client, workflow);
        await client.query(
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
      });
    },

    async getWorkflow(id) {
      const { rows } = await q<{ payload: MissedCallWorkflow }>(
        db,
        `SELECT payload FROM mc_workflows WHERE id = $1`,
        [id],
      );
      return rows[0]?.payload ?? null;
    },

    async claimWorkflowEscalation(workflowId, leaseMs, now) {
      const at = now ?? new Date();
      const untilIso = new Date(at.getTime() + leaseMs).toISOString();
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<{ payload: MissedCallWorkflow }>(
          `SELECT payload FROM mc_workflows
           WHERE id = $1
             AND status IN ('awaiting_technician', 'awaiting_human')
             AND deleted_at IS NULL
           FOR UPDATE`,
          [workflowId],
        );
        const wf = rows[0]?.payload;
        if (!wf) {
          await client.query("ROLLBACK");
          return null;
        }
        const heldUntil = wf.escalationClaimUntil
          ? new Date(wf.escalationClaimUntil).getTime()
          : 0;
        if (heldUntil > at.getTime()) {
          await client.query("ROLLBACK");
          return null;
        }
        wf.escalationClaimUntil = untilIso;
        wf.updatedAt = at.toISOString();
        const nextRevision = (wf.version ?? 0) + 1;
        wf.version = nextRevision;
        await client.query(
          `UPDATE mc_workflows
           SET payload = $2::jsonb,
               revision = $3,
               updated_at = $4::timestamptz
           WHERE id = $1`,
          [workflowId, JSON.stringify(wf), nextRevision, wf.updatedAt],
        );
        await client.query("COMMIT");
        return wf;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
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
        `SELECT payload FROM mc_leads WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      return rows[0]?.payload ?? null;
    },

    async getLeadByWorkflowId(workflowId) {
      const { rows } = await q<{ payload: LeadRecord }>(
        db,
        `SELECT payload FROM mc_leads
         WHERE workflow_id = $1 AND deleted_at IS NULL`,
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
               AND deleted_at IS NULL
             ORDER BY updated_at DESC`,
            [clientAccountId],
          )
        : await q<{ payload: LeadRecord }>(
            db,
            `SELECT payload FROM mc_leads
             WHERE deleted_at IS NULL
             ORDER BY updated_at DESC`,
          );
      return rows.map((r) => r.payload);
    },

    async isSmsSuppressed(clientAccountId, phoneE164, opts) {
      const { rows } = await q<{ scope: string | null }>(
        db,
        `SELECT scope FROM mc_sms_suppressions
         WHERE client_account_id = $1 AND phone_e164 = $2 AND channel = 'sms'
         LIMIT 1`,
        [clientAccountId, normalizePhone(phoneE164)],
      );
      if (!rows[0]) return false;
      const scope = rows[0].scope ?? "all";
      if (opts?.asCustomer === false && scope === "customer_outbound") {
        return false;
      }
      return true;
    },

    async addSmsSuppression(record: SmsSuppressionRecord) {
      await q(
        db,
        `INSERT INTO mc_sms_suppressions (
           client_account_id, phone_e164, channel, source, scope, at,
           provider_status, provider_detail, reconsent_evidence, note
         ) VALUES ($1,$2,'sms',$3,$4,$5::timestamptz,$6,$7,$8::jsonb,$9)
         ON CONFLICT (client_account_id, phone_e164, channel) DO UPDATE SET
           source = EXCLUDED.source,
           scope = EXCLUDED.scope,
           at = EXCLUDED.at,
           provider_status = EXCLUDED.provider_status,
           provider_detail = EXCLUDED.provider_detail,
           note = EXCLUDED.note`,
        [
          record.clientAccountId,
          normalizePhone(record.phoneE164),
          record.source,
          record.scope ?? "all",
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

    async releaseInboundMessageSid(messageSid) {
      await q(
        db,
        `DELETE FROM mc_inbound_message_sids WHERE message_sid = $1`,
        [messageSid],
      );
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

    async claimOutboundById(id) {
      const { rows } = await q<{
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
        db,
        `UPDATE mc_outbound_messages
         SET status = 'sending', updated_at = now()
         WHERE id = $1 AND status IN ('queued', 'retry')
         RETURNING id, workflow_id, client_account_id, to_e164, from_e164,
                   body, detail, status, provider_sid, attempts, last_error,
                   created_at, updated_at, sent_at`,
        [id],
      );
      const row = rows[0];
      if (!row) return null;
      return {
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
      };
    },

    async claimOutboundForSend(
      limit,
      staleSendingMs = OUTBOUND_STALE_SENDING_MS,
    ) {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        // Finalize stale sends that already have a provider SID — never double-send.
        await client.query(
          `UPDATE mc_outbound_messages
           SET status = 'sent',
               sent_at = COALESCE(sent_at, now()),
               updated_at = now()
           WHERE status = 'sending'
             AND provider_sid IS NOT NULL
             AND updated_at < now() - ($1::bigint * interval '1 millisecond')`,
          [staleSendingMs],
        );
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
                OR (
                  status = 'sending'
                  AND provider_sid IS NULL
                  AND updated_at < now() - ($2::bigint * interval '1 millisecond')
                )
             ORDER BY created_at ASC
             FOR UPDATE SKIP LOCKED
             LIMIT $1
           ) AS picked
           WHERE m.id = picked.id
           RETURNING m.id, m.workflow_id, m.client_account_id, m.to_e164, m.from_e164,
                     m.body, m.detail, m.status, m.provider_sid, m.attempts, m.last_error,
                     m.created_at, m.updated_at, m.sent_at`,
          [limit, staleSendingMs],
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

    async applyOutboundProviderStatus(providerSid, providerStatus) {
      const normalized = providerStatus.toLowerCase();
      let mode: "delivered" | "failed" | "noop" = "noop";
      if (normalized === "delivered") {
        mode = "delivered";
      } else if (
        normalized === "undelivered" ||
        normalized === "failed" ||
        normalized === "canceled"
      ) {
        mode = "failed";
      }

      const { rows } = await q<{
        id: string;
        workflow_id: string | null;
        client_account_id: string;
        to_e164: string;
        from_e164: string;
        body: string;
        detail: string | null;
        status: string;
        provider_sid: string | null;
        provider_status: string | null;
        attempts: number;
        last_error: string | null;
        created_at: Date;
        updated_at: Date;
        sent_at: Date | null;
        delivered_at: Date | null;
      }>(
        db,
        `UPDATE mc_outbound_messages
         SET provider_status = $2,
             status = CASE
               WHEN $3 = 'delivered' THEN 'delivered'
               WHEN $3 = 'failed' AND attempts < 3 THEN 'retry'
               WHEN $3 = 'failed' THEN 'undelivered'
               ELSE status
             END,
             provider_sid = CASE
               WHEN $3 = 'failed' AND attempts < 3 THEN NULL
               ELSE provider_sid
             END,
             delivered_at = CASE WHEN $3 = 'delivered' THEN now() ELSE delivered_at END,
             last_error = CASE
               WHEN $3 = 'failed' THEN COALESCE(last_error, $2)
               ELSE last_error
             END,
             updated_at = now()
         WHERE provider_sid = $1
         RETURNING id, workflow_id, client_account_id, to_e164, from_e164,
                   body, detail, status, provider_sid, provider_status, attempts,
                   last_error, created_at, updated_at, sent_at, delivered_at`,
        [providerSid, normalized, mode],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        workflowId: row.workflow_id ?? undefined,
        clientAccountId: row.client_account_id,
        toE164: row.to_e164,
        fromE164: row.from_e164,
        body: row.body,
        detail: row.detail ?? undefined,
        status: row.status as OutboundMessageRecord["status"],
        providerSid: row.provider_sid ?? undefined,
        providerStatus: row.provider_status ?? undefined,
        attempts: row.attempts,
        lastError: row.last_error ?? undefined,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        sentAt: row.sent_at?.toISOString(),
        deliveredAt: row.delivered_at?.toISOString(),
      };
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

    async getOutboundQueueStats() {
      const { rows } = await q<{
        queued: string;
        retry: string;
        sending: string;
        stale_sending: string;
      }>(
        db,
        `SELECT
           COUNT(*) FILTER (WHERE status = 'queued')::text AS queued,
           COUNT(*) FILTER (WHERE status = 'retry')::text AS retry,
           COUNT(*) FILTER (WHERE status = 'sending')::text AS sending,
           COUNT(*) FILTER (
             WHERE status = 'sending'
               AND updated_at < now() - ($1::bigint * interval '1 millisecond')
           )::text AS stale_sending
         FROM mc_outbound_messages`,
        [OUTBOUND_STALE_SENDING_MS],
      );
      const row = rows[0];
      return {
        queued: Number(row?.queued ?? 0),
        retry: Number(row?.retry ?? 0),
        sending: Number(row?.sending ?? 0),
        staleSending: Number(row?.stale_sending ?? 0),
      };
    },
  };
}
