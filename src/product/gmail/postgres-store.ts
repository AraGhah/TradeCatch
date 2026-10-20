import { createId } from "@/lib/id";
import { getPgPool } from "@/product/missed-call/postgres-store";
import { gmailReplyEvent } from "./notifications";
import { clampLimit, type GmailAccountPatch, type GmailStore } from "./store";
import type {
  GmailAccount,
  GmailAttachment,
  GmailMessage,
  GmailMessageSummary,
} from "./types";

const iso = (value: unknown) =>
  value ? new Date(String(value)).toISOString() : null;

function accountFrom(row: Record<string, unknown>): GmailAccount {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    userId: String(row.user_id),
    email: row.email ? String(row.email) : null,
    status: row.status as GmailAccount["status"],
    tokenCiphertext: row.token_ciphertext ? String(row.token_ciphertext) : null,
    historyId: row.history_id ? String(row.history_id) : null,
    watchExpiration: iso(row.watch_expiration),
    lastSyncAt: iso(row.last_sync_at),
    lastAttemptAt: iso(row.last_attempt_at),
    nextSyncAt: iso(row.next_sync_at),
    failureCount: Number(row.failure_count || 0),
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function summaryFrom(row: Record<string, unknown>): GmailMessageSummary {
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    fromName: row.from_name ? String(row.from_name) : null,
    fromEmail: String(row.from_email),
    subject: String(row.subject),
    snippet: String(row.snippet),
    receivedAt: iso(row.received_at)!,
    unread: Boolean(row.unread),
    hasAttachments: Boolean(row.has_attachments),
    important: Boolean(row.important),
    direction: row.direction === "outbound" ? "outbound" : "inbound",
  };
}

function messageFrom(row: Record<string, unknown>): GmailMessage {
  const attachments = Array.isArray(row.attachments)
    ? (row.attachments as GmailAttachment[])
    : [];
  return {
    ...summaryFrom(row),
    organizationId: String(row.organization_id),
    userId: String(row.user_id),
    accountId: String(row.account_id),
    gmailId: String(row.gmail_id),
    bodyText: row.body_text ? String(row.body_text) : null,
    attachments,
    createdAt: iso(row.created_at)!,
  };
}

/** Column names are fixed here, never taken from the patch keys. */
const PATCH_COLUMNS: Record<keyof GmailAccountPatch, string> = {
  email: "email",
  status: "status",
  tokenCiphertext: "token_ciphertext",
  historyId: "history_id",
  watchExpiration: "watch_expiration",
  lastSyncAt: "last_sync_at",
  lastAttemptAt: "last_attempt_at",
  nextSyncAt: "next_sync_at",
  failureCount: "failure_count",
  lastError: "last_error",
};

const SUMMARY_COLUMNS =
  "id, thread_id, from_name, from_email, subject, snippet, received_at, unread, has_attachments, important, direction";

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * The schema is applied by `npm run db:schema` (migration 019_gmail), like
 * every other store. Nothing here reads files, so it also runs on the Worker.
 */
export function createPostgresGmailStore(connectionString: string): GmailStore {
  const pool = getPgPool(connectionString);

  return {
    async getAccount(organizationId, userId) {
      const result = await pool.query(
        `SELECT * FROM tc_gmail_accounts WHERE organization_id = $1 AND user_id = $2`,
        [organizationId, userId],
      );
      return result.rows[0] ? accountFrom(result.rows[0]) : null;
    },
    async findAccountsByEmail(email) {
      const result = await pool.query(
        `SELECT * FROM tc_gmail_accounts WHERE lower(email) = lower($1) AND status = 'connected'`,
        [email],
      );
      return result.rows.map(accountFrom);
    },
    async listAccountsDue({ nowIso, staleBeforeIso, limit }) {
      const result = await pool.query(
        `SELECT * FROM tc_gmail_accounts
         WHERE status = 'connected' AND token_ciphertext IS NOT NULL
           AND (next_sync_at IS NULL OR next_sync_at <= $1)
           AND (last_attempt_at IS NULL OR last_attempt_at <= $2)
           AND (sync_lease_until IS NULL OR sync_lease_until <= $1)
         ORDER BY last_attempt_at ASC NULLS FIRST
         LIMIT $3`,
        [nowIso, staleBeforeIso, limit],
      );
      return result.rows.map(accountFrom);
    },
    async saveAccount(row) {
      await pool.query(
        `INSERT INTO tc_gmail_accounts (
           id, organization_id, user_id, email, status, token_ciphertext, history_id,
           watch_expiration, last_sync_at, last_attempt_at, next_sync_at, failure_count,
           last_error, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (organization_id, user_id) DO UPDATE SET
           email = EXCLUDED.email,
           status = EXCLUDED.status,
           token_ciphertext = EXCLUDED.token_ciphertext,
           history_id = EXCLUDED.history_id,
           watch_expiration = EXCLUDED.watch_expiration,
           last_sync_at = EXCLUDED.last_sync_at,
           last_attempt_at = EXCLUDED.last_attempt_at,
           next_sync_at = EXCLUDED.next_sync_at,
           failure_count = EXCLUDED.failure_count,
           last_error = EXCLUDED.last_error,
           sync_lease_until = NULL,
           updated_at = EXCLUDED.updated_at`,
        [
          row.id,
          row.organizationId,
          row.userId,
          row.email,
          row.status,
          row.tokenCiphertext,
          row.historyId,
          row.watchExpiration,
          row.lastSyncAt,
          row.lastAttemptAt,
          row.nextSyncAt,
          row.failureCount,
          row.lastError,
          row.createdAt,
          row.updatedAt,
        ],
      );
    },
    async updateAccount(id, patch) {
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const key of Object.keys(
        PATCH_COLUMNS,
      ) as (keyof GmailAccountPatch)[]) {
        if (!(key in patch)) continue;
        params.push(patch[key] ?? null);
        sets.push(`${PATCH_COLUMNS[key]} = $${params.length}`);
      }
      params.push(new Date().toISOString());
      sets.push(`updated_at = $${params.length}`);
      const result = await pool.query(
        `UPDATE tc_gmail_accounts SET ${sets.join(", ")} WHERE id = $1`,
        params,
      );
      return (result.rowCount ?? 0) > 0;
    },
    async deleteAccount(organizationId, userId) {
      await pool.query(
        `DELETE FROM tc_gmail_accounts WHERE organization_id = $1 AND user_id = $2`,
        [organizationId, userId],
      );
    },
    async clearMessages(accountId) {
      await pool.query(`DELETE FROM tc_gmail_messages WHERE account_id = $1`, [
        accountId,
      ]);
    },
    async tryBeginSync(accountId, now, leaseMs) {
      const result = await pool.query(
        `UPDATE tc_gmail_accounts SET sync_lease_until = $3
         WHERE id = $1 AND (sync_lease_until IS NULL OR sync_lease_until <= $2)`,
        [
          accountId,
          now.toISOString(),
          new Date(now.getTime() + leaseMs).toISOString(),
        ],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async endSync(accountId) {
      await pool.query(
        `UPDATE tc_gmail_accounts SET sync_lease_until = NULL WHERE id = $1`,
        [accountId],
      );
    },

    async upsertMessage(row, queueReplyAlert) {
      const id = row.id || createId("gml");
      const at = new Date().toISOString();
      const event = gmailReplyEvent({ ...row, id, createdAt: at });
      const result = await pool.query(
        `WITH saved AS (
         INSERT INTO tc_gmail_messages (
           id, organization_id, user_id, account_id, gmail_id, thread_id, from_name, from_email,
           subject, snippet, body_text, received_at, unread, has_attachments, attachments,
           important, direction, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18)
         ON CONFLICT (account_id, gmail_id) DO UPDATE SET
           subject = EXCLUDED.subject,
           snippet = EXCLUDED.snippet,
           body_text = COALESCE(EXCLUDED.body_text, tc_gmail_messages.body_text),
           has_attachments = EXCLUDED.has_attachments,
           attachments = EXCLUDED.attachments
         RETURNING *, (xmax = 0) AS inserted
         ), queued AS (
           INSERT INTO tc_outbox_events (id,organization_id,idempotency_key,type,payload_json,status,attempts,created_at,updated_at)
           SELECT $19,organization_id,$20,'gmail_reply',$21::jsonb,'pending',0,$18,$18 FROM saved
           WHERE inserted AND $22::boolean
           ON CONFLICT (organization_id,idempotency_key) DO NOTHING
         ) SELECT * FROM saved`,
        [
          id,
          row.organizationId,
          row.userId,
          row.accountId,
          row.gmailId,
          row.threadId,
          row.fromName,
          row.fromEmail,
          row.subject,
          row.snippet,
          row.bodyText,
          row.receivedAt,
          row.unread,
          row.hasAttachments,
          JSON.stringify(row.attachments),
          row.important,
          row.direction,
          at,
          event.id,
          event.idempotencyKey,
          JSON.stringify(event.payload),
          Boolean(queueReplyAlert),
        ],
      );
      const saved = result.rows[0] as Record<string, unknown>;
      return { message: messageFrom(saved), inserted: Boolean(saved.inserted) };
    },
    async existingGmailIds(accountId, gmailIds) {
      if (gmailIds.length === 0) return new Set();
      const result = await pool.query(
        `SELECT gmail_id FROM tc_gmail_messages WHERE account_id = $1 AND gmail_id = ANY($2::text[])`,
        [accountId, gmailIds],
      );
      return new Set(result.rows.map((row) => String(row.gmail_id)));
    },
    async threadKnown(accountId, threadId) {
      const result = await pool.query(
        `SELECT 1 FROM tc_gmail_messages WHERE account_id = $1 AND thread_id = $2 LIMIT 1`,
        [accountId, threadId],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async setUnreadByGmailId(accountId, gmailId, unread) {
      await pool.query(
        `UPDATE tc_gmail_messages SET unread = $3
         WHERE account_id = $1 AND gmail_id = $2 AND direction = 'inbound'`,
        [accountId, gmailId, unread],
      );
    },
    async deleteByGmailIds(accountId, gmailIds) {
      if (gmailIds.length === 0) return;
      await pool.query(
        `DELETE FROM tc_gmail_messages WHERE account_id = $1 AND gmail_id = ANY($2::text[])`,
        [accountId, gmailIds],
      );
    },

    async listMessages(organizationId, userId, filter) {
      const params: unknown[] = [organizationId, userId];
      let sql = `SELECT ${SUMMARY_COLUMNS} FROM tc_gmail_messages
                 WHERE organization_id = $1 AND user_id = $2 AND direction = 'inbound'`;
      if (filter?.unread) sql += ` AND unread`;
      if (filter?.important) sql += ` AND important`;
      if (filter?.attachments) sql += ` AND has_attachments`;
      const q = filter?.q?.trim();
      if (q) {
        params.push(likePattern(q.slice(0, 200)));
        const n = params.length;
        sql += ` AND (from_email ILIKE $${n} OR from_name ILIKE $${n} OR subject ILIKE $${n}
                      OR snippet ILIKE $${n} OR body_text ILIKE $${n})`;
      }
      if (filter?.before) {
        params.push(filter.before.receivedAt, filter.before.id);
        sql += ` AND (received_at, id) < ($${params.length - 1}::timestamptz, $${params.length})`;
      }
      params.push(clampLimit(filter?.limit));
      sql += ` ORDER BY received_at DESC, id DESC LIMIT $${params.length}`;
      const result = await pool.query(sql, params);
      return result.rows.map(summaryFrom);
    },
    async getMessage(organizationId, userId, id) {
      const result = await pool.query(
        `SELECT * FROM tc_gmail_messages WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
        [id, organizationId, userId],
      );
      return result.rows[0] ? messageFrom(result.rows[0]) : null;
    },
    async listThread(organizationId, userId, threadId) {
      const result = await pool.query(
        `SELECT * FROM tc_gmail_messages
         WHERE organization_id = $1 AND user_id = $2 AND thread_id = $3
         ORDER BY received_at ASC, id ASC`,
        [organizationId, userId, threadId],
      );
      return result.rows.map(messageFrom);
    },
    async countUnread(organizationId, userId) {
      const result = await pool.query(
        `SELECT count(*)::int AS n FROM tc_gmail_messages
         WHERE organization_id = $1 AND user_id = $2 AND unread AND direction = 'inbound'`,
        [organizationId, userId],
      );
      return Number(result.rows[0]?.n || 0);
    },
    async setRead(organizationId, userId, id, read) {
      const result = await pool.query(
        `UPDATE tc_gmail_messages SET unread = $4
         WHERE id = $1 AND organization_id = $2 AND user_id = $3 AND direction = 'inbound'`,
        [id, organizationId, userId, !read],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}
