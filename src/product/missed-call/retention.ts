import type { Pool, PoolClient } from "pg";
import { OUTBOUND_STALE_SENDING_MS } from "./store";

export type PurgeResult = {
  workflowsSoftDeleted: number;
  leadsSoftDeleted: number;
  bookAuditSoftDeleted: number;
  inboundSidsDeleted: number;
  outboundArchived: number;
  piiAnonymized: number;
  callsAnonymized: number;
  notificationJobsRemoved: number;
};

const ANON_PHONE = "+10000000000";
const ANON_TEXT = "[redacted]";

/**
 * Soft-delete expired Module A records, then scrub PII from payloads marked
 * purged_pending so names, addresses, phones, conversations, and SMS bodies
 * do not remain indefinitely after retention.
 */
export async function purgeExpiredRecords(
  pool: Pool,
  opts: { retentionMonths: number; now?: Date } = { retentionMonths: 24 },
): Promise<PurgeResult> {
  if (!Number.isFinite(opts.retentionMonths) || opts.retentionMonths <= 0)
    throw new Error("Retention months must be a positive finite number");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await purgeInTransaction(client, opts);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function purgeInTransaction(
  pool: PoolClient,
  opts: { retentionMonths: number; now?: Date },
): Promise<PurgeResult> {
  const months = opts.retentionMonths;
  const cutoff = opts.now ?? new Date();
  // Approximate calendar months as 30-day windows for stable SQL interval math.
  const cutoffIso = new Date(
    cutoff.getTime() - months * 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const staleSending = new Date(
    cutoff.getTime() - OUTBOUND_STALE_SENDING_MS,
  ).toISOString();

  const workflows = await pool.query(
    `UPDATE mc_workflows
     SET retention_state = 'purged_pending',
         deleted_at = COALESCE(deleted_at, now()),
         updated_at = now()
     WHERE deleted_at IS NULL
       AND updated_at < $1::timestamptz
       AND status IN ('completed', 'stopped')`,
    [cutoffIso],
  );

  const leads = await pool.query(
    `UPDATE mc_leads
     SET retention_state = 'purged_pending',
         deleted_at = COALESCE(deleted_at, now()),
         updated_at = now()
     WHERE deleted_at IS NULL
       AND updated_at < $1::timestamptz
       AND NOT EXISTS (SELECT 1 FROM mc_workflows w WHERE w.id=mc_leads.workflow_id AND w.deleted_at IS NULL)`,
    [cutoffIso],
  );

  // Fence new notification leases while deciding which expired leads can be scrubbed.
  // Already leased deliveries finish first; their leads wait for a later purge.
  await pool.query("SET LOCAL lock_timeout = '2s'");
  await pool.query(
    "LOCK TABLE mc_book_audit_notifications IN SHARE ROW EXCLUSIVE MODE",
  );
  const bookAudit = await pool.query(
    `WITH expired AS (
     SELECT l.id FROM mc_book_audit_leads l WHERE l.created_at < $1::timestamptz
       AND COALESCE(l.payload->>'retention_state', '') NOT IN ('purged_pending','purged')
       AND NOT EXISTS (SELECT 1 FROM mc_book_audit_notifications j
         WHERE j.lead_id=l.id AND j.leased_until > now())
       FOR UPDATE OF l SKIP LOCKED)
     UPDATE mc_book_audit_leads l
     SET payload = l.payload || jsonb_build_object('retention_state', 'purged_pending'), updated_at = now()
     FROM expired e WHERE l.id=e.id RETURNING l.id`,
    [cutoffIso],
  );
  // Expired lead payloads cannot be retried after their contact data is removed.
  const removedJobs = await pool.query(
    `DELETE FROM mc_book_audit_notifications j USING mc_book_audit_leads l
     WHERE j.lead_id=l.id AND l.created_at < $1::timestamptz
       AND l.payload->>'retention_state' IN ('purged_pending','purged')
       AND NOT EXISTS (SELECT 1 FROM mc_book_audit_notifications active WHERE active.lead_id=l.id AND active.leased_until > now())`,
    [cutoffIso],
  );

  const inbound = await pool.query(
    `DELETE FROM mc_inbound_message_sids
     WHERE claimed_at < $1::timestamptz`,
    [cutoffIso],
  );

  const outbound = await pool.query(
    `UPDATE mc_outbound_messages
     SET status = CASE
           WHEN status IN ('delivered', 'undelivered', 'sent', 'dead') THEN status
           ELSE 'dead'
         END,
         last_error = 'retention_archive',
         updated_at = now()
     WHERE created_at < $1::timestamptz
       AND (status <> 'sending' OR updated_at < $4::timestamptz)
       AND (body <> $2 OR to_e164 <> $3 OR from_e164 <> $3 OR detail IS NOT NULL OR last_error IS DISTINCT FROM 'retention_archive')`,
    [cutoffIso, ANON_TEXT, ANON_PHONE, staleSending],
  );

  // Anonymize PII on soft-deleted / purged_pending rows.
  const anonWorkflows = await pool.query(
    `UPDATE mc_workflows
     SET caller_e164 = $1,
         dedupe_key = 'purged:' || id,
         payload = jsonb_build_object(
           'id',id,'clientAccountId',client_account_id,'callId',call_id,
           'callerE164',$1::text,'dedupeKey','purged:' || id,'status',status,
           'outcome',outcome,'currentStep','done','escalationStage',escalation_stage,
           'escalationIndex',-1,'createdAt',created_at,'updatedAt',now(),
           'events','[]'::jsonb,'technicianAlerts','[]'::jsonb,
           'collected','{"language":"fr","photoUrls":[]}'::jsonb),
         retention_state = 'purged',
         updated_at = now()
     WHERE deleted_at IS NOT NULL
       AND retention_state IN ('purged_pending', 'purged')
       AND (caller_e164 <> $1 OR dedupe_key <> 'purged:' || id)`,
    [ANON_PHONE],
  );

  const anonLeads = await pool.query(
    `UPDATE mc_leads
     SET caller_e164 = $1,
         payload = jsonb_build_object(
           'id', payload->>'id',
           'workflowId', payload->>'workflowId',
           'clientAccountId', payload->>'clientAccountId',
           'callerE164', $1::text,
           'retentionState', 'purged',
           'conversation', '[]'::jsonb,
           'collected', '{"language":"fr","photoUrls":[]}'::jsonb
         ),
         retention_state = 'purged',
         updated_at = now()
     WHERE deleted_at IS NOT NULL
       AND retention_state IN ('purged_pending', 'purged')
       AND caller_e164 <> $1`,
    [ANON_PHONE],
  );

  const anonBook = await pool.query(
    `UPDATE mc_book_audit_leads
     SET email = $1,
         phone = $2,
         company = $1,
         payload = jsonb_build_object(
           'retention_state', 'purged',
           'preferredLanguage', payload->>'preferredLanguage'
         ),
         updated_at = now()
     WHERE COALESCE(payload->>'retention_state', '') = 'purged_pending'
       AND email <> $1
       AND NOT EXISTS (SELECT 1 FROM mc_book_audit_notifications j WHERE j.lead_id=mc_book_audit_leads.id AND j.leased_until > now())`,
    [ANON_TEXT, ANON_PHONE],
  );

  const anonOutbound = await pool.query(
    `UPDATE mc_outbound_messages
     SET body = $1,
         to_e164 = $2,
         from_e164 = $2,
         detail = NULL,
         updated_at = now()
     WHERE created_at < $3::timestamptz
       AND (status <> 'sending' OR updated_at < $4::timestamptz)
       AND (body <> $1 OR to_e164 <> $2 OR from_e164 <> $2 OR detail IS NOT NULL)`,
    [ANON_TEXT, ANON_PHONE, cutoffIso, staleSending],
  );

  const anonCalls = await pool.query(
    `UPDATE mc_calls c SET caller_e164=$2,
       payload=jsonb_build_object('id',c.id,'clientAccountId',c.client_account_id,
         'callerE164',$2::text,'calledAt',c.called_at,'disposition',c.disposition,'retentionState','purged')
     WHERE c.called_at < $1::timestamptz
       AND (c.caller_e164 <> $2 OR c.payload->>'retentionState' IS DISTINCT FROM 'purged')
       AND NOT EXISTS (SELECT 1 FROM mc_workflows w WHERE w.call_id=c.id AND w.deleted_at IS NULL)`,
    [cutoffIso, ANON_PHONE],
  );

  return {
    workflowsSoftDeleted: workflows.rowCount ?? 0,
    leadsSoftDeleted: leads.rowCount ?? 0,
    bookAuditSoftDeleted: bookAudit.rowCount ?? 0,
    inboundSidsDeleted: inbound.rowCount ?? 0,
    outboundArchived: outbound.rowCount ?? 0,
    piiAnonymized:
      (anonWorkflows.rowCount ?? 0) +
      (anonLeads.rowCount ?? 0) +
      (anonBook.rowCount ?? 0) +
      (anonOutbound.rowCount ?? 0) +
      (anonCalls.rowCount ?? 0),
    callsAnonymized: anonCalls.rowCount ?? 0,
    notificationJobsRemoved: removedJobs.rowCount ?? 0,
  };
}
