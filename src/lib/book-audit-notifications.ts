import {
  isDurableMissedCallStoreConfigured,
  isLeadsWebhookConfigured,
} from "@/lib/config";
import { reconcileBookingSalesLeads } from "@/product/sales-crm/service";
import {
  sendBookAuditCustomerEmail,
  sendBookAuditNotifyEmail,
} from "@/lib/email";
import { reportError } from "@/lib/errors";
import { sendBusinessNotifyEmail } from "@/lib/business-notifications";
import { randomUUID } from "@/lib/id";
import { forwardLeadToCrm } from "@/lib/leads";
import type { BookAuditContactPayload } from "@/lib/validation/book-audit";
import { getPgPool } from "@/product/missed-call/postgres-store";

export type BookAuditNotificationChannel =
  "notify_email" | "customer_email" | "crm" | "admin_alert";

export type BookAuditNotificationJob = {
  lead_id: string;
  channel: BookAuditNotificationChannel;
  attempts: number;
  lease_token: string;
  payload: BookAuditContactPayload;
  submitted_at: Date | string;
};

function database() {
  const url = process.env.DATABASE_URL?.trim();
  if (!isDurableMissedCallStoreConfigured() || !url) {
    throw new Error("Booking notification retries require PostgreSQL");
  }
  return getPgPool(url);
}

// First retry after one minute, then five minutes, fifteen minutes, and hourly.
function retryDelaySeconds(attempt: number) {
  return [60, 300, 900, 3600][Math.min(Math.max(attempt - 1, 0), 3)];
}

async function deliver(job: BookAuditNotificationJob): Promise<boolean> {
  const key = `book-audit/${job.lead_id}/${job.channel}`;
  switch (job.channel) {
    case "notify_email":
      return (await sendBookAuditNotifyEmail(job.payload, key)).sent;
    case "customer_email":
      return (await sendBookAuditCustomerEmail(job.payload, key)).sent;
    case "crm":
      return (
        await forwardLeadToCrm(
          job.payload,
          key,
          new Date(job.submitted_at).toISOString(),
        )
      ).forwarded;
    case "admin_alert": {
      const pending = await database().query<{
        channel: string;
        attempts: number;
      }>(
        `SELECT channel, attempts FROM mc_book_audit_notifications
         WHERE lead_id = $1 AND channel <> 'admin_alert' AND delivered_at IS NULL
           AND cancelled_at IS NULL AND (channel <> 'crm' OR $2::boolean)`,
        [job.lead_id, isLeadsWebhookConfigured()],
      );
      // A recovery before the alert is sent no longer needs escalation.
      if (pending.rows.length === 0) return true;
      const reported = await reportError(
        new Error(
          "Booking lead saved, but notification delivery remains unsuccessful",
        ),
        {
          leadId: job.lead_id,
          channels: pending.rows
            .map((row) => `${row.channel} (${row.attempts} attempts)`)
            .join(", "),
          action:
            "Check booking notification providers and retry the pending queue",
        },
      );
      if (reported) return true;
      const toEmail =
        process.env.ADMIN_ALERT_EMAIL?.trim() ||
        process.env.RESEND_NOTIFY_EMAIL?.trim();
      if (!toEmail) return false;
      return (
        await sendBusinessNotifyEmail({
          toEmail,
          subject: "TradeCatch: booking notifications need attention",
          title: "Booking saved; notifications still pending",
          lines: [
            { label: "Lead reference", value: job.lead_id },
            {
              label: "Pending channels",
              value: pending.rows.map((row) => row.channel).join(", "),
            },
          ],
          idempotencyKey: key,
        })
      ).sent;
    }
  }
}

/** Durable, leased work. Successful channels are never deliberately resent. */
export async function processBookAuditNotifications(
  input: {
    leadId?: string;
    limit?: number;
    // Dependency injection for isolated tests; the HTTP endpoint never accepts it.
    send?: (job: BookAuditNotificationJob) => Promise<boolean>;
  } = {},
) {
  const db = database();
  await reconcileBookingSalesLeads(input.leadId);
  const limit = Math.min(25, Math.max(1, input.limit ?? 12));
  const result = { attempted: 0, delivered: 0, failed: 0 };
  const started = Date.now();
  for (let i = 0; i < limit && Date.now() - started < 20_000; i++) {
    const token = randomUUID();
    const claimed = await db.query<BookAuditNotificationJob>(
      `WITH candidate AS (
         SELECT lead_id, channel FROM mc_book_audit_notifications
         WHERE delivered_at IS NULL AND next_attempt_at <= now()
           AND cancelled_at IS NULL AND (channel <> 'crm' OR $3::boolean)
           AND (leased_until IS NULL OR leased_until <= now())
           AND ($1::text IS NULL OR lead_id = $1)
         ORDER BY next_attempt_at, lead_id, channel
         FOR UPDATE SKIP LOCKED LIMIT 1
       ), claimed AS (
         UPDATE mc_book_audit_notifications j
         SET lease_token = $2, leased_until = now() + interval '2 minutes',
             attempts = j.attempts + 1
         FROM candidate c
         WHERE j.lead_id = c.lead_id AND j.channel = c.channel
         RETURNING j.*
       )
       SELECT c.*, l.payload, l.created_at AS submitted_at FROM claimed c
       JOIN mc_book_audit_leads l ON l.id = c.lead_id`,
      [input.leadId ?? null, token, isLeadsWebhookConfigured()],
    );
    const job = claimed.rows[0];
    if (!job) break;
    result.attempted++;
    let sent = false;
    try {
      sent = await (input.send ?? deliver)(job);
    } catch {
      // Do not store provider responses, credentials, or contact data in errors.
      console.error("[book-audit] notification attempt failed", {
        leadId: job.lead_id,
        channel: job.channel,
      });
    }

    // Fence stale workers with their lease token. Delivery flags and a durable
    // escalation after three unsuccessful attempts are committed together.
    await db.query(
      `WITH completed AS (
         UPDATE mc_book_audit_notifications
         SET delivered_at = CASE WHEN $4 THEN now() ELSE NULL END,
             next_attempt_at = now() + ($5::int * interval '1 second'),
             last_error = CASE WHEN $4 THEN NULL ELSE 'Delivery failed or provider is not configured' END,
             lease_token = NULL, leased_until = NULL
         WHERE lead_id = $1 AND channel = $2 AND lease_token = $3 AND cancelled_at IS NULL
         RETURNING lead_id, channel, attempts, delivered_at
       ), alert AS (
         INSERT INTO mc_book_audit_notifications (lead_id, channel)
         SELECT lead_id, 'admin_alert' FROM completed
         WHERE delivered_at IS NULL AND attempts >= 3 AND channel <> 'admin_alert'
         ON CONFLICT DO NOTHING
       )
       UPDATE mc_book_audit_leads l
       SET email_sent = l.email_sent OR (c.channel = 'notify_email' AND c.delivered_at IS NOT NULL),
           crm_forwarded = l.crm_forwarded OR (c.channel = 'crm' AND c.delivered_at IS NOT NULL),
           updated_at = now()
       FROM completed c WHERE l.id = c.lead_id`,
      [job.lead_id, job.channel, token, sent, retryDelaySeconds(job.attempts)],
    );
    if (sent) result.delivered++;
    else result.failed++;
  }
  return result;
}

export async function getBookAuditNotificationStatus(leadId: string) {
  const jobs = await database().query<{
    channel: BookAuditNotificationChannel | null;
    delivered: boolean;
    cancelled: boolean;
    native_crm_synced: boolean;
    crm_forwarded: boolean;
  }>(
    `SELECT j.channel, j.delivered_at IS NOT NULL AS delivered, j.cancelled_at IS NOT NULL AS cancelled,
       n.lead_id IS NOT NULL AS native_crm_synced, l.crm_forwarded
     FROM mc_book_audit_leads l
     LEFT JOIN tc_platform_sales_leads n ON n.lead_id=l.id
     LEFT JOIN mc_book_audit_notifications j ON j.lead_id=l.id AND j.channel <> 'admin_alert'
     WHERE l.id=$1`,
    [leadId],
  );
  const delivered = (channel: BookAuditNotificationChannel) =>
    jobs.rows.some((row) => row.channel === channel && row.delivered);
  return {
    emailSent: delivered("notify_email"),
    customerEmailSent: delivered("customer_email"),
    crmForwarded: delivered("crm") || Boolean(jobs.rows[0]?.crm_forwarded),
    nativeCrmSynced: Boolean(jobs.rows[0]?.native_crm_synced),
    externalCrmConfigured: isLeadsWebhookConfigured(),
    notificationsDelivered:
      delivered("notify_email") &&
      delivered("customer_email") &&
      jobs.rows
        .filter(
          (row) =>
            !row.cancelled &&
            (row.channel !== "crm" || isLeadsWebhookConfigured()),
        )
        .every((row) => row.delivered),
  };
}
