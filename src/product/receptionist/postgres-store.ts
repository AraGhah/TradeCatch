import type { Pool } from "pg";
import { createPostgresPool } from "@/lib/postgres-pool";
import {
  ReceptionistConflictError,
  isConflictError,
  redactSession,
  type ReceptionistStore,
} from "./store";
import type { CallSession } from "./types";

const pools = new Map<string, Pool>();

function getPool(url: string) {
  let pool = pools.get(url);
  if (!pool) {
    pool = createPostgresPool({ connectionString: url, max: 5 });
    pools.set(url, pool);
  }
  return pool;
}

function mapRow(row: Record<string, unknown>): CallSession {
  const data = (
    typeof row.data === "string" ? JSON.parse(row.data) : row.data
  ) as CallSession;
  return { ...data, version: Number(row.version) };
}

function columns(s: CallSession) {
  const { version: _version, ...data } = s;
  void _version;
  return [
    s.id,
    s.callSid,
    s.configId,
    s.clientAccountId,
    s.fromE164,
    s.status,
    s.outcome ?? null,
    s.startedAt,
    s.endedAt ?? null,
    s.finalizedAt ?? null,
    s.transcriptPurgedAt ?? null,
    JSON.stringify(data),
    s.updatedAt,
  ];
}

/** Parameters for the optimistic-concurrency UPDATE, in `$1..$9` order. */
export function updateParams(s: CallSession): unknown[] {
  const { version: _version, ...data } = s;
  void _version;
  return [
    s.id,
    s.status,
    s.outcome ?? null,
    s.endedAt ?? null,
    s.finalizedAt ?? null,
    s.transcriptPurgedAt ?? null,
    JSON.stringify(data),
    s.updatedAt,
    s.version,
  ];
}

export function createPostgresReceptionistStore(
  url: string,
): ReceptionistStore {
  const pool = getPool(url);

  const store: ReceptionistStore = {
    async insertSessionIfAbsent(session) {
      const res = await pool.query(
        `INSERT INTO rc_call_sessions
           (id, call_sid, config_id, client_account_id, from_e164, status, outcome,
            started_at, ended_at, finalized_at, transcript_purged_at, data, updated_at, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,1)
         ON CONFLICT (call_sid) DO NOTHING
         RETURNING *`,
        columns(session),
      );
      if (res.rows[0]) return { session: mapRow(res.rows[0]), created: true };
      const existing = await pool.query(
        `SELECT * FROM rc_call_sessions WHERE call_sid = $1`,
        [session.callSid],
      );
      return { session: mapRow(existing.rows[0]), created: false };
    },

    async getSession(id) {
      const res = await pool.query(
        `SELECT * FROM rc_call_sessions WHERE id = $1`,
        [id],
      );
      return res.rows[0] ? mapRow(res.rows[0]) : null;
    },

    async getSessionByCallSid(callSid) {
      const res = await pool.query(
        `SELECT * FROM rc_call_sessions WHERE call_sid = $1`,
        [callSid],
      );
      return res.rows[0] ? mapRow(res.rows[0]) : null;
    },

    async saveSession(session) {
      // Bind exactly the values the statement references. Postgres rejects a
      // prepared statement that skips a parameter number (42P18 "could not
      // determine data type of parameter $2"), which is what happened when the
      // immutable columns (call_sid, config_id, ...) were bound but not used.
      const res = await pool.query(
        `UPDATE rc_call_sessions SET
           status = $2, outcome = $3, ended_at = $4, finalized_at = $5,
           transcript_purged_at = $6, data = $7::jsonb, updated_at = $8,
           version = version + 1
         WHERE id = $1 AND version = $9
         RETURNING *`,
        updateParams(session),
      );
      if (!res.rows[0]) throw new ReceptionistConflictError(session.id);
      return mapRow(res.rows[0]);
    },

    async listSessions({ clientAccountId, limit = 100 }) {
      const res = clientAccountId
        ? await pool.query(
            `SELECT * FROM rc_call_sessions WHERE client_account_id = $1
             ORDER BY started_at DESC LIMIT $2`,
            [clientAccountId, limit],
          )
        : await pool.query(
            `SELECT * FROM rc_call_sessions ORDER BY started_at DESC LIMIT $1`,
            [limit],
          );
      return res.rows.map(mapRow);
    },

    async listStaleUnfinalized(beforeIso, limit) {
      const res = await pool.query(
        `SELECT * FROM rc_call_sessions
         WHERE finalized_at IS NULL AND updated_at < $1
         ORDER BY updated_at ASC LIMIT $2`,
        [beforeIso, limit],
      );
      return res.rows.map(mapRow);
    },

    async listWithRetryableNotifications(sinceIso, limit) {
      const res = await pool.query(
        `SELECT * FROM rc_call_sessions
         WHERE finalized_at IS NOT NULL AND finalized_at >= $1
           AND jsonb_typeof(data->'notifications') = 'array'
           AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(data->'notifications') n
             WHERE n->>'ok' = 'false' AND n->>'retryable' = 'true')
         ORDER BY finalized_at ASC LIMIT $2`,
        [sinceIso, limit],
      );
      return res.rows.map(mapRow);
    },

    async purgeTranscripts(configId, beforeIso) {
      const res = await pool.query(
        `SELECT * FROM rc_call_sessions
         WHERE config_id = $1 AND finalized_at IS NOT NULL
           AND transcript_purged_at IS NULL
           AND COALESCE(ended_at, updated_at) < $2
         LIMIT 500`,
        [configId, beforeIso],
      );
      const now = new Date().toISOString();
      let count = 0;
      for (const row of res.rows) {
        const redacted = redactSession(mapRow(row), now);
        try {
          await store.saveSession(redacted);
          count += 1;
        } catch (err) {
          if (!isConflictError(err)) throw err;
        }
      }
      return count;
    },
  };
  return store;
}
