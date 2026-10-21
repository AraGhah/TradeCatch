import { createId } from "@/lib/id";
import {
  applySmsStatus,
  CRITICAL_DELIVERY_RESERVE,
  DELIVERY_RATE_LIMIT,
  priorityRank,
} from "./delivery-policy";
import { getPgPool } from "@/product/missed-call/postgres-store";
import type { NotificationStore } from "./store";
import { TYPE_PRIORITY } from "./types";
import type {
  ContractorNotification,
  NotificationDelivery,
  NotificationPayload,
  NotificationPreferences,
  NotificationRecipient,
  NotificationType,
  OutboxEvent,
  SystemAlert,
} from "./types";

function noteFrom(row: Record<string, unknown>): ContractorNotification {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    type: row.type as ContractorNotification["type"],
    title: String(row.title),
    message: String(row.message),
    priority: row.priority as ContractorNotification["priority"],
    leadId: row.lead_id ? String(row.lead_id) : undefined,
    appointmentId: row.appointment_id ? String(row.appointment_id) : undefined,
    callId: row.call_id ? String(row.call_id) : undefined,
    href: row.href ? String(row.href) : undefined,
    consolidateKey: row.consolidate_key
      ? String(row.consolidate_key)
      : undefined,
    idempotencyKey: String(row.idempotency_key),
    simulated: Boolean(row.simulated),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export function createPostgresNotificationStore(
  connectionString: string,
): NotificationStore {
  const pool = getPgPool(connectionString);
  const query = (text: string, values?: unknown[]) => pool.query(text, values);

  return {
    async insertOutbox(row) {
      const res = await query(
        `INSERT INTO tc_outbox_events (id, organization_id, idempotency_key, type, payload_json, status, attempts, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          row.id,
          row.organizationId,
          row.idempotencyKey,
          row.type,
          JSON.stringify(row.payload),
          row.status,
          row.attempts,
          row.createdAt,
          row.updatedAt,
        ],
      );
      return res.rows[0] ? row : null;
    },
    async claimOutbox(limit, nowIso, type) {
      const res = await query(
        `UPDATE tc_outbox_events SET status = 'processing', updated_at = $2
         WHERE id IN (
           SELECT id FROM tc_outbox_events
           WHERE (status = 'pending'
              OR (status = 'processing' AND updated_at < $2::timestamptz - interval '10 minutes'))
             AND ($3::text IS NULL OR type = $3)
           ORDER BY CASE WHEN type IN ('urgent_request','receptionist_offline') THEN 0 WHEN type IN ('human_requested','transfer_failed','quote_response','quote_accepted','automation_failure','calendar_disconnected') THEN 1 ELSE 2 END, created_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
        [limit, nowIso, type ?? null],
      );
      return res.rows
        .sort(
          (a, b) =>
            priorityRank(TYPE_PRIORITY[a.type as keyof typeof TYPE_PRIORITY]) -
              priorityRank(
                TYPE_PRIORITY[b.type as keyof typeof TYPE_PRIORITY],
              ) ||
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        )
        .map((row) => ({
          id: String(row.id),
          organizationId: String(row.organization_id),
          idempotencyKey: String(row.idempotency_key),
          type: row.type,
          payload: row.payload_json as NotificationPayload,
          status: "processing" as const,
          attempts: Number(row.attempts),
          createdAt: new Date(String(row.created_at)).toISOString(),
          updatedAt: nowIso,
        })) satisfies OutboxEvent[];
    },
    async saveOutbox(row) {
      await query(
        `UPDATE tc_outbox_events SET status = $2, attempts = $3, updated_at = $4 WHERE id = $1`,
        [row.id, row.status, row.attempts, row.updatedAt],
      );
    },
    async findNotificationByKey(organizationId, key) {
      const res = await query(
        `SELECT * FROM tc_notifications WHERE organization_id = $1 AND idempotency_key = $2`,
        [organizationId, key],
      );
      return res.rows[0] ? noteFrom(res.rows[0]) : null;
    },
    async findRecentConsolidated(organizationId, key, sinceIso) {
      const res = await query(
        `SELECT * FROM tc_notifications WHERE organization_id = $1 AND consolidate_key = $2 AND created_at >= $3 ORDER BY created_at DESC LIMIT 1`,
        [organizationId, key, sinceIso],
      );
      return res.rows[0] ? noteFrom(res.rows[0]) : null;
    },
    async saveNotification(row) {
      await query(
        `INSERT INTO tc_notifications (
          id, organization_id, type, title, message, priority, lead_id, appointment_id, call_id,
          href, consolidate_key, idempotency_key, simulated, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, message = EXCLUDED.message, updated_at = EXCLUDED.updated_at`,
        [
          row.id,
          row.organizationId,
          row.type,
          row.title,
          row.message,
          row.priority,
          row.leadId ?? null,
          row.appointmentId ?? null,
          row.callId ?? null,
          row.href ?? null,
          row.consolidateKey ?? null,
          row.idempotencyKey,
          row.simulated,
          row.createdAt,
          row.updatedAt,
        ],
      );
    },
    async listNotifications(organizationId) {
      const res = await query(
        `SELECT * FROM tc_notifications WHERE organization_id = $1 ORDER BY created_at DESC`,
        [organizationId],
      );
      return res.rows.map(noteFrom);
    },
    async getNotification(organizationId, id) {
      const res = await query(
        `SELECT * FROM tc_notifications WHERE organization_id = $1 AND id = $2`,
        [organizationId, id],
      );
      return res.rows[0] ? noteFrom(res.rows[0]) : null;
    },
    async saveRecipient(row) {
      await query(
        `INSERT INTO tc_notification_recipients (id, notification_id, organization_id, user_id, read_at, acknowledged_at, acknowledged_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (notification_id, user_id) DO UPDATE SET
           read_at = EXCLUDED.read_at,
           acknowledged_at = EXCLUDED.acknowledged_at,
           acknowledged_by = EXCLUDED.acknowledged_by`,
        [
          row.id,
          row.notificationId,
          row.organizationId,
          row.userId,
          row.readAt ?? null,
          row.acknowledgedAt ?? null,
          row.acknowledgedBy ?? null,
        ],
      );
    },
    async listRecipients(organizationId, notificationId) {
      const res = await query(
        `SELECT * FROM tc_notification_recipients WHERE organization_id = $1 AND ($2::text IS NULL OR notification_id = $2)`,
        [organizationId, notificationId ?? null],
      );
      return res.rows.map((row) => ({
        id: String(row.id),
        notificationId: String(row.notification_id),
        organizationId: String(row.organization_id),
        userId: String(row.user_id),
        readAt: row.read_at
          ? new Date(String(row.read_at)).toISOString()
          : undefined,
        acknowledgedAt: row.acknowledged_at
          ? new Date(String(row.acknowledged_at)).toISOString()
          : undefined,
        acknowledgedBy: row.acknowledged_by
          ? String(row.acknowledged_by)
          : undefined,
      })) satisfies NotificationRecipient[];
    },
    async countUnread(organizationId, userId) {
      const res = await query(
        `SELECT count(*)::int AS n
         FROM tc_notification_recipients
         WHERE organization_id = $1 AND user_id = $2 AND read_at IS NULL`,
        [organizationId, userId],
      );
      return Number(res.rows[0]?.n ?? 0);
    },
    async saveDelivery(row, onlyIfNew = false) {
      const res = await query(
        `INSERT INTO tc_notification_deliveries (
          id, notification_id, organization_id, recipient_user_id, channel, status, attempts,
          next_attempt_at, last_error, provider_sid, destination, simulated, idempotency_key, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (organization_id, idempotency_key) DO UPDATE SET
          status = EXCLUDED.status, attempts = EXCLUDED.attempts, next_attempt_at = EXCLUDED.next_attempt_at,
          last_error = EXCLUDED.last_error, provider_sid = EXCLUDED.provider_sid, updated_at = EXCLUDED.updated_at
        WHERE tc_notification_deliveries.id = EXCLUDED.id AND NOT $16::boolean
        RETURNING id`,
        [
          row.id,
          row.notificationId,
          row.organizationId,
          row.recipientUserId ?? null,
          row.channel,
          row.status,
          row.attempts,
          row.nextAttemptAt ?? null,
          row.lastError ?? null,
          row.providerSid ?? null,
          row.destination ?? null,
          row.simulated,
          row.idempotencyKey,
          row.createdAt,
          row.updatedAt,
          onlyIfNew,
        ],
      );
      return res.rows[0] ? row : null;
    },
    async listDeliveries(organizationId) {
      const res = await query(
        `SELECT * FROM tc_notification_deliveries WHERE organization_id = $1`,
        [organizationId],
      );
      return res.rows.map(deliveryFrom);
    },
    async dueDeliveries(nowIso) {
      const res = await query(
        `SELECT * FROM tc_notification_deliveries WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= $1)`,
        [nowIso],
      );
      return res.rows.map(deliveryFrom);
    },
    async claimDeliveries(nowIso, type, limit = 25) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Serialize quota reservations, not network sends.
        await client.query("SELECT pg_advisory_xact_lock(74113, 12)");
        await client.query(
          "DELETE FROM tc_notification_dispatches WHERE reserved_at <= $1::timestamptz - interval '10 minutes'",
          [nowIso],
        );
        await client.query(
          "UPDATE tc_notification_deliveries SET status='dead',updated_at=$1 WHERE attempts >= 3 AND (status='pending' OR (status='processing' AND updated_at < $1::timestamptz - interval '10 minutes'))",
          [nowIso],
        );
        const res = await client.query(
          `WITH candidates AS (
            SELECT d.id, d.organization_id, d.channel, d.created_at,
              CASE n.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END AS priority
            FROM tc_notification_deliveries d
            JOIN tc_notifications n ON n.id=d.notification_id AND n.organization_id=d.organization_id
            WHERE ($2::text IS NULL OR n.type=$2) AND
              ((d.status='pending' AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= $1)) OR
               (d.status='processing' AND d.updated_at < $1::timestamptz - interval '10 minutes'))
          ), external AS (
            SELECT *, (priority = 0) AS is_critical,
              row_number() OVER (PARTITION BY organization_id, (priority = 0) ORDER BY priority,created_at,id) AS position
            FROM candidates WHERE channel <> 'in_app'
          ), quota_usage AS (
            SELECT o.organization_id,
              (SELECT count(*) FROM tc_notification_dispatches r WHERE r.organization_id=o.organization_id) AS used,
              (SELECT count(*) FROM external x WHERE x.organization_id=o.organization_id AND x.is_critical) AS waiting_critical
            FROM (SELECT DISTINCT organization_id FROM external) o
          ), room AS (
            -- Critical alerts reserve first, up to the base limit plus the
            -- critical reserve; everything else only gets what is left under
            -- the base limit after them.
            SELECT organization_id,
              GREATEST(0, $3::int + $5::int - used) AS critical_room,
              GREATEST(0, $3::int - used - LEAST(waiting_critical, GREATEST(0, $3::int + $5::int - used))) AS normal_room
            FROM quota_usage
          ), eligible AS (
            SELECT id,priority,created_at FROM candidates WHERE channel='in_app'
            UNION ALL
            SELECT e.id,e.priority,e.created_at FROM external e JOIN room r ON r.organization_id=e.organization_id
            WHERE e.position <= CASE WHEN e.is_critical THEN r.critical_room ELSE r.normal_room END
          ), due AS (
            SELECT d.id FROM eligible e JOIN tc_notification_deliveries d ON d.id=e.id
            ORDER BY e.priority,e.created_at,d.id LIMIT $4 FOR UPDATE OF d SKIP LOCKED
          )
          UPDATE tc_notification_deliveries d SET status='processing',provider_sid=NULL,updated_at=$1
          FROM due WHERE d.id=due.id RETURNING d.*, (SELECT c.priority FROM candidates c WHERE c.id=d.id) AS dispatch_priority`,
          [
            nowIso,
            type ?? null,
            DELIVERY_RATE_LIMIT,
            Math.max(1, Math.min(limit, 25)),
            CRITICAL_DELIVERY_RESERVE,
          ],
        );
        for (const row of res.rows) {
          if (row.channel !== "in_app")
            await client.query(
              "INSERT INTO tc_notification_dispatches (id,organization_id,delivery_id,reserved_at) VALUES ($1,$2,$3,$4)",
              [createId("dispatch"), row.organization_id, row.id, nowIso],
            );
        }
        await client.query("COMMIT");
        return res.rows
          .sort(
            (a, b) =>
              Number(a.dispatch_priority) - Number(b.dispatch_priority) ||
              new Date(a.created_at).getTime() -
                new Date(b.created_at).getTime(),
          )
          .map(deliveryFrom);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async findDeliveryBySid(sid) {
      const res = await query(
        `SELECT * FROM tc_notification_deliveries WHERE provider_sid = $1`,
        [sid],
      );
      return res.rows[0] ? deliveryFrom(res.rows[0]) : null;
    },
    async applySmsStatus(sid, status, errorCode, nowIso) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          "SELECT * FROM tc_notification_deliveries WHERE provider_sid=$1 FOR UPDATE",
          [sid],
        );
        const row = result.rows[0] ? deliveryFrom(result.rows[0]) : null;
        if (row && applySmsStatus(row, status, errorCode, nowIso)) {
          await client.query(
            "UPDATE tc_notification_deliveries SET status=$2,next_attempt_at=$3,last_error=$4,updated_at=$5 WHERE id=$1",
            [
              row.id,
              row.status,
              row.nextAttemptAt ?? null,
              row.lastError ?? null,
              nowIso,
            ],
          );
        }
        await client.query("COMMIT");
        return row;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async listUnrecoveredSms(type) {
      const result = await query(
        "SELECT d.* FROM tc_notification_deliveries d JOIN tc_notifications n ON n.id=d.notification_id AND n.organization_id=d.organization_id WHERE d.channel='sms' AND d.status IN ('failed','dead') AND d.recovery_handled_at IS NULL AND ($1::text IS NULL OR n.type=$1) ORDER BY d.updated_at LIMIT 25",
        [type ?? null],
      );
      return result.rows.map(deliveryFrom);
    },
    async markSmsRecovered(id, nowIso) {
      await query(
        "UPDATE tc_notification_deliveries SET recovery_handled_at=$2 WHERE id=$1",
        [id, nowIso],
      );
    },
    async getPreferences(organizationId, userId) {
      const res = await query(
        `SELECT settings_json FROM tc_notification_preferences WHERE organization_id = $1 AND user_id = $2`,
        [organizationId, userId],
      );
      return (
        (res.rows[0]?.settings_json as NotificationPreferences | undefined) ??
        null
      );
    },
    async savePreferences(row) {
      await query(
        `INSERT INTO tc_notification_preferences (organization_id, user_id, settings_json, updated_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (organization_id, user_id) DO UPDATE SET settings_json = EXCLUDED.settings_json, updated_at = EXCLUDED.updated_at`,
        [row.organizationId, row.userId, JSON.stringify(row), row.updatedAt],
      );
    },
    async getEscalation(organizationId) {
      const res = await query(
        `SELECT * FROM tc_escalation_rules WHERE organization_id = $1`,
        [organizationId],
      );
      const row = res.rows[0];
      if (!row) return null;
      return {
        organizationId,
        enabled: Boolean(row.enabled),
        primaryUserId: row.primary_user_id ?? undefined,
        secondaryUserId: row.secondary_user_id ?? undefined,
        secondaryPhoneE164: row.secondary_phone_e164 ?? undefined,
        emailEnabled: Boolean(row.email_enabled),
        smsEnabled: Boolean(row.sms_enabled),
        acknowledgementRequired: Boolean(row.acknowledgement_required),
        delayMinutes: Number(row.delay_minutes),
        maxAttempts: Number(row.max_attempts),
        afterHours: Boolean(row.after_hours),
        updatedAt: new Date(String(row.updated_at)).toISOString(),
      };
    },
    async saveEscalation(rule) {
      await query(
        `INSERT INTO tc_escalation_rules (
          organization_id, enabled, primary_user_id, secondary_user_id, secondary_phone_e164,
          email_enabled, sms_enabled, acknowledgement_required, delay_minutes, max_attempts, after_hours, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (organization_id) DO UPDATE SET
          enabled = EXCLUDED.enabled, primary_user_id = EXCLUDED.primary_user_id,
          secondary_user_id = EXCLUDED.secondary_user_id, secondary_phone_e164 = EXCLUDED.secondary_phone_e164,
          email_enabled = EXCLUDED.email_enabled, sms_enabled = EXCLUDED.sms_enabled,
          acknowledgement_required = EXCLUDED.acknowledgement_required, delay_minutes = EXCLUDED.delay_minutes,
          max_attempts = EXCLUDED.max_attempts, after_hours = EXCLUDED.after_hours, updated_at = EXCLUDED.updated_at`,
        [
          rule.organizationId,
          rule.enabled,
          rule.primaryUserId ?? null,
          rule.secondaryUserId ?? null,
          rule.secondaryPhoneE164 ?? null,
          rule.emailEnabled,
          rule.smsEnabled,
          rule.acknowledgementRequired,
          rule.delayMinutes,
          rule.maxAttempts,
          rule.afterHours,
          rule.updatedAt,
        ],
      );
    },
    async addEscalationAttempt(input) {
      await query(
        `INSERT INTO tc_escalation_attempts (id, organization_id, notification_id, recipient_user_id, outcome, at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          createId("esc"),
          input.organizationId,
          input.notificationId,
          input.recipientUserId ?? null,
          input.outcome,
          input.at,
        ],
      );
    },
    async listEscalationAttempts(organizationId, notificationId) {
      const res = await query(
        `SELECT outcome, at FROM tc_escalation_attempts WHERE organization_id = $1 AND notification_id = $2`,
        [organizationId, notificationId],
      );
      return res.rows.map((row) => ({
        outcome: String(row.outcome),
        at: new Date(String(row.at)).toISOString(),
      }));
    },
    async addEvent(input) {
      await query(
        `INSERT INTO tc_notification_events (id, organization_id, notification_id, kind, detail, at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          createId("nevt"),
          input.organizationId,
          input.notificationId ?? null,
          input.kind,
          input.detail ?? null,
          input.at,
        ],
      );
    },
    async saveAlert(row) {
      await query(
        `INSERT INTO tc_system_alerts (id, organization_id, component, severity, message, correlation_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          row.organizationId ?? null,
          row.component,
          row.severity,
          row.message.slice(0, 300),
          row.correlationId,
          row.createdAt,
        ],
      );
    },
    async listAlerts() {
      const res = await query(
        `SELECT * FROM tc_system_alerts ORDER BY created_at DESC LIMIT 200`,
      );
      return res.rows.map((row) => ({
        id: String(row.id),
        organizationId: row.organization_id
          ? String(row.organization_id)
          : undefined,
        component: String(row.component),
        severity: row.severity as SystemAlert["severity"],
        message: String(row.message),
        correlationId: String(row.correlation_id),
        createdAt: new Date(String(row.created_at)).toISOString(),
      }));
    },
    async listOrganizations(sinceIso) {
      const res = await query(
        `SELECT DISTINCT organization_id FROM tc_notifications
         WHERE $1::timestamptz IS NULL OR created_at >= $1`,
        [sinceIso ?? null],
      );
      return res.rows.map((row) => String(row.organization_id));
    },
    async countActivity({ organizationId, userId, sinceIso, untilIso }) {
      const res = await query(
        `SELECT n.type, count(*)::int AS total
         FROM tc_notifications n
         JOIN tc_notification_recipients r
           ON r.notification_id = n.id AND r.organization_id = n.organization_id
         WHERE n.organization_id = $1 AND r.user_id = $2
           AND n.created_at >= $3 AND n.created_at < $4
           AND n.type <> 'daily_summary'
         GROUP BY n.type`,
        [organizationId, userId, sinceIso, untilIso],
      );
      const counts: Partial<Record<NotificationType, number>> = {};
      for (const row of res.rows)
        counts[row.type as NotificationType] = Number(row.total);
      return counts;
    },
  };
}

function deliveryFrom(row: Record<string, unknown>): NotificationDelivery {
  return {
    id: String(row.id),
    notificationId: String(row.notification_id),
    organizationId: String(row.organization_id),
    recipientUserId: row.recipient_user_id
      ? String(row.recipient_user_id)
      : undefined,
    channel: row.channel as NotificationDelivery["channel"],
    status: row.status as NotificationDelivery["status"],
    attempts: Number(row.attempts),
    nextAttemptAt: row.next_attempt_at
      ? new Date(String(row.next_attempt_at)).toISOString()
      : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined,
    providerSid: row.provider_sid ? String(row.provider_sid) : undefined,
    recoveryHandledAt: row.recovery_handled_at
      ? new Date(String(row.recovery_handled_at)).toISOString()
      : undefined,
    destination: row.destination ? String(row.destination) : undefined,
    simulated: Boolean(row.simulated),
    idempotencyKey: String(row.idempotency_key),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}
