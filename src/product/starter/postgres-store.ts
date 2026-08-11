import { Pool } from "pg";
import type { StarterStore } from "./memory-store";
import type {
  InboxItem,
  QuoteMessage,
  QuoteThread,
  WebsiteLead,
} from "./types";
import { createId } from "./types";

const pools = new Map<string, Pool>();

function getPool(url: string) {
  let pool = pools.get(url);
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 5 });
    pools.set(url, pool);
  }
  return pool;
}

function mapWebsite(row: Record<string, unknown>): WebsiteLead {
  const payload =
    row.payload && typeof row.payload === "object"
      ? (row.payload as Record<string, unknown>)
      : {};
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    source: "website",
    name: (row.name as string) || undefined,
    email: (row.email as string) || undefined,
    phoneE164: (row.phone_e164 as string) || undefined,
    message: (row.message as string) || undefined,
    serviceRequested: (row.service_requested as string) || undefined,
    sourceUrl: (row.source_url as string) || undefined,
    status: row.status as WebsiteLead["status"],
    conversationMode: row.conversation_mode as WebsiteLead["conversationMode"],
    idempotencyKey: (row.idempotency_key as string) || undefined,
    consentAt: row.consent_at
      ? new Date(row.consent_at as string | Date).toISOString()
      : undefined,
    consentWording: (row.consent_wording as string) || undefined,
    openingSmsSent: Boolean(row.opening_sms_sent),
    qualificationStepIndex:
      typeof payload.qualificationStepIndex === "number"
        ? payload.qualificationStepIndex
        : undefined,
    qualificationAnswers:
      payload.qualificationAnswers &&
      typeof payload.qualificationAnswers === "object"
        ? (payload.qualificationAnswers as Record<string, string>)
        : undefined,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
  };
}

function mapQuote(row: Record<string, unknown>): QuoteThread {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    clientAccountId: (row.client_account_id as string) || undefined,
    customerPhoneE164: String(row.customer_phone_e164),
    customerName: (row.customer_name as string) || undefined,
    quoteRef: (row.quote_ref as string) || undefined,
    quoteAmount:
      row.quote_amount == null ? undefined : Number(row.quote_amount),
    quoteSentAt: new Date(row.quote_sent_at as string | Date).toISOString(),
    locale: row.locale === "fr" ? "fr" : "en",
    status: row.status as QuoteThread["status"],
    stopReason: (row.stop_reason as QuoteThread["stopReason"]) || undefined,
    conversationMode: row.conversation_mode as QuoteThread["conversationMode"],
    nextStepIndex: Number(row.next_step_index ?? 0),
    nextRunAt: row.next_run_at
      ? new Date(row.next_run_at as string | Date).toISOString()
      : undefined,
    attempts: Number(row.attempts ?? 0),
    lastCustomerReplyAt: row.last_customer_reply_at
      ? new Date(row.last_customer_reply_at as string | Date).toISOString()
      : undefined,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
  };
}

function mapInbox(row: Record<string, unknown>): InboxItem {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    kind: row.kind as InboxItem["kind"],
    refId: String(row.ref_id),
    title: String(row.title),
    reason: String(row.reason),
    status: row.status as InboxItem["status"],
    claimedByUserId: (row.claimed_by_user_id as string) || undefined,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
  };
}

export function createPostgresStarterStore(connectionString: string): StarterStore {
  const pool = getPool(connectionString);

  return {
    async createWebsiteLead(input) {
      if (input.idempotencyKey) {
        const existing = await pool.query(
          `SELECT * FROM tc_website_leads
           WHERE organization_id = $1 AND idempotency_key = $2`,
          [input.organizationId, input.idempotencyKey],
        );
        if (existing.rows[0]) return mapWebsite(existing.rows[0]);
      }
      const id = input.id ?? createId("wlead");
      const { rows } = await pool.query(
        `INSERT INTO tc_website_leads (
           id, organization_id, source, name, email, phone_e164, message,
           service_requested, source_url, status, conversation_mode,
           idempotency_key, consent_at, consent_wording, opening_sms_sent
         ) VALUES ($1,$2,'website',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          id,
          input.organizationId,
          input.name ?? null,
          input.email ?? null,
          input.phoneE164 ?? null,
          input.message ?? null,
          input.serviceRequested ?? null,
          input.sourceUrl ?? null,
          input.status ?? "new",
          input.conversationMode ?? "auto",
          input.idempotencyKey ?? null,
          input.consentAt ?? null,
          input.consentWording ?? null,
          input.openingSmsSent ?? false,
        ],
      );
      return mapWebsite(rows[0]);
    },

    async getWebsiteLead(id, organizationId) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_website_leads WHERE id = $1 AND organization_id = $2`,
        [id, organizationId],
      );
      return rows[0] ? mapWebsite(rows[0]) : null;
    },

    async listWebsiteLeads(organizationId) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_website_leads
         WHERE organization_id = $1
         ORDER BY created_at DESC`,
        [organizationId],
      );
      return rows.map(mapWebsite);
    },

    async updateWebsiteLead(id, organizationId, patch) {
      const current = await this.getWebsiteLead(id, organizationId);
      if (!current) return null;
      const next = { ...current, ...patch };
      const { rows } = await pool.query(
        `UPDATE tc_website_leads SET
           status = $3, conversation_mode = $4, opening_sms_sent = $5,
           name = $6, message = $7, service_requested = $8,
           payload = COALESCE(payload, '{}'::jsonb) || $9::jsonb,
           updated_at = now()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [
          id,
          organizationId,
          next.status,
          next.conversationMode,
          next.openingSmsSent,
          next.name ?? null,
          next.message ?? null,
          next.serviceRequested ?? null,
          JSON.stringify({
            qualificationStepIndex: next.qualificationStepIndex ?? null,
            qualificationAnswers: next.qualificationAnswers ?? {},
          }),
        ],
      );
      return rows[0] ? mapWebsite(rows[0]) : null;
    },

    async createQuoteThread(thread) {
      const { rows } = await pool.query(
        `INSERT INTO tc_quote_threads (
           id, organization_id, client_account_id, customer_phone_e164,
           customer_name, quote_ref, quote_amount, quote_sent_at, locale,
           status, stop_reason, conversation_mode, next_step_index,
           next_run_at, attempts, last_customer_reply_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING *`,
        [
          thread.id,
          thread.organizationId,
          thread.clientAccountId ?? null,
          thread.customerPhoneE164,
          thread.customerName ?? null,
          thread.quoteRef ?? null,
          thread.quoteAmount ?? null,
          thread.quoteSentAt,
          thread.locale,
          thread.status,
          thread.stopReason ?? null,
          thread.conversationMode,
          thread.nextStepIndex,
          thread.nextRunAt ?? null,
          thread.attempts,
          thread.lastCustomerReplyAt ?? null,
          thread.createdAt,
          thread.updatedAt,
        ],
      );
      return mapQuote(rows[0]);
    },

    async getQuoteThread(id, organizationId) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_quote_threads WHERE id = $1 AND organization_id = $2`,
        [id, organizationId],
      );
      return rows[0] ? mapQuote(rows[0]) : null;
    },

    async listQuoteThreads(organizationId) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_quote_threads
         WHERE organization_id = $1
         ORDER BY created_at DESC`,
        [organizationId],
      );
      return rows.map(mapQuote);
    },

    async findActiveQuoteByPhone(organizationId, phoneE164) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_quote_threads
         WHERE organization_id = $1
           AND status = 'active'
           AND regexp_replace(customer_phone_e164, '[^0-9+]', '', 'g')
             = regexp_replace($2, '[^0-9+]', '', 'g')
         LIMIT 1`,
        [organizationId, phoneE164],
      );
      return rows[0] ? mapQuote(rows[0]) : null;
    },

    async updateQuoteThread(id, organizationId, patch) {
      const current = await this.getQuoteThread(id, organizationId);
      if (!current) return null;
      const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
      const { rows } = await pool.query(
        `UPDATE tc_quote_threads SET
           status = $3, stop_reason = $4, conversation_mode = $5,
           next_step_index = $6, next_run_at = $7, attempts = $8,
           last_customer_reply_at = $9, updated_at = now()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [
          id,
          organizationId,
          next.status,
          next.stopReason ?? null,
          next.conversationMode,
          next.nextStepIndex,
          next.nextRunAt ?? null,
          next.attempts,
          next.lastCustomerReplyAt ?? null,
        ],
      );
      return rows[0] ? mapQuote(rows[0]) : null;
    },

    async listDueQuoteThreads(nowIso, limit) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_quote_threads
         WHERE status = 'active'
           AND conversation_mode = 'auto'
           AND next_run_at IS NOT NULL
           AND next_run_at <= $1::timestamptz
         ORDER BY next_run_at ASC
         LIMIT $2`,
        [nowIso, limit],
      );
      return rows.map(mapQuote);
    },

    async addQuoteMessage(message) {
      const { rows } = await pool.query(
        `INSERT INTO tc_quote_messages (thread_id, direction, body, step_index, at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id::text AS id, thread_id, direction, body, step_index, at`,
        [
          message.threadId,
          message.direction,
          message.body,
          message.stepIndex ?? null,
          message.at,
        ],
      );
      const row = rows[0];
      return {
        id: String(row.id),
        threadId: String(row.thread_id),
        direction: row.direction,
        body: String(row.body),
        stepIndex: row.step_index == null ? undefined : Number(row.step_index),
        at: new Date(row.at).toISOString(),
      } satisfies QuoteMessage;
    },

    async listQuoteMessages(threadId) {
      const { rows } = await pool.query(
        `SELECT id::text AS id, thread_id, direction, body, step_index, at
         FROM tc_quote_messages WHERE thread_id = $1 ORDER BY at ASC`,
        [threadId],
      );
      return rows.map((row) => ({
        id: String(row.id),
        threadId: String(row.thread_id),
        direction: row.direction,
        body: String(row.body),
        stepIndex: row.step_index == null ? undefined : Number(row.step_index),
        at: new Date(row.at).toISOString(),
      }));
    },

    async upsertInboxItem(input) {
      const { rows } = await pool.query(
        `INSERT INTO tc_inbox_items (
           id, organization_id, kind, ref_id, title, reason, status, claimed_by_user_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (organization_id, kind, ref_id) DO UPDATE SET
           title = EXCLUDED.title,
           reason = EXCLUDED.reason,
           status = COALESCE(EXCLUDED.status, tc_inbox_items.status),
           claimed_by_user_id = COALESCE(EXCLUDED.claimed_by_user_id, tc_inbox_items.claimed_by_user_id),
           updated_at = now()
         RETURNING *`,
        [
          input.id ?? createId("inbox"),
          input.organizationId,
          input.kind,
          input.refId,
          input.title,
          input.reason,
          input.status ?? "open",
          input.claimedByUserId ?? null,
        ],
      );
      return mapInbox(rows[0]);
    },

    async listInbox(organizationId) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_inbox_items
         WHERE organization_id = $1
         ORDER BY created_at DESC`,
        [organizationId],
      );
      return rows.map(mapInbox);
    },

    async getInboxItem(id, organizationId) {
      const { rows } = await pool.query(
        `SELECT * FROM tc_inbox_items WHERE id = $1 AND organization_id = $2`,
        [id, organizationId],
      );
      return rows[0] ? mapInbox(rows[0]) : null;
    },

    async updateInboxItem(id, organizationId, patch) {
      const current = await this.getInboxItem(id, organizationId);
      if (!current) return null;
      const next = { ...current, ...patch };
      const { rows } = await pool.query(
        `UPDATE tc_inbox_items SET
           status = $3, claimed_by_user_id = $4, reason = $5, title = $6, updated_at = now()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [
          id,
          organizationId,
          next.status,
          next.claimedByUserId ?? null,
          next.reason,
          next.title,
        ],
      );
      return rows[0] ? mapInbox(rows[0]) : null;
    },

    async createOrgApiKey(input) {
      const id = createId("oak");
      await pool.query(
        `INSERT INTO tc_org_api_keys (id, organization_id, token_hash, label)
         VALUES ($1, $2, $3, $4)`,
        [id, input.organizationId, input.tokenHash, input.label ?? "website"],
      );
      return { id };
    },

    async findOrgIdByApiKeyHash(tokenHash) {
      const { rows } = await pool.query(
        `SELECT organization_id FROM tc_org_api_keys
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [tokenHash],
      );
      return rows[0] ? String(rows[0].organization_id) : null;
    },
  };
}
