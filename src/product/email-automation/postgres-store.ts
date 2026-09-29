import { Pool } from "pg";
import { createId } from "@/lib/id";
import {
  normalizeEmail,
  type EmailAutomationStore,
  type EmailOrgSettings,
} from "./store";
import type {
  EmailEnrollment,
  EmailSequence,
  EmailTemplate,
  SequenceStep,
} from "./types";

const pools = new Map<string, Pool>();

function getPool(url: string) {
  let pool = pools.get(url);
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 5 });
    pools.set(url, pool);
  }
  return pool;
}

const iso = (v: unknown) => new Date(v as string | Date).toISOString();
const isoOpt = (v: unknown) => (v ? iso(v) : undefined);
const json = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
};

function mapTemplate(r: Record<string, unknown>): EmailTemplate {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    name: String(r.name),
    locale: r.locale === "en" ? "en" : "fr",
    subject: String(r.subject),
    body: String(r.body),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function mapSequence(r: Record<string, unknown>): EmailSequence {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    name: String(r.name),
    steps: json<SequenceStep[]>(r.steps_json, []),
    stopOnReply: Boolean(r.stop_on_reply),
    active: Boolean(r.active),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function mapEnrollment(r: Record<string, unknown>): EmailEnrollment {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    sequenceId: String(r.sequence_id),
    email: String(r.email),
    name: (r.name as string) || undefined,
    vars: json<Record<string, string>>(r.vars_json, {}),
    status: r.status as EmailEnrollment["status"],
    stopReason: (r.stop_reason as EmailEnrollment["stopReason"]) || undefined,
    currentStep: Number(r.current_step),
    nextSendAt: isoOpt(r.next_send_at),
    attempts: Number(r.attempts),
    lockedUntil: isoOpt(r.locked_until),
    history: json(r.history_json, []),
    source: (r.source as string) || undefined,
    sourceRefId: (r.source_ref_id as string) || undefined,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

const ENROLLMENT_COLUMNS: Record<string, string> = {
  status: "status",
  stopReason: "stop_reason",
  currentStep: "current_step",
  nextSendAt: "next_send_at",
  attempts: "attempts",
  lockedUntil: "locked_until",
  history: "history_json",
  vars: "vars_json",
  name: "name",
};

export function createPostgresEmailAutomationStore(
  url: string,
): EmailAutomationStore {
  const pool = getPool(url);

  const store: EmailAutomationStore = {
    async upsertTemplate(input) {
      const res = await pool.query(
        `INSERT INTO em_templates (id, organization_id, name, locale, subject, body)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, locale = EXCLUDED.locale,
           subject = EXCLUDED.subject, body = EXCLUDED.body, updated_at = now()
         WHERE em_templates.organization_id = EXCLUDED.organization_id
         RETURNING *`,
        [
          input.id ?? createId("emt"),
          input.organizationId,
          input.name,
          input.locale,
          input.subject,
          input.body,
        ],
      );
      if (!res.rows[0])
        throw new Error("Template belongs to another organization");
      return mapTemplate(res.rows[0]);
    },
    async listTemplates(organizationId) {
      const res = await pool.query(
        `SELECT * FROM em_templates WHERE organization_id = $1 ORDER BY created_at`,
        [organizationId],
      );
      return res.rows.map(mapTemplate);
    },
    async getTemplate(id, organizationId) {
      const res = await pool.query(
        `SELECT * FROM em_templates WHERE id = $1 AND organization_id = $2`,
        [id, organizationId],
      );
      return res.rows[0] ? mapTemplate(res.rows[0]) : null;
    },

    async upsertSequence(input) {
      const res = await pool.query(
        `INSERT INTO em_sequences (id, organization_id, name, steps_json, stop_on_reply, active)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, steps_json = EXCLUDED.steps_json,
           stop_on_reply = EXCLUDED.stop_on_reply, active = EXCLUDED.active, updated_at = now()
         WHERE em_sequences.organization_id = EXCLUDED.organization_id
         RETURNING *`,
        [
          input.id ?? createId("ems"),
          input.organizationId,
          input.name,
          JSON.stringify(input.steps),
          input.stopOnReply,
          input.active,
        ],
      );
      if (!res.rows[0])
        throw new Error("Sequence belongs to another organization");
      return mapSequence(res.rows[0]);
    },
    async listSequences(organizationId) {
      const res = await pool.query(
        `SELECT * FROM em_sequences WHERE organization_id = $1 ORDER BY created_at`,
        [organizationId],
      );
      return res.rows.map(mapSequence);
    },
    async getSequence(id, organizationId) {
      const res = await pool.query(
        `SELECT * FROM em_sequences WHERE id = $1 AND organization_id = $2`,
        [id, organizationId],
      );
      return res.rows[0] ? mapSequence(res.rows[0]) : null;
    },

    async createEnrollment(input) {
      const res = await pool.query(
        `INSERT INTO em_enrollments
           (id, organization_id, sequence_id, email, name, vars_json, status, stop_reason,
            current_step, next_send_at, attempts, history_json, source, source_ref_id)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
         RETURNING *`,
        [
          createId("eme"),
          input.organizationId,
          input.sequenceId,
          normalizeEmail(input.email),
          input.name ?? null,
          JSON.stringify(input.vars),
          input.status,
          input.stopReason ?? null,
          input.currentStep,
          input.nextSendAt ?? null,
          input.attempts,
          JSON.stringify(input.history),
          input.source ?? null,
          input.sourceRefId ?? null,
        ],
      );
      return mapEnrollment(res.rows[0]);
    },
    async getEnrollment(id, organizationId) {
      const res = await pool.query(
        `SELECT * FROM em_enrollments WHERE id = $1 AND organization_id = $2`,
        [id, organizationId],
      );
      return res.rows[0] ? mapEnrollment(res.rows[0]) : null;
    },
    async listEnrollments(organizationId, limit = 200) {
      const res = await pool.query(
        `SELECT * FROM em_enrollments WHERE organization_id = $1
         ORDER BY created_at DESC LIMIT $2`,
        [organizationId, limit],
      );
      return res.rows.map(mapEnrollment);
    },
    async findActiveEnrollment(organizationId, sequenceId, email) {
      const res = await pool.query(
        `SELECT * FROM em_enrollments
         WHERE organization_id = $1 AND sequence_id = $2 AND email = $3 AND status = 'active'
         LIMIT 1`,
        [organizationId, sequenceId, normalizeEmail(email)],
      );
      return res.rows[0] ? mapEnrollment(res.rows[0]) : null;
    },
    async listActiveEnrollmentsByEmail(organizationId, email) {
      const res = await pool.query(
        `SELECT * FROM em_enrollments
         WHERE organization_id = $1 AND email = $2 AND status = 'active'`,
        [organizationId, normalizeEmail(email)],
      );
      return res.rows.map(mapEnrollment);
    },
    async claimDueEnrollments(nowIso, leaseUntilIso, limit) {
      const res = await pool.query(
        `UPDATE em_enrollments SET locked_until = $2, updated_at = now()
         WHERE id IN (
           SELECT id FROM em_enrollments
           WHERE status = 'active' AND next_send_at <= $1
             AND (locked_until IS NULL OR locked_until <= $1)
           ORDER BY next_send_at
           LIMIT $3
           FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
        [nowIso, leaseUntilIso, limit],
      );
      return res.rows.map(mapEnrollment);
    },
    async updateEnrollment(id, organizationId, patch) {
      const sets: string[] = [];
      const values: unknown[] = [id, organizationId];
      for (const [key, column] of Object.entries(ENROLLMENT_COLUMNS)) {
        if (!(key in patch)) continue;
        let value = (patch as Record<string, unknown>)[key];
        if (key === "history" || key === "vars") value = JSON.stringify(value);
        values.push(value ?? null);
        const cast = key === "history" || key === "vars" ? "::jsonb" : "";
        sets.push(`${column} = $${values.length}${cast}`);
      }
      if (sets.length === 0) return store.getEnrollment(id, organizationId);
      const res = await pool.query(
        `UPDATE em_enrollments SET ${sets.join(", ")}, updated_at = now()
         WHERE id = $1 AND organization_id = $2 RETURNING *`,
        values,
      );
      return res.rows[0] ? mapEnrollment(res.rows[0]) : null;
    },

    async getOrgSettings(organizationId) {
      const res = await pool.query(
        `SELECT auto_enroll_sequence_id FROM em_org_settings WHERE organization_id = $1`,
        [organizationId],
      );
      const id = res.rows[0]?.auto_enroll_sequence_id as
        string | null | undefined;
      return id
        ? ({ autoEnrollSequenceId: id } satisfies EmailOrgSettings)
        : {};
    },
    async setAutoEnrollSequence(organizationId, sequenceId) {
      await pool.query(
        `INSERT INTO em_org_settings (organization_id, auto_enroll_sequence_id)
         VALUES ($1, $2)
         ON CONFLICT (organization_id) DO UPDATE
           SET auto_enroll_sequence_id = EXCLUDED.auto_enroll_sequence_id, updated_at = now()`,
        [organizationId, sequenceId],
      );
      return sequenceId ? { autoEnrollSequenceId: sequenceId } : {};
    },

    async addSuppression(input) {
      await pool.query(
        `INSERT INTO em_suppressions (organization_id, email, reason, at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (organization_id, email) DO UPDATE SET reason = EXCLUDED.reason, at = EXCLUDED.at`,
        [
          input.organizationId,
          normalizeEmail(input.email),
          input.reason,
          input.at,
        ],
      );
    },
    async isSuppressed(organizationId, email) {
      const res = await pool.query(
        `SELECT 1 FROM em_suppressions WHERE organization_id = $1 AND email = $2`,
        [organizationId, normalizeEmail(email)],
      );
      return (res.rowCount ?? 0) > 0;
    },
  };
  return store;
}
