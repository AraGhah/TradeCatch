import type { Pool } from "pg";
import { createId } from "@/lib/id";
import { getPgPool } from "@/lib/postgres-pool";
import type {
  WebsiteFocusArea,
  WebsiteNotificationStatus,
  WebsitePaymentStatus,
  WebsiteRequest,
  WebsiteRequestEvent,
  WebsiteRequestSource,
  WebsiteRequestStatus,
  WebsiteRequestType,
} from "./model";
import type { WebsiteRequestListFilter, WebsiteRequestStore } from "./store";

type Row = Record<string, unknown>;

const COLUMNS = `id, organization_id, request_type, status, source, business_name,
  contact_name, contact_email, contact_phone, current_website_url, focus_areas,
  notes, language, quoted_price_cad, scope_summary, payment_status, review_note,
  notification_status, created_at, updated_at, status_changed_at`;

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
    paymentStatus: (row.payment_status ?? "not_requested") as WebsitePaymentStatus,
    reviewNote: text(row.review_note),
    notificationStatus: text(
      row.notification_status,
    ) as WebsiteNotificationStatus | null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    statusChangedAt: iso(row.status_changed_at),
  };
}

function mapEvent(row: Row): WebsiteRequestEvent {
  return {
    id: String(row.id),
    requestId: String(row.request_id),
    kind: row.kind as WebsiteRequestEvent["kind"],
    actor: text(row.actor),
    fromStatus: text(row.from_status) as WebsiteRequestStatus | null,
    toStatus: text(row.to_status) as WebsiteRequestStatus | null,
    fromPayment: text(row.from_payment) as WebsitePaymentStatus | null,
    toPayment: text(row.to_payment) as WebsitePaymentStatus | null,
    note: text(row.note),
    createdAt: iso(row.created_at),
  };
}

const MAX_LIMIT = 500;
const clamp = (limit: number | undefined, fallback: number) =>
  Math.min(Math.max(Math.trunc(limit ?? fallback), 1), MAX_LIMIT);

/** Builds the shared WHERE clause. Every value is a bound parameter. */
function listWhere(filter: WebsiteRequestListFilter) {
  const params: unknown[] = [];
  const where: string[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filter.status) where.push(`status = ${bind(filter.status)}`);
  if (filter.paymentStatus) {
    where.push(`payment_status = ${bind(filter.paymentStatus)}`);
  }
  if (filter.organizationId) {
    where.push(`organization_id = ${bind(filter.organizationId)}`);
  }
  if (filter.from) where.push(`created_at >= ${bind(filter.from)}::date`);
  if (filter.to) where.push(`created_at < (${bind(filter.to)}::date + 1)`);
  const q = filter.q?.trim();
  if (q) {
    const like = bind(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(
      `(business_name ILIKE ${like} OR contact_name ILIKE ${like} OR contact_email ILIKE ${like})`,
    );
  }
  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

/** Every statement is parameterised. */
export function createPostgresWebsiteRequestStore(
  connectionStringOrPool: string | Pick<Pool, "query">,
): WebsiteRequestStore {
  const db =
    typeof connectionStringOrPool === "string"
      ? getPgPool(connectionStringOrPool)
      : connectionStringOrPool;

  return {
    async create(request, meta) {
      // One statement: the request and its first history line commit together.
      const { rows } = await db.query<Row>(
        `WITH ins AS (
           INSERT INTO tc_website_requests (
             id, organization_id, request_type, status, source, business_name,
             contact_name, contact_email, contact_phone, current_website_url,
             focus_areas, notes, language, quoted_price_cad, scope_summary,
             idempotency_key, created_by_user_id, created_at, updated_at,
             status_changed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
           RETURNING ${COLUMNS}
         ), ev AS (
           INSERT INTO tc_website_request_events
             (id, request_id, kind, actor, to_status, to_payment, created_at)
           SELECT $21, id, 'submitted', 'customer', status, payment_status, created_at FROM ins
         )
         SELECT * FROM ins`,
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
          createId("wse"),
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
      const { clause, params } = listWhere(filter);
      const limit = clamp(filter.limit, 100);
      const offset = Math.max(0, Math.trunc(filter.offset ?? 0));
      const { rows } = await db.query<Row>(
        `SELECT ${COLUMNS} FROM tc_website_requests ${clause}
          ORDER BY created_at DESC, id DESC
          LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      return rows.map(mapRow);
    },

    async countAll(filter = {}) {
      const { clause, params } = listWhere(filter);
      const { rows } = await db.query<Row>(
        `SELECT count(*)::int AS n FROM tc_website_requests ${clause}`,
        params,
      );
      return Number(rows[0]?.n ?? 0);
    },

    async update(id, expectedStatus, patch, at, history = []) {
      // COALESCE keeps a column when the patch leaves it out; the CASE flags let
      // a caller clear the quote by passing an explicit null. The history lines
      // are inserted by the same statement, so a change and its record commit
      // together or not at all.
      const entries = history.slice(0, 4);
      const ids = entries.map(() => createId("wse"));
      const { rows } = await db.query<Row>(
        `WITH before AS (
           SELECT status AS from_status, payment_status AS from_payment
             FROM tc_website_requests WHERE id = $1 AND status = $2
         ), upd AS (
           UPDATE tc_website_requests SET
             status = COALESCE($3, status),
             status_changed_at = CASE WHEN $3 IS NOT NULL AND $3 <> status THEN $6::timestamptz ELSE status_changed_at END,
             quoted_price_cad = CASE WHEN $7 THEN $4::numeric ELSE quoted_price_cad END,
             scope_summary = CASE WHEN $8 THEN $5 ELSE scope_summary END,
             payment_status = COALESCE($9, payment_status),
             review_note = CASE WHEN $10 THEN $11 ELSE review_note END,
             updated_at = $6::timestamptz
           WHERE id = $1 AND status = $2
           RETURNING ${COLUMNS}
         ), ev AS (
           INSERT INTO tc_website_request_events
             (id, request_id, kind, actor, from_status, to_status, from_payment, to_payment, note, created_at)
           SELECT e.id, $1, e.kind, e.actor, before.from_status, upd.status,
                  before.from_payment, upd.payment_status, e.note, $6::timestamptz
             FROM upd, before,
                  unnest($12::text[], $13::text[], $14::text[], $15::text[]) AS e(id, kind, actor, note)
         )
         SELECT * FROM upd`,
        [
          id,
          expectedStatus,
          patch.status ?? null,
          patch.quotedPriceCad ?? null,
          patch.scopeSummary ?? null,
          at,
          patch.quotedPriceCad !== undefined,
          patch.scopeSummary !== undefined,
          patch.paymentStatus ?? null,
          patch.reviewNote !== undefined,
          patch.reviewNote ?? null,
          ids,
          entries.map((e) => e.kind),
          entries.map((e) => e.actor),
          entries.map((e) => e.note),
        ],
      );
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async recordNotification(id, status, at) {
      await db.query(
        `WITH upd AS (
           UPDATE tc_website_requests SET notification_status = $2 WHERE id = $1 RETURNING id
         )
         INSERT INTO tc_website_request_events (id, request_id, kind, note, created_at)
         SELECT $3, id, 'notified', $2, $4::timestamptz FROM upd`,
        [id, status, createId("wse"), at],
      );
    },

    async listEvents(requestId) {
      const { rows } = await db.query<Row>(
        `SELECT id, request_id, kind, actor, from_status, to_status,
                from_payment, to_payment, note, created_at
           FROM tc_website_request_events
          WHERE request_id = $1
          ORDER BY seq ASC`,
        [requestId],
      );
      return rows.map(mapEvent);
    },
  };
}
