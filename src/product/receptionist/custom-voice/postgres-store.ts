import type { Pool } from "pg";
import { createId } from "@/lib/id";
import { getPgPool } from "@/product/missed-call/postgres-store";
import type { OrgVoiceRecord, VoiceEvent, VoiceEventAction, VoiceMode } from "./model";
import type { OrgVoiceStore } from "./store";

type Row = Record<string, unknown>;

const COLUMNS = `organization_id, mode, status, provider_voice_id,
  consent_statement_version, consent_signer_name, consent_accepted_by_user_id,
  consent_accepted_at, consent_revoked_at, consent_revoked_by, verified_at,
  previewed_at, activated_at, last_challenge_nonce, version, created_at, updated_at`;

const iso = (value: unknown): string => new Date(value as string | Date).toISOString();
const isoOrNull = (value: unknown): string | null => (value == null ? null : iso(value));
const text = (value: unknown): string | null => (value == null ? null : String(value));

function mapRow(row: Row): OrgVoiceRecord {
  const consent =
    row.consent_accepted_at != null && row.consent_statement_version != null
      ? {
          statementVersion: String(row.consent_statement_version),
          signerName: String(row.consent_signer_name ?? ""),
          acceptedByUserId: String(row.consent_accepted_by_user_id ?? ""),
          acceptedAt: iso(row.consent_accepted_at),
        }
      : null;
  return {
    organizationId: String(row.organization_id),
    mode: row.mode === "custom" ? "custom" : ("standard" as VoiceMode),
    status:
      row.status === "ready" ? "ready" : row.status === "deleting" ? "deleting" : "none",
    providerVoiceId: text(row.provider_voice_id),
    consent,
    consentRevokedAt: isoOrNull(row.consent_revoked_at),
    consentRevokedBy: text(row.consent_revoked_by),
    verifiedAt: isoOrNull(row.verified_at),
    previewedAt: isoOrNull(row.previewed_at),
    activatedAt: isoOrNull(row.activated_at),
    lastChallengeNonce: text(row.last_challenge_nonce),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    version: Number(row.version),
  };
}

function mapEvent(row: Row): VoiceEvent {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    actorUserId: text(row.actor_user_id),
    action: row.action as VoiceEventAction,
    detail: (row.detail as VoiceEvent["detail"] | null) ?? {},
    createdAt: iso(row.created_at),
  };
}

/** Every statement is parameterised and scoped by organization id. */
export function createPostgresVoiceStore(
  connectionStringOrPool: string | Pool,
): OrgVoiceStore {
  const db =
    typeof connectionStringOrPool === "string"
      ? getPgPool(connectionStringOrPool)
      : connectionStringOrPool;

  function params(r: OrgVoiceRecord) {
    return [
      r.organizationId,
      r.mode,
      r.status,
      r.providerVoiceId,
      r.consent?.statementVersion ?? null,
      r.consent?.signerName ?? null,
      r.consent?.acceptedByUserId ?? null,
      r.consent?.acceptedAt ?? null,
      r.consentRevokedAt,
      r.consentRevokedBy,
      r.verifiedAt,
      r.previewedAt,
      r.activatedAt,
      r.lastChallengeNonce,
      r.createdAt,
      r.updatedAt,
    ];
  }

  return {
    async get(organizationId) {
      const { rows } = await db.query<Row>(
        `SELECT ${COLUMNS} FROM rc_custom_voices WHERE organization_id = $1`,
        [organizationId],
      );
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async save(record) {
      if (record.version === 0) {
        const { rows } = await db.query<Row>(
          `INSERT INTO rc_custom_voices (
             organization_id, mode, status, provider_voice_id,
             consent_statement_version, consent_signer_name, consent_accepted_by_user_id,
             consent_accepted_at, consent_revoked_at, consent_revoked_by, verified_at,
             previewed_at, activated_at, last_challenge_nonce, created_at, updated_at,
             version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,1)
           ON CONFLICT (organization_id) DO NOTHING
           RETURNING ${COLUMNS}`,
          params(record),
        );
        return rows[0] ? mapRow(rows[0]) : null;
      }
      const { rows } = await db.query<Row>(
        `UPDATE rc_custom_voices SET
           mode = $2, status = $3, provider_voice_id = $4,
           consent_statement_version = $5, consent_signer_name = $6,
           consent_accepted_by_user_id = $7, consent_accepted_at = $8,
           consent_revoked_at = $9, consent_revoked_by = $10, verified_at = $11,
           previewed_at = $12, activated_at = $13, last_challenge_nonce = $14,
           updated_at = $15, version = version + 1
         WHERE organization_id = $1 AND version = $16
         RETURNING ${COLUMNS}`,
        // created_at is never rewritten: drop it from the values (index 14).
        [...params(record).filter((_, i) => i !== 14), record.version],
      );
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async remove(organizationId) {
      await db.query(`DELETE FROM rc_custom_voices WHERE organization_id = $1`, [
        organizationId,
      ]);
    },

    async addEvent(event) {
      const id = createId("rve");
      await db.query(
        `INSERT INTO rc_voice_events (id, organization_id, actor_user_id, action, detail, created_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
        [
          id,
          event.organizationId,
          event.actorUserId,
          event.action,
          JSON.stringify(event.detail),
          event.createdAt,
        ],
      );
      return { ...event, id };
    },

    async listEvents(organizationId, limit = 50) {
      const { rows } = await db.query<Row>(
        `SELECT id, organization_id, actor_user_id, action, detail, created_at
           FROM rc_voice_events
          WHERE organization_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [organizationId, Math.max(1, Math.min(Math.trunc(limit), 200))],
      );
      return rows.map(mapEvent);
    },
  };
}
