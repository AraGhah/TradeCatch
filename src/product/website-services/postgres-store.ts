import type { Pool } from "pg";
import { getPgPool } from "@/product/missed-call/postgres-store";
import type {
  WebsiteFocusArea,
  WebsiteRequest,
  WebsiteRequestSource,
  WebsiteRequestStatus,
  WebsiteRequestType,
} from "./model";
import type { WebsiteRequestStore } from "./store";

type Row = Record<string, unknown>;

const COLUMNS = `id, organization_id, request_type, status, source, business_name,
  contact_name, contact_email, contact_phone, current_website_url, focus_areas,
  notes, language, quoted_price_cad, scope_summary, created_at, updated_at,
  status_changed_at`;

const iso = (value: unknown): string =>
  new Date(value as string | Date).toISOString();
const text = (value: unknown): string | null =>
  value == null ? null : String(value);

function mapRow(row: Row): WebsiteRequest {
  return {
    id: String(row.id),
    organizationId: text(row.organization_id),
    requestType: row.request_type as WebsiteRequestType,
    status: row.status as WebsiteRequestStatus,
    source: row.source as WebsiteRequestSource,
    businessName: String(row.business_name),
    contactName: String(row.contact_name),
    contactEmail: String(row.contact_email),
    contactPhone: text(row.contact_phone),
    currentWebsiteUrl: text(row.current_website_url),
    focusAreas: ((row.focus_areas as string[] | null) ?? []) as WebsiteFocusArea[],
    notes: text(row.notes),
    language: row.language === "fr" ? "fr" : "en",
    // NUMERIC arrives as a string from node-postgres.
    quotedPriceCad:
      row.quoted_price_cad == null ? null : Number(row.quoted_price_cad),
    scopeSummary: text(row.scope_summary),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    statusChangedAt: iso(row.status_changed_at),
  };
}

const MAX_LIMIT = 500;
const clamp = (limit: number | undefined, fallback: number) =>
  Math.min(Math.max(Math.trunc(limit ?? fallback), 1), MAX_LIMIT);

/** Every statement is parameterised. */
export function createPostgresWebsiteRequestStore(
  connectionStringOrPool: string | Pool,
): WebsiteRequestStore {
  const db =
    typeof connectionStringOrPool === "string"
      ? getPgPool(connectionStringOrPool)
      : connectionStringOrPool;

  return {
    async create(request, meta) {
      const { rows } = await db.query<Row>(
        `INSERT INTO tc_website_requests (
           id, organization_id, request_type, status, source, business_name,
           contact_name, contact_email, contact_phone, current_website_url,
           focus_areas, notes, language, quoted_price_cad, scope_summary,
           idempotency_key, created_by_user_id, created_at, updated_at,
           status_changed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING ${COLUMNS}`,
        [
          request.id,
          request.organizationId,
          request.requestType,
          request.status,
          request.source,
          request.businessName,
          request.contactName,
          request.contactEmail,
          request.contactPhone,
          request.currentWebsiteUrl,
          request.focusAreas,
          request.notes,
          request.language,
          request.quotedPriceCad,
          request.scopeSummary,
          meta?.idempotencyKey ?? null,
          meta?.createdByUserId ?? null,
          request.createdAt,
          request.updatedAt,
          request.statusChangedAt,
        ],
      );
      if (rows[0]) return { created: true, request: mapRow(rows[0]) };
      // The idempotency key was already used: hand back the original request.
      const existing = await db.query<Row>(
        `SELECT ${COLUMNS} FROM tc_website_requests WHERE idempotency_key = $1`,
        [meta?.idempotencyKey],
      );
      if (!existing.rows[0]) throw new Error("website request insert conflict");
      return { created: false, request: mapRow(existing.rows[0]) };
    },

    async get(id) {
      const { rows } = await db.query<Row>(
        `SELECT ${COLUMNS} FROM tc_website_requests WHERE id = $1`,
        [id],
      );
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async listForOrganization(organizationId, limit) {
      const { rows } = await db.query<Row>(
        `SELECT ${COLUMNS} FROM tc_website_requests
          WHERE organization_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [organizationId, clamp(limit, 100)],
      );
      return rows.map(mapRow);
    },

    async listAll(filter = {}) {
      const { rows } = await db.query<Row>(
        `SELECT ${COLUMNS} FROM tc_website_requests
          WHERE ($1::text IS NULL OR status = $1)
          ORDER BY created_at DESC
          LIMIT $2`,
        [filter.status ?? null, clamp(filter.limit, 100)],
      );
      return rows.map(mapRow);
    },

    async update(id, expectedStatus, patch, at) {
      // COALESCE keeps a column when the patch leaves it out; the CASE flags let
      // a caller clear the quote by passing an explicit null.
      const { rows } = await db.query<Row>(
        `UPDATE tc_website_requests SET
           status = COALESCE($3, status),
           status_changed_at = CASE WHEN $3 IS NOT NULL AND $3 <> status THEN $6::timestamptz ELSE status_changed_at END,
           quoted_price_cad = CASE WHEN $7 THEN $4::numeric ELSE quoted_price_cad END,
           scope_summary = CASE WHEN $8 THEN $5 ELSE scope_summary END,
           updated_at = $6::timestamptz
         WHERE id = $1 AND status = $2
         RETURNING ${COLUMNS}`,
        [
          id,
          expectedStatus,
          patch.status ?? null,
          patch.quotedPriceCad ?? null,
          patch.scopeSummary ?? null,
          at,
          patch.quotedPriceCad !== undefined,
          patch.scopeSummary !== undefined,
        ],
      );
      return rows[0] ? mapRow(rows[0]) : null;
    },
  };
}
