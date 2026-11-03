import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type SmsInboxMessage = {
  id: string;
  organizationId: string;
  clientId: string;
  fromE164: string;
  toE164: string;
  params: Record<string, string>;
};
export type SmsInboxJob = SmsInboxMessage & {
  token: string;
  attempts: number;
};
export type SmsInbox = {
  enqueue(message: SmsInboxMessage): Promise<void>;
  claim(id?: string): Promise<SmsInboxJob | null>;
  finish(job: SmsInboxJob, error?: string): Promise<void>;
  purge(): Promise<void>;
};
const LEASE_MS = 120_000;
const MAX_ATTEMPTS = 5;

export function createPostgresSmsInbox(db: Pool): SmsInbox {
  return {
    async enqueue(m) {
      await db.query(
        `INSERT INTO mc_sms_inbox (id, organization_id, client_id, from_e164, to_e164, params)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (id) DO NOTHING`,
        [
          m.id,
          m.organizationId,
          m.clientId,
          m.fromE164,
          m.toE164,
          JSON.stringify(m.params),
        ],
      );
    },
    async claim(id) {
      const token = randomUUID();
      // Only the oldest unfinished message in a conversation is eligible. A
      // second invocation cannot skip its locked row and process a follow-up.
      const result = await db.query(
        `UPDATE mc_sms_inbox AS j SET state='processing', lease_token=$2,
           lease_until=now()+($3::int * interval '1 millisecond'),
           attempts=j.attempts+1, updated_at=now()
         FROM (SELECT q.id FROM mc_sms_inbox q
           WHERE ($1::text IS NULL OR q.id=$1) AND q.available_at <= now()
             AND (q.state='pending' OR (q.state='processing' AND q.lease_until < now()))
             AND NOT EXISTS (SELECT 1 FROM mc_sms_inbox older
               WHERE older.organization_id=q.organization_id AND older.from_e164=q.from_e164
                 AND older.to_e164=q.to_e164 AND older.sequence < q.sequence
                 AND older.state IN ('pending','processing'))
           ORDER BY q.sequence FOR UPDATE OF q SKIP LOCKED LIMIT 1) picked
         WHERE j.id=picked.id RETURNING j.*`,
        [id ?? null, token, LEASE_MS],
      );
      const row = result.rows[0];
      return row
        ? {
            id: row.id,
            organizationId: row.organization_id,
            clientId: row.client_id,
            fromE164: row.from_e164,
            toE164: row.to_e164,
            params: row.params,
            token,
            attempts: row.attempts,
          }
        : null;
    },
    async finish(job, error) {
      await db.query(
        `UPDATE mc_sms_inbox SET state=$3, last_error=$4,
           available_at=now()+interval '1 minute', lease_token=NULL, lease_until=NULL,
           params=CASE WHEN $3 = 'done' THEN '{}'::jsonb ELSE params END,
           updated_at=now() WHERE id=$1 AND lease_token=$2`,
        [
          job.id,
          job.token,
          error ? (job.attempts >= MAX_ATTEMPTS ? "dead" : "pending") : "done",
          error ?? null,
        ],
      );
    },
    async purge() {
      await db.query(
        `DELETE FROM mc_sms_inbox WHERE state IN ('done','dead') AND updated_at < now()-interval '30 days'`,
      );
    },
  };
}

/** Tests/local development only; production refuses the memory store. */
export function createMemorySmsInbox(now = Date.now): SmsInbox {
  const rows = new Map<
    string,
    SmsInboxMessage & {
      state: string;
      attempts: number;
      available: number;
      lease: number;
      token: string;
    }
  >();
  return {
    async enqueue(message) {
      if (!rows.has(message.id))
        rows.set(message.id, {
          ...structuredClone(message),
          state: "pending",
          attempts: 0,
          available: now(),
          lease: 0,
          token: "",
        });
    },
    async claim(id) {
      const all = [...rows.values()];
      const row = all.find(
        (r, i) =>
          (!id || r.id === id) &&
          r.available <= now() &&
          (r.state === "pending" ||
            (r.state === "processing" && r.lease < now())) &&
          !all
            .slice(0, i)
            .some(
              (p) =>
                p.organizationId === r.organizationId &&
                p.fromE164 === r.fromE164 &&
                p.toE164 === r.toE164 &&
                ["pending", "processing"].includes(p.state),
            ),
      );
      if (!row) return null;
      row.state = "processing";
      row.attempts++;
      row.token = randomUUID();
      row.lease = now() + LEASE_MS;
      return structuredClone(row);
    },
    async finish(job, error) {
      const row = rows.get(job.id);
      if (!row || row.token !== job.token) return;
      row.state = error
        ? job.attempts >= MAX_ATTEMPTS
          ? "dead"
          : "pending"
        : "done";
      row.available = now() + 60_000;
      row.token = "";
    },
    async purge() {},
  };
}

export async function drainSmsInbox(
  inbox: SmsInbox,
  process: (job: SmsInboxJob) => Promise<void>,
  options: { id?: string; budgetMs?: number } = {},
) {
  const started = Date.now();
  let processed = 0;
  let failed = 0;
  // Bound background work; the minute cron resumes anything left queued.
  while (
    processed + failed < 5 &&
    Date.now() - started < (options.budgetMs ?? 20_000)
  ) {
    const job = await inbox.claim(options.id);
    if (!job) break;
    try {
      if (job.attempts > MAX_ATTEMPTS)
        throw new Error("Inbox retry budget exhausted");
      await process(job);
      await inbox.finish(job);
      processed++;
    } catch (error) {
      const code = error instanceof Error ? error.name : "Error";
      await inbox.finish(job, code);
      failed++;
      console.warn(
        JSON.stringify({
          event: "tradecatch.sms.inbox_failed",
          messageSid: job.id,
          organizationId: job.organizationId,
          attempts: job.attempts,
          terminal: job.attempts >= MAX_ATTEMPTS,
          code,
        }),
      );
    }
    if (options.id) break;
  }
  return { processed, failed };
}
