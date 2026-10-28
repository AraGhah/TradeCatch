/**
 * Append-only call lifecycle events for dashboard timelines and duplicate
 * webhook protection (by callSid + kind + detail fingerprint).
 */

import type { Pool } from "pg";
import { createPostgresPool } from "@/lib/postgres-pool";
import { randomUUID } from "@/lib/id";
import type { CallEvent, CallEventKind } from "./types";

export type CallEventStore = {
  append(
    event: Omit<CallEvent, "id" | "at"> & { at?: string; id?: string },
  ): Promise<CallEvent>;
  listForCall(input: {
    organizationId: string;
    callSid: string;
    limit?: number;
  }): Promise<CallEvent[]>;
  listForOrganization(input: {
    organizationId: string;
    limit?: number;
  }): Promise<CallEvent[]>;
  /** Returns true if an identical event was already recorded recently. */
  seenRecently(input: {
    callSid: string;
    kind: CallEventKind;
    detail?: string;
    withinMs?: number;
  }): Promise<boolean>;
};

function clone<T>(v: T): T {
  return structuredClone(v);
}

export function createMemoryCallEventStore(): CallEventStore {
  const rows: CallEvent[] = [];
  return {
    async append(event) {
      const row: CallEvent = {
        id: event.id ?? `cev_${randomUUID()}`,
        at: event.at ?? new Date().toISOString(),
        organizationId: event.organizationId,
        clientAccountId: event.clientAccountId,
        callSid: event.callSid,
        sessionId: event.sessionId,
        kind: event.kind,
        detail: event.detail,
        payload: event.payload,
      };
      rows.push(row);
      return clone(row);
    },
    async listForCall({ organizationId, callSid, limit = 100 }) {
      return rows
        .filter(
          (r) => r.organizationId === organizationId && r.callSid === callSid,
        )
        .sort((a, b) => a.at.localeCompare(b.at))
        .slice(-limit)
        .map(clone);
    },
    async listForOrganization({ organizationId, limit = 100 }) {
      return rows
        .filter((r) => r.organizationId === organizationId)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit)
        .map(clone);
    },
    async seenRecently({ callSid, kind, detail, withinMs = 60_000 }) {
      const cutoff = Date.now() - withinMs;
      return rows.some(
        (r) =>
          r.callSid === callSid &&
          r.kind === kind &&
          (detail == null || r.detail === detail) &&
          new Date(r.at).getTime() >= cutoff,
      );
    },
  };
}

const pools = new Map<string, Pool>();

function getPool(url: string) {
  let pool = pools.get(url);
  if (!pool) {
    pool = createPostgresPool({ connectionString: url, max: 5 });
    pools.set(url, pool);
  }
  return pool;
}

function mapRow(r: Record<string, unknown>): CallEvent {
  const payload =
    typeof r.payload === "string"
      ? (JSON.parse(r.payload) as Record<string, unknown>)
      : (r.payload as Record<string, unknown> | undefined);
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    clientAccountId: String(r.client_account_id),
    callSid: String(r.call_sid),
    sessionId: (r.session_id as string) || undefined,
    kind: r.kind as CallEventKind,
    detail: (r.detail as string) || undefined,
    payload: payload ?? undefined,
    at: new Date(r.at as string | Date).toISOString(),
  };
}

export function createPostgresCallEventStore(url: string): CallEventStore {
  const pool = getPool(url);
  return {
    async append(event) {
      const id = event.id ?? `cev_${randomUUID()}`;
      const at = event.at ?? new Date().toISOString();
      const res = await pool.query(
        `INSERT INTO rc_call_events
           (id, organization_id, client_account_id, call_sid, session_id, kind, detail, payload, at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
         ON CONFLICT (id) DO UPDATE SET detail = EXCLUDED.detail
         RETURNING *`,
        [
          id,
          event.organizationId,
          event.clientAccountId,
          event.callSid,
          event.sessionId ?? null,
          event.kind,
          event.detail ?? null,
          JSON.stringify(event.payload ?? {}),
          at,
        ],
      );
      return mapRow(res.rows[0]);
    },
    async listForCall({ organizationId, callSid, limit = 100 }) {
      const res = await pool.query(
        `SELECT * FROM rc_call_events
         WHERE organization_id = $1 AND call_sid = $2
         ORDER BY at ASC
         LIMIT $3`,
        [organizationId, callSid, limit],
      );
      return res.rows.map(mapRow);
    },
    async listForOrganization({ organizationId, limit = 100 }) {
      const res = await pool.query(
        `SELECT * FROM rc_call_events
         WHERE organization_id = $1
         ORDER BY at DESC
         LIMIT $2`,
        [organizationId, limit],
      );
      return res.rows.map(mapRow);
    },
    async seenRecently({ callSid, kind, detail, withinMs = 60_000 }) {
      const res = await pool.query(
        `SELECT 1 FROM rc_call_events
         WHERE call_sid = $1 AND kind = $2
           AND ($3::text IS NULL OR detail = $3)
           AND at >= now() - ($4::int * interval '1 millisecond')
         LIMIT 1`,
        [callSid, kind, detail ?? null, withinMs],
      );
      return res.rows.length > 0;
    },
  };
}
