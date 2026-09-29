import { Pool } from "pg";
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
    pool = new Pool({ connectionString: url, max: 5 });
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
      const c = columns(session);
      const res = await pool.query(
        `UPDATE rc_call_sessions SET
           status = $6, outcome = $7, ended_at = $9, finalized_at = $10,
           transcript_purged_at = $11, data = $12::jsonb, updated_at = $13,
           version = version + 1
         WHERE id = $1 AND version = $14
         RETURNING *`,
        [...c, session.version],
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
