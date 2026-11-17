import type { Pool } from "pg";
import { NEW_BUSINESS_DEFAULTS } from "./settings";

/**
 * Without saved SMS history, a message's wording is kept only this long:
 * long enough for delivery, retries, status callbacks and the SMS assistant's
 * same-day replies to finish. Then only the record that a message was sent
 * (who, when, status) remains.
 */
export const SMS_SETTLE_HOURS = 24;

const REDACTED_SMS = "[redacted]";

export type PrivacyRetentionResult = {
  crmMessagesCleared: number;
  quoteMessagesCleared: number;
  automationLogsCleared: number;
  outboundMessagesCleared: number;
};

/**
 * Applies each business's "save SMS history" and "keep customer data" choices
 * to stored message wording. Per business, the cutoff is the later of
 * (now - 24 h) when SMS history is off and (now - N days) when a retention
 * period is set. Older message bodies are cleared.
 *
 * Never touched: delivery status, timestamps, phone numbers on the delivery
 * record, opt-out and consent records (tc_sms_suppressions, mc_sms_suppressions,
 * tc_sms_consent), invoices, usage and billing records, and audit logs. A
 * message still queued, sending or retrying is never cleared, so delivery is
 * never interrupted.
 *
 * Call transcripts and recordings follow the same retention through the
 * receptionist's own purge (config.transcriptRetentionDays).
 */
export async function applyPrivacyRetention(
  pool: Pool,
  now: Date = new Date(),
): Promise<PrivacyRetentionResult> {
  const params = [
    now.toISOString(),
    SMS_SETTLE_HOURS,
    NEW_BUSINESS_DEFAULTS.saveSmsHistory,
    NEW_BUSINESS_DEFAULTS.customerDataRetentionDays,
  ];
  // Businesses with no stored row use the new-business defaults.
  const cutoffs = `
    WITH effective AS (
      SELECT o.id AS organization_id,
             o.missed_call_client_id AS client_id,
             CASE WHEN ps.organization_id IS NULL THEN $3::boolean ELSE ps.save_sms_history END AS save_sms,
             CASE WHEN ps.organization_id IS NULL THEN $4::int ELSE ps.customer_data_retention_days END AS days
      FROM tc_organizations o
      LEFT JOIN tc_privacy_settings ps ON ps.organization_id = o.id
    ),
    cutoffs AS (
      SELECT organization_id, client_id,
             GREATEST(
               CASE WHEN save_sms THEN NULL
                    ELSE $1::timestamptz - make_interval(hours => $2::int) END,
               CASE WHEN days IS NULL THEN NULL
                    ELSE $1::timestamptz - make_interval(days => days) END
             ) AS cutoff
      FROM effective
    ),
    due AS (SELECT * FROM cutoffs WHERE cutoff IS NOT NULL)`;

  const crm = await pool.query(
    `${cutoffs}
     UPDATE tc_crm_messages m SET body = ''
     FROM due
     WHERE m.organization_id = due.organization_id
       AND m.at < due.cutoff
       AND m.delivery_status NOT IN ('queued', 'sending')
       AND m.body <> ''`,
    params,
  );
  const quotes = await pool.query(
    `${cutoffs}
     UPDATE tc_quote_messages q SET body = ''
     FROM tc_quote_threads t, due
     WHERE q.thread_id = t.id
       AND t.organization_id = due.organization_id
       AND q.at < due.cutoff
       AND q.body <> ''`,
    params,
  );
  const executions = await pool.query(
    `${cutoffs}
     UPDATE tc_sms_executions e SET message_body = NULL
     FROM due
     WHERE e.organization_id = due.organization_id
       AND e.at < due.cutoff
       AND e.message_body IS NOT NULL`,
    params,
  );
  const outbound = await pool.query(
    `${cutoffs}
     UPDATE mc_outbound_messages m SET body = $5, updated_at = now()
     FROM due
     WHERE due.client_id IS NOT NULL
       AND m.client_account_id = due.client_id
       AND m.created_at < due.cutoff
       AND m.status IN ('sent', 'delivered', 'undelivered', 'dead')
       AND m.body <> $5`,
    [...params, REDACTED_SMS],
  );

  return {
    crmMessagesCleared: crm.rowCount ?? 0,
    quoteMessagesCleared: quotes.rowCount ?? 0,
    automationLogsCleared: executions.rowCount ?? 0,
    outboundMessagesCleared: outbound.rowCount ?? 0,
  };
}
