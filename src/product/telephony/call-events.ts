/**
 * Append-only call lifecycle events for dashboard timelines and duplicate
 * webhook protection (by callSid + kind + detail fingerprint).
 */

import type { Pool } from "pg";
import { createPostgresPool } from "@/lib/postgres-pool";
import { randomUUID } from "@/lib/id";
import type { CallEvent, CallEventKind } from "./types";

/**
 * A stable id for one lifecycle event of one call. Appending the same event
 * again (a provider retry, a re-run of a save) lands on the same row instead of
 * adding a second one. `part` tells apart events of one kind that may
 * legitimately repeat in a call (for example the step number of a simulation).
 */
export function callEventId(
  callSid: string,
  kind: CallEventKind,
  part?: string | number,
): string {
  return `cev:${callSid}:${kind}${part === undefined ? "" : `:${part}`}`;
}

/**
 * Where each kind sits in a call's life. Events of one call are written in a
 * few milliseconds of each other (the webhook that starts the call records
 * three), so the timestamp alone cannot order them. Ties on `at` are broken by
 * this order, so a timeline always reads "incoming, routing decision, ring,
 * missed, receptionist starts, ... final status" however fast it was written.
 */
export const CALL_EVENT_ORDER: readonly CallEventKind[] = [
  "test_simulated",
  "incoming",
  "routing_decision",
  "human_ring",
  "missed",
  "ai_started",
  "ai_turn",
  "transfer_attempt",
  "transfer_result",
  "error",
  "relay_ended",
  "status",
  "finalized",
];

function eventRank(kind: CallEventKind): number {
  const rank = CALL_EVENT_ORDER.indexOf(kind);
  return rank === -1 ? CALL_EVENT_ORDER.length : rank;
}

/** Oldest first: time, then the call's lifecycle order, then id. */
function byTimeline(a: CallEvent, b: CallEvent): number {
  return (
    a.at.localeCompare(b.at) ||
    eventRank(a.kind) - eventRank(b.kind) ||
    a.id.localeCompare(b.id)
  );
}

/** True for what a dashboard simulation recorded; never a real phone call. */
export function isSimulatedEvent(
  event: Pick<CallEvent, "callSid" | "payload">,
): boolean {
  return event.callSid.startsWith("sim_") || event.payload?.simulated === true;
}

export type CallEventStore = {
  /**
   * Idempotent by `id`: the same id never makes two rows. Events with no id get
   * a random one and are always new.
   */
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
    /** Only events of this kind (newest first, like the unfiltered list). */
    kind?: CallEventKind;
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
      // Same contract as the database: an id that exists is kept as it was
      // (one business only) and answered again, never stored twice.
      const existing = rows.find((r) => r.id === row.id);
      if (existing) {
        if (existing.organizationId !== row.organizationId) {
          throw new Error("[telephony] event id belongs to another business");
        }
        return clone(existing);
      }
      rows.push(row);
      return clone(row);
    },
    async listForCall({ organizationId, callSid, limit = 100 }) {
      return rows
        .filter(
          (r) => r.organizationId === organizationId && r.callSid === callSid,
        )
        .sort(byTimeline)
        .slice(-limit)
        .map(clone);
    },
    async listForOrganization({ organizationId, limit = 100, kind }) {
      return rows
        .filter(
          (r) =>
            r.organizationId === organizationId && (!kind || r.kind === kind),
        )
        .sort((a, b) => byTimeline(b, a))
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

export function createPostgresCallEventStore(
  url: string,
  /** Tests run the real SQL on an in-process database through this. */
  options: { pool?: Pool } = {},
): CallEventStore {
  const pool = options.pool ?? getPool(url);
  return {
    async append(event) {
      const id = event.id ?? `cev_${randomUUID()}`;
      const at = event.at ?? new Date().toISOString();
      const res = await pool.query(
        `INSERT INTO rc_call_events
           (id, organization_id, client_account_id, call_sid, session_id, kind, detail, payload, at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
         ON CONFLICT (id) DO UPDATE SET detail = EXCLUDED.detail
           WHERE rc_call_events.organization_id = EXCLUDED.organization_id
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
      // No row back means the id exists for a different business: never touch it.
      if (!res.rows[0]) {
        throw new Error("[telephony] event id belongs to another business");
      }
      return mapRow(res.rows[0]);
    },
    async listForCall({ organizationId, callSid, limit = 100 }) {
      const res = await pool.query(
        `SELECT * FROM rc_call_events
         WHERE organization_id = $1 AND call_sid = $2
         ORDER BY at ASC, array_position($4::text[], kind) ASC NULLS LAST, id ASC
         LIMIT $3`,
        [organizationId, callSid, limit, CALL_EVENT_ORDER],
      );
      return res.rows.map(mapRow);
    },
    async listForOrganization({ organizationId, limit = 100, kind }) {
      const res = await pool.query(
        `SELECT * FROM rc_call_events
         WHERE organization_id = $1
           AND ($3::text IS NULL OR kind = $3)
         ORDER BY at DESC, array_position($4::text[], kind) DESC NULLS FIRST, id DESC
         LIMIT $2`,
        [organizationId, limit, kind ?? null, CALL_EVENT_ORDER],
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
