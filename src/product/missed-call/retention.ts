import type { Pool } from "pg";

export type PurgeResult = {
  workflowsSoftDeleted: number;
  leadsSoftDeleted: number;
  bookAuditSoftDeleted: number;
  inboundSidsDeleted: number;
  outboundArchived: number;
  piiAnonymized: number;
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
  const months = opts.retentionMonths;
  const cutoff = opts.now ?? new Date();
  // Approximate calendar months as 30-day windows for stable SQL interval math.
  const cutoffIso = new Date(
    cutoff.getTime() - months * 30 * 24 * 60 * 60 * 1000,
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
       AND updated_at < $1::timestamptz`,
    [cutoffIso],
  );

  const bookAudit = await pool.query(
    `UPDATE mc_book_audit_leads
     SET updated_at = now()
     WHERE created_at < $1::timestamptz
       AND email_sent = true
     RETURNING id`,
    [cutoffIso],
  );
  if ((bookAudit.rowCount ?? 0) > 0) {
    await pool.query(
      `UPDATE mc_book_audit_leads
       SET payload = payload || jsonb_build_object('retention_state', 'purged_pending')
       WHERE created_at < $1::timestamptz
         AND COALESCE(payload->>'retention_state', '') <> 'purged_pending'`,
      [cutoffIso],
    );
  }

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
         last_error = COALESCE(last_error, 'retention_archive'),
         updated_at = now()
     WHERE created_at < $1::timestamptz
       AND status NOT IN ('dead')`,
    [cutoffIso],
  );

  // Anonymize PII on soft-deleted / purged_pending rows.
  const anonWorkflows = await pool.query(
    `UPDATE mc_workflows
     SET caller_e164 = $2,
         payload = jsonb_set(
           jsonb_set(
             jsonb_set(
               COALESCE(payload, '{}'::jsonb),
               '{callerE164}',
               to_jsonb($2::text)
             ),
             '{collected}',
             '{"language":"fr","photoUrls":[],"name":"[redacted]","address":"[redacted]","issue":"[redacted]"}'::jsonb
           ),
           '{events}',
           '[]'::jsonb
         ),
         retention_state = 'purged',
         updated_at = now()
     WHERE deleted_at IS NOT NULL
       AND retention_state IN ('purged_pending', 'purged')
       AND caller_e164 <> $2`,
    [cutoffIso, ANON_PHONE],
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
       AND email <> $1`,
    [ANON_TEXT, ANON_PHONE],
  );

  const anonOutbound = await pool.query(
    `UPDATE mc_outbound_messages
     SET body = $1,
         to_e164 = $2,
         updated_at = now()
     WHERE last_error = 'retention_archive'
       AND body <> $1`,
    [ANON_TEXT, ANON_PHONE],
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
      (anonOutbound.rowCount ?? 0),
  };
}
