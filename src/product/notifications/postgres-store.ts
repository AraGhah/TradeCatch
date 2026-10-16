import { createId } from "@/lib/id";
import { getPgPool } from "@/product/missed-call/postgres-store";
import type { NotificationStore } from "./store";
import type {
  ContractorNotification,
  EscalationRule,
  NotificationDelivery,
  NotificationPayload,
  NotificationPreferences,
  NotificationRecipient,
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
    consolidateKey: row.consolidate_key ? String(row.consolidate_key) : undefined,
    idempotencyKey: String(row.idempotency_key),
    simulated: Boolean(row.simulated),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export function createPostgresNotificationStore(connectionString: string): NotificationStore {
  const pool = getPgPool(connectionString);
  const query = (text: string, values?: unknown[]) => pool.query(text, values);

  return {
    async insertOutbox(row) {
      const res = await query(
        `INSERT INTO tc_outbox_events (id, organization_id, idempotency_key, type, payload_json, status, attempts, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [row.id, row.organizationId, row.idempotencyKey, row.type, JSON.stringify(row.payload), row.status, row.attempts, row.createdAt, row.updatedAt],
      );
      return res.rows[0] ? row : null;
    },
    async claimOutbox(limit, nowIso) {
      const res = await query(
        `UPDATE tc_outbox_events SET status = 'processing', updated_at = $2
         WHERE id IN (
           SELECT id FROM tc_outbox_events
           WHERE status = 'pending'
              OR (status = 'processing' AND updated_at < $2::timestamptz - interval '10 minutes')
           ORDER BY created_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
        [limit, nowIso],
      );
      return res.rows.map((row) => ({
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
      const res = await query(`SELECT * FROM tc_notifications WHERE organization_id = $1 AND idempotency_key = $2`, [organizationId, key]);
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
        [row.id, row.organizationId, row.type, row.title, row.message, row.priority, row.leadId ?? null, row.appointmentId ?? null, row.callId ?? null, row.href ?? null, row.consolidateKey ?? null, row.idempotencyKey, row.simulated, row.createdAt, row.updatedAt],
      );
    },
    async listNotifications(organizationId) {
      const res = await query(`SELECT * FROM tc_notifications WHERE organization_id = $1 ORDER BY created_at DESC`, [organizationId]);
      return res.rows.map(noteFrom);
    },
    async getNotification(organizationId, id) {
      const res = await query(`SELECT * FROM tc_notifications WHERE organization_id = $1 AND id = $2`, [organizationId, id]);
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
        [row.id, row.notificationId, row.organizationId, row.userId, row.readAt ?? null, row.acknowledgedAt ?? null, row.acknowledgedBy ?? null],
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
        readAt: row.read_at ? new Date(String(row.read_at)).toISOString() : undefined,
        acknowledgedAt: row.acknowledged_at ? new Date(String(row.acknowledged_at)).toISOString() : undefined,
        acknowledgedBy: row.acknowledged_by ? String(row.acknowledged_by) : undefined,
      })) satisfies NotificationRecipient[];
    },
    async saveDelivery(row) {
      const res = await query(
        `INSERT INTO tc_notification_deliveries (
          id, notification_id, organization_id, recipient_user_id, channel, status, attempts,
          next_attempt_at, last_error, provider_sid, destination, simulated, idempotency_key, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (organization_id, idempotency_key) DO UPDATE SET
          status = EXCLUDED.status, attempts = EXCLUDED.attempts, next_attempt_at = EXCLUDED.next_attempt_at,
          last_error = EXCLUDED.last_error, provider_sid = EXCLUDED.provider_sid, updated_at = EXCLUDED.updated_at
        RETURNING id`,
        [row.id, row.notificationId, row.organizationId, row.recipientUserId ?? null, row.channel, row.status, row.attempts, row.nextAttemptAt ?? null, row.lastError ?? null, row.providerSid ?? null, row.destination ?? null, row.simulated, row.idempotencyKey, row.createdAt, row.updatedAt],
      );
      return res.rows[0] ? row : null;
    },
    async listDeliveries(organizationId) {
      const res = await query(`SELECT * FROM tc_notification_deliveries WHERE organization_id = $1`, [organizationId]);
      return res.rows.map(deliveryFrom);
    },
    async dueDeliveries(nowIso) {
      const res = await query(
        `SELECT * FROM tc_notification_deliveries WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= $1)`,
        [nowIso],
      );
      return res.rows.map(deliveryFrom);
    },
    async findDeliveryBySid(sid) {
      const res = await query(`SELECT * FROM tc_notification_deliveries WHERE provider_sid = $1`, [sid]);
      return res.rows[0] ? deliveryFrom(res.rows[0]) : null;
    },
    async getPreferences(organizationId, userId) {
      const res = await query(`SELECT settings_json FROM tc_notification_preferences WHERE organization_id = $1 AND user_id = $2`, [organizationId, userId]);
      return (res.rows[0]?.settings_json as NotificationPreferences | undefined) ?? null;
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
      const res = await query(`SELECT * FROM tc_escalation_rules WHERE organization_id = $1`, [organizationId]);
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
        [rule.organizationId, rule.enabled, rule.primaryUserId ?? null, rule.secondaryUserId ?? null, rule.secondaryPhoneE164 ?? null, rule.emailEnabled, rule.smsEnabled, rule.acknowledgementRequired, rule.delayMinutes, rule.maxAttempts, rule.afterHours, rule.updatedAt],
      );
    },
    async addEscalationAttempt(input) {
      await query(
        `INSERT INTO tc_escalation_attempts (id, organization_id, notification_id, recipient_user_id, outcome, at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [createId("esc"), input.organizationId, input.notificationId, input.recipientUserId ?? null, input.outcome, input.at],
      );
    },
    async listEscalationAttempts(organizationId, notificationId) {
      const res = await query(
        `SELECT outcome, at FROM tc_escalation_attempts WHERE organization_id = $1 AND notification_id = $2`,
        [organizationId, notificationId],
      );
      return res.rows.map((row) => ({ outcome: String(row.outcome), at: new Date(String(row.at)).toISOString() }));
    },
    async addEvent(input) {
      await query(
        `INSERT INTO tc_notification_events (id, organization_id, notification_id, kind, detail, at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [createId("nevt"), input.organizationId, input.notificationId ?? null, input.kind, input.detail ?? null, input.at],
      );
    },
    async saveAlert(row) {
      await query(
        `INSERT INTO tc_system_alerts (id, organization_id, component, severity, message, correlation_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [row.id, row.organizationId ?? null, row.component, row.severity, row.message.slice(0, 300), row.correlationId, row.createdAt],
      );
    },
    async listAlerts() {
      const res = await query(`SELECT * FROM tc_system_alerts ORDER BY created_at DESC LIMIT 200`);
      return res.rows.map((row) => ({
        id: String(row.id),
        organizationId: row.organization_id ? String(row.organization_id) : undefined,
        component: String(row.component),
        severity: row.severity as SystemAlert["severity"],
        message: String(row.message),
        correlationId: String(row.correlation_id),
        createdAt: new Date(String(row.created_at)).toISOString(),
      }));
    },
    async listOrganizations() {
      const res = await query(`SELECT DISTINCT organization_id FROM tc_notifications`);
      return res.rows.map((row) => String(row.organization_id));
    },
  };
}

function deliveryFrom(row: Record<string, unknown>): NotificationDelivery {
  return {
    id: String(row.id),
    notificationId: String(row.notification_id),
    organizationId: String(row.organization_id),
    recipientUserId: row.recipient_user_id ? String(row.recipient_user_id) : undefined,
    channel: row.channel as NotificationDelivery["channel"],
    status: row.status as NotificationDelivery["status"],
    attempts: Number(row.attempts),
    nextAttemptAt: row.next_attempt_at ? new Date(String(row.next_attempt_at)).toISOString() : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined,
    providerSid: row.provider_sid ? String(row.provider_sid) : undefined,
    destination: row.destination ? String(row.destination) : undefined,
    simulated: Boolean(row.simulated),
    idempotencyKey: String(row.idempotency_key),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}
