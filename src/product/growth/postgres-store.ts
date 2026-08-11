import { Pool } from "pg";
import {
  defaultOrgSettings,
  type OrgSettings,
  type QualificationQuestion,
} from "@/product/starter/qualification";
import {
  createId,
  type Appointment,
  type GrowthStore,
  type PipelineCard,
  type PipelineStage,
  type RevenueEvent,
  type ReviewRequest,
  type TimelineEvent,
} from "./memory-store";

const pools = new Map<string, Pool>();

function getPool(url: string) {
  let pool = pools.get(url);
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 5 });
    pools.set(url, pool);
  }
  return pool;
}

function mapSettings(row: Record<string, unknown>): OrgSettings {
  const rawQs = row.qualification_json;
  let qualificationQuestions: QualificationQuestion[] =
    defaultOrgSettings(String(row.organization_id)).qualificationQuestions;
  if (Array.isArray(rawQs)) {
    qualificationQuestions = rawQs as QualificationQuestion[];
  } else if (typeof rawQs === "string") {
    try {
      qualificationQuestions = JSON.parse(rawQs) as QualificationQuestion[];
    } catch {
      /* keep default */
    }
  }
  return {
    organizationId: String(row.organization_id),
    notifyEmail: (row.notify_email as string) || undefined,
    googleReviewUrl: (row.google_review_url as string) || undefined,
    crmWebhookUrl: (row.crm_webhook_url as string) || undefined,
    qualificationQuestions,
    onboardingCompletedAt: row.onboarding_completed_at
      ? new Date(row.onboarding_completed_at as string | Date).toISOString()
      : undefined,
    localeDefault: row.locale_default === "fr" ? "fr" : "en",
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
  };
}

function mapAppointment(row: Record<string, unknown>): Appointment {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    customerName: (row.customer_name as string) || undefined,
    customerPhoneE164: (row.customer_phone_e164 as string) || undefined,
    customerEmail: (row.customer_email as string) || undefined,
    title: String(row.title),
    startsAt: new Date(row.starts_at as string | Date).toISOString(),
    endsAt: row.ends_at
      ? new Date(row.ends_at as string | Date).toISOString()
      : undefined,
    status: row.status as Appointment["status"],
    source: row.source as Appointment["source"],
    sourceRefId: (row.source_ref_id as string) || undefined,
    reminder24hSent: Boolean(row.reminder_24h_sent),
    reminder2hSent: Boolean(row.reminder_2h_sent),
    notes: (row.notes as string) || undefined,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
  };
}

function mapPipeline(row: Record<string, unknown>): PipelineCard {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    stage: row.stage as PipelineStage,
    title: String(row.title),
    source: row.source as PipelineCard["source"],
    sourceRefId: (row.source_ref_id as string) || undefined,
    customerPhoneE164: (row.customer_phone_e164 as string) || undefined,
    estimatedValue:
      row.estimated_value == null ? undefined : Number(row.estimated_value),
    assignedTo: (row.assigned_to as string) || undefined,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
  };
}

function mapRevenue(row: Record<string, unknown>): RevenueEvent {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    amount: Number(row.amount),
    currency: String(row.currency || "CAD"),
    source: row.source as RevenueEvent["source"],
    sourceRefId: (row.source_ref_id as string) || undefined,
    pipelineCardId: (row.pipeline_card_id as string) || undefined,
    note: (row.note as string) || undefined,
    occurredAt: new Date(row.occurred_at as string | Date).toISOString(),
    createdAt: new Date(row.created_at as string | Date).toISOString(),
  };
}

function mapReview(row: Record<string, unknown>): ReviewRequest {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    customerPhoneE164: String(row.customer_phone_e164),
    customerName: (row.customer_name as string) || undefined,
    status: row.status as ReviewRequest["status"],
    appointmentId: (row.appointment_id as string) || undefined,
    scheduledFor: new Date(row.scheduled_for as string | Date).toISOString(),
    sentAt: row.sent_at
      ? new Date(row.sent_at as string | Date).toISOString()
      : undefined,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
  };
}

function mapTimeline(row: Record<string, unknown>): TimelineEvent {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    kind: String(row.kind),
    refId: (row.ref_id as string) || undefined,
    title: String(row.title),
    detail: (row.detail as string) || undefined,
    actor: String(row.actor || "system"),
    at: new Date(row.at as string | Date).toISOString(),
  };
}

export function createPostgresGrowthStore(connectionString: string): GrowthStore {
  const pool = getPool(connectionString);

  return {
    async getOrgSettings(organizationId) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_org_settings WHERE organization_id = $1`,
        [organizationId],
      );
      if (!rows[0]) return defaultOrgSettings(organizationId);
      return mapSettings(rows[0]);
    },

    async upsertOrgSettings(organizationId, patch) {
      const current = await this.getOrgSettings(organizationId);
      const next: OrgSettings = {
        ...current,
        ...patch,
        qualificationQuestions:
          patch.qualificationQuestions ?? current.qualificationQuestions,
        updatedAt: new Date().toISOString(),
      };
      await pool.query(
        `INSERT INTO tc_org_settings (
           organization_id, notify_email, google_review_url, crm_webhook_url,
           qualification_json, onboarding_completed_at, locale_default, updated_at
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,now())
         ON CONFLICT (organization_id) DO UPDATE SET
           notify_email = EXCLUDED.notify_email,
           google_review_url = EXCLUDED.google_review_url,
           crm_webhook_url = EXCLUDED.crm_webhook_url,
           qualification_json = EXCLUDED.qualification_json,
           onboarding_completed_at = EXCLUDED.onboarding_completed_at,
           locale_default = EXCLUDED.locale_default,
           updated_at = now()`,
        [
          organizationId,
          next.notifyEmail ?? null,
          next.googleReviewUrl ?? null,
          next.crmWebhookUrl ?? null,
          JSON.stringify(next.qualificationQuestions),
          next.onboardingCompletedAt ?? null,
          next.localeDefault,
        ],
      );
      return next;
    },

    async createAppointment(input) {
      const id = input.id ?? createId("appt");
      const { rows } = await pool.query(
        `INSERT INTO tc_appointments (
           id, organization_id, customer_name, customer_phone_e164, customer_email,
           title, starts_at, ends_at, status, source, source_ref_id, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          id,
          input.organizationId,
          input.customerName ?? null,
          input.customerPhoneE164 ?? null,
          input.customerEmail ?? null,
          input.title,
          input.startsAt,
          input.endsAt ?? null,
          input.status,
          input.source,
          input.sourceRefId ?? null,
          input.notes ?? null,
        ],
      );
      return mapAppointment(rows[0]);
    },

    async listAppointments(organizationId) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_appointments
         WHERE organization_id = $1 ORDER BY starts_at ASC`,
        [organizationId],
      );
      return rows.map(mapAppointment);
    },

    async getAppointment(id, organizationId) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_appointments WHERE id = $1 AND organization_id = $2`,
        [id, organizationId],
      );
      return rows[0] ? mapAppointment(rows[0]) : null;
    },

    async updateAppointment(id, organizationId, patch) {
      const current = await this.getAppointment(id, organizationId);
      if (!current) return null;
      const next = { ...current, ...patch };
      const { rows } = await pool.query(
        `UPDATE tc_appointments SET
           status = $3, reminder_24h_sent = $4, reminder_2h_sent = $5,
           notes = $6, title = $7, starts_at = $8, ends_at = $9, updated_at = now()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [
          id,
          organizationId,
          next.status,
          next.reminder24hSent,
          next.reminder2hSent,
          next.notes ?? null,
          next.title,
          next.startsAt,
          next.endsAt ?? null,
        ],
      );
      return rows[0] ? mapAppointment(rows[0]) : null;
    },

    async listDueAppointmentReminders(nowIso) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_appointments
         WHERE status IN ('scheduled', 'confirmed')
           AND starts_at > $1::timestamptz
           AND (
             (reminder_24h_sent = false AND starts_at <= $1::timestamptz + interval '24 hours')
             OR
             (reminder_2h_sent = false AND starts_at <= $1::timestamptz + interval '2 hours')
           )`,
        [nowIso],
      );
      return rows.map(mapAppointment);
    },

    async upsertPipelineCard(input) {
      if (input.sourceRefId) {
        const existing = await pool.query(
          `SELECT * FROM tc_pipeline_cards
           WHERE organization_id = $1 AND source = $2 AND source_ref_id = $3`,
          [input.organizationId, input.source, input.sourceRefId],
        );
        if (existing.rows[0]) {
          const { rows } = await pool.query(
            `UPDATE tc_pipeline_cards SET
               title = $2, stage = $3, customer_phone_e164 = COALESCE($4, customer_phone_e164),
               estimated_value = COALESCE($5, estimated_value), updated_at = now()
             WHERE id = $1 RETURNING *`,
            [
              existing.rows[0].id,
              input.title,
              input.stage,
              input.customerPhoneE164 ?? null,
              input.estimatedValue ?? null,
            ],
          );
          return mapPipeline(rows[0]);
        }
      }
      const id = input.id ?? createId("pipe");
      const { rows } = await pool.query(
        `INSERT INTO tc_pipeline_cards (
           id, organization_id, stage, title, source, source_ref_id,
           customer_phone_e164, estimated_value, assigned_to
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          id,
          input.organizationId,
          input.stage,
          input.title,
          input.source,
          input.sourceRefId ?? null,
          input.customerPhoneE164 ?? null,
          input.estimatedValue ?? null,
          input.assignedTo ?? null,
        ],
      );
      return mapPipeline(rows[0]);
    },

    async listPipeline(organizationId) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_pipeline_cards
         WHERE organization_id = $1 ORDER BY updated_at DESC`,
        [organizationId],
      );
      return rows.map(mapPipeline);
    },

    async updatePipelineStage(id, organizationId, stage, estimatedValue) {
      const { rows } = await pool.query(
        `UPDATE tc_pipeline_cards SET
           stage = $3,
           estimated_value = COALESCE($4, estimated_value),
           updated_at = now()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [id, organizationId, stage, estimatedValue ?? null],
      );
      return rows[0] ? mapPipeline(rows[0]) : null;
    },

    async addRevenueEvent(input) {
      const id = input.id ?? createId("rev");
      const { rows } = await pool.query(
        `INSERT INTO tc_revenue_events (
           id, organization_id, amount, currency, source, source_ref_id,
           pipeline_card_id, note, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          id,
          input.organizationId,
          input.amount,
          input.currency,
          input.source,
          input.sourceRefId ?? null,
          input.pipelineCardId ?? null,
          input.note ?? null,
          input.occurredAt,
        ],
      );
      return mapRevenue(rows[0]);
    },

    async listRevenue(organizationId) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_revenue_events
         WHERE organization_id = $1 ORDER BY occurred_at DESC`,
        [organizationId],
      );
      return rows.map(mapRevenue);
    },

    async createReviewRequest(input) {
      const id = input.id ?? createId("revq");
      const { rows } = await pool.query(
        `INSERT INTO tc_review_requests (
           id, organization_id, customer_phone_e164, customer_name, status,
           appointment_id, scheduled_for
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          id,
          input.organizationId,
          input.customerPhoneE164,
          input.customerName ?? null,
          input.status ?? "pending",
          input.appointmentId ?? null,
          input.scheduledFor,
        ],
      );
      return mapReview(rows[0]);
    },

    async listReviewRequests(organizationId) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_review_requests
         WHERE organization_id = $1 ORDER BY created_at DESC`,
        [organizationId],
      );
      return rows.map(mapReview);
    },

    async listDueReviewRequests(nowIso, limit) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_review_requests
         WHERE status = 'pending' AND scheduled_for <= $1::timestamptz
         ORDER BY scheduled_for ASC LIMIT $2`,
        [nowIso, limit],
      );
      return rows.map(mapReview);
    },

    async updateReviewRequest(id, organizationId, patch) {
      const current = await pool.query(
        `SELECT * FROM tc_review_requests WHERE id = $1 AND organization_id = $2`,
        [id, organizationId],
      );
      if (!current.rows[0]) return null;
      const mapped = mapReview(current.rows[0]);
      const next = { ...mapped, ...patch };
      const { rows } = await pool.query(
        `UPDATE tc_review_requests SET
           status = $3, sent_at = $4, updated_at = now()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [id, organizationId, next.status, next.sentAt ?? null],
      );
      return rows[0] ? mapReview(rows[0]) : null;
    },

    async addTimelineEvent(input) {
      const id = input.id ?? createId("tl");
      const { rows } = await pool.query(
        `INSERT INTO tc_timeline_events (
           id, organization_id, kind, ref_id, title, detail, actor, at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          id,
          input.organizationId,
          input.kind,
          input.refId ?? null,
          input.title,
          input.detail ?? null,
          input.actor,
          input.at,
        ],
      );
      return mapTimeline(rows[0]);
    },

    async listTimeline(organizationId, limit = 100) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_timeline_events
         WHERE organization_id = $1 ORDER BY at DESC LIMIT $2`,
        [organizationId, limit],
      );
      return rows.map(mapTimeline);
    },

    async enqueueCrmDlq(input) {
      const id = input.id ?? createId("crmdlq");
      const { rows } = await pool.query(
        `INSERT INTO tc_crm_dlq (
           id, organization_id, event_type, payload, last_error, attempts
         ) VALUES ($1,$2,$3,$4::jsonb,$5,$6)
         RETURNING id, organization_id, event_type, payload, last_error, attempts,
                   created_at, updated_at`,
        [
          id,
          input.organizationId,
          input.eventType,
          JSON.stringify(input.payload),
          input.lastError ?? null,
          input.attempts ?? 1,
        ],
      );
      const row = rows[0];
      return {
        id: String(row.id),
        organizationId: String(row.organization_id),
        eventType: String(row.event_type),
        payload: row.payload as Record<string, unknown>,
        lastError: (row.last_error as string) || undefined,
        attempts: Number(row.attempts ?? 1),
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      };
    },

    async listCrmDlq(organizationId, limit = 50) {
      const { rows } = await pool.query(
        `SELECT id, organization_id, event_type, payload, last_error, attempts,
                created_at, updated_at
         FROM tc_crm_dlq
         WHERE organization_id = $1
         ORDER BY created_at DESC LIMIT $2`,
        [organizationId, limit],
      );
      return rows.map((row) => ({
        id: String(row.id),
        organizationId: String(row.organization_id),
        eventType: String(row.event_type),
        payload: row.payload as Record<string, unknown>,
        lastError: (row.last_error as string) || undefined,
        attempts: Number(row.attempts ?? 1),
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      }));
    },

    async listDueCrmDlq(limit) {
      const { rows } = await pool.query(
        `SELECT id, organization_id, event_type, payload, last_error, attempts,
                created_at, updated_at
         FROM tc_crm_dlq
         WHERE attempts < 8
         ORDER BY updated_at ASC LIMIT $1`,
        [limit],
      );
      return rows.map((row) => ({
        id: String(row.id),
        organizationId: String(row.organization_id),
        eventType: String(row.event_type),
        payload: row.payload as Record<string, unknown>,
        lastError: (row.last_error as string) || undefined,
        attempts: Number(row.attempts ?? 1),
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      }));
    },

    async updateCrmDlq(id, organizationId, patch) {
      const list = await this.listCrmDlq(organizationId, 200);
      const current = list.find((x) => x.id === id);
      if (!current) return null;
      if (patch.resolved) {
        await pool.query(
          `DELETE FROM tc_crm_dlq WHERE id = $1 AND organization_id = $2`,
          [id, organizationId],
        );
        return { ...current, ...patch, updatedAt: new Date().toISOString() };
      }
      const next = {
        ...current,
        lastError: patch.lastError ?? current.lastError,
        attempts: patch.attempts ?? current.attempts,
        updatedAt: new Date().toISOString(),
      };
      await pool.query(
        `UPDATE tc_crm_dlq SET last_error = $3, attempts = $4, updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [id, organizationId, next.lastError ?? null, next.attempts],
      );
      return next;
    },
  };
}
