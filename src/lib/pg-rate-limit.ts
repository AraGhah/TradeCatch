import { createHash } from "node:crypto";

/**
 * Fixed-window counters kept in Postgres so every server instance (every
 * Worker isolate, every serverless function) shares the same budget. Used when
 * Upstash is not configured; the app already depends on this database, so no
 * new service is required.
 *
 * One atomic upsert per call: concurrent requests are serialized by the row
 * lock, so N parallel callers against a limit of L see exactly L allowed.
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

/** The slice of `pg.Pool` this module needs, so tests can supply any runner. */
export type SqlRunner = {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
};

const MAX_KEY_LENGTH = 128;

/** Caller-influenced keys (e-mail addresses, IDs) must not grow the index without bound. */
export function storageKey(key: string): string {
  if (key.length <= MAX_KEY_LENGTH) return key;
  return `h:${createHash("sha256").update(key).digest("hex")}`;
}

export async function pgRateLimit(
  db: SqlRunner,
  input: { key: string; limit: number; windowMs: number },
): Promise<RateLimitResult> {
  const windowMs = Math.max(1, Math.floor(input.windowMs));
  const res = await db.query(
    `INSERT INTO tc_rate_limits AS r (key, count, reset_at)
     VALUES ($1, 1, now() + ($2::bigint * interval '1 millisecond'))
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN r.reset_at <= now() THEN 1 ELSE r.count + 1 END,
       reset_at = CASE WHEN r.reset_at <= now()
                       THEN now() + ($2::bigint * interval '1 millisecond')
                       ELSE r.reset_at END
     RETURNING count, (extract(epoch FROM reset_at) * 1000)::bigint AS reset_ms`,
    [storageKey(input.key), windowMs],
  );
  const row = res.rows[0];
  if (!row) throw new Error("rate limit upsert returned no row");
  const count = Number(row.count);
  return {
    allowed: count <= input.limit,
    remaining: Math.max(0, input.limit - count),
    resetAt: Number(row.reset_ms),
  };
}

/** Drops windows that ended more than an hour ago. Best effort; safe to run anytime. */
export async function pgRateLimitSweep(db: SqlRunner): Promise<void> {
  await db.query(
    `DELETE FROM tc_rate_limits WHERE reset_at < now() - interval '1 hour'`,
  );
}
