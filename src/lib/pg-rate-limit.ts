import { createHash } from "node:crypto";
import {
  assertValidSpec,
  type BucketDecision,
  type BucketSpec,
} from "./token-bucket";

/**
 * Token buckets kept in Postgres so every server instance (every Worker
 * isolate, every serverless function) spends from the same bucket. Used when
 * Upstash is not configured; the app already depends on this database, so no
 * new service is required.
 *
 * Storage reuses `tc_rate_limits`, so no migration is needed:
 *   key      `tb:<limit key>`  (the prefix keeps these rows apart from the
 *            fixed-window rows older releases wrote to the same table)
 *   reset_at the moment the bucket is full again. This is the whole bucket
 *            state (see token-bucket.ts), and it makes the sweep exact: a row
 *            whose reset_at has passed is a full bucket, i.e. no row at all.
 *   count    the outcome of the latest request: tokens left, or -1 when it was
 *            refused. Only the statement below reads it, to learn its own
 *            result; it is also handy when looking at the table by hand
 *            (rows at -1 are the keys being throttled right now).
 *
 * One atomic upsert per call. Concurrent requests for a key are serialized by
 * the row lock and each one sees the previous one's result, so N parallel
 * callers against a bucket of L tokens never see more than L allowed (see
 * PG_SLACK_MS for the one way fewer can be). All time comes from the database
 * clock, never from the caller's, so instances with skewed clocks still agree.
 */

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

/**
 * How early, in milliseconds, a token may be handed out. Two things need it:
 *
 *  - Timestamps have microsecond resolution, so a stored deadline can be off by
 *    half a microsecond per request (a bucket of 7 must not refuse its 7th
 *    request over rounding).
 *  - `statement_timestamp()` is taken when a statement *starts*, but concurrent
 *    statements for one key take the row lock in a slightly different order.
 *    One that started a little earlier and locked later credits a sliver less
 *    refill, so in a burst of simultaneous requests the last token could be
 *    refused. That error is always on the safe side (refill is never credited
 *    that was not earned), and a few milliseconds of slack removes it in
 *    practice.
 *
 * It cannot admit an extra request: that would need the slack to be a whole
 * refill interval, and the shortest one in rate-limit-policy.ts is 100 ms, so
 * the effective capacity is at most capacity + 5/100 of a token. Exactly
 * `capacity` of N simultaneous requests are allowed except in pathological
 * scheduling, where the last one may be refused; never more than `capacity`.
 */
export const PG_SLACK_MS = 5;

const DEFICIT_MS = `GREATEST(extract(epoch FROM (r.reset_at - statement_timestamp())) * 1000, 0)::float8`;
const FITS = `(${DEFICIT_MS} + $4::float8 <= $3::float8 + ${PG_SLACK_MS})`;
const TOKENS_LEFT = (deficit: string) =>
  `floor(($3::float8 - (${deficit})) / $2::float8 + 0.000001)::int`;

const TAKE_SQL = `
INSERT INTO tc_rate_limits AS r (key, count, reset_at)
VALUES (
  $1::text,
  ${TOKENS_LEFT("$4::float8")},
  statement_timestamp() + $4::float8 * interval '1 millisecond'
)
ON CONFLICT (key) DO UPDATE SET
  count = CASE WHEN ${FITS}
               THEN ${TOKENS_LEFT(`${DEFICIT_MS} + $4::float8`)}
               ELSE -1 END,
  reset_at = CASE WHEN ${FITS}
                  THEN statement_timestamp() + (${DEFICIT_MS} + $4::float8) * interval '1 millisecond'
                  ELSE r.reset_at END
RETURNING count,
          (extract(epoch FROM reset_at) * 1000)::float8 AS full_ms,
          (extract(epoch FROM statement_timestamp()) * 1000)::float8 AS now_ms`;

export async function pgTokenBucket(
  db: SqlRunner,
  input: { key: string; spec: BucketSpec; cost?: number },
): Promise<BucketDecision> {
  const cost = input.cost ?? 1;
  assertValidSpec(input.spec, cost);
  const { capacity, refillEveryMs } = input.spec;
  const toleranceMs = capacity * refillEveryMs;
  const costMs = cost * refillEveryMs;
  const res = await db.query(TAKE_SQL, [
    storageKey(`tb:${input.key}`),
    refillEveryMs,
    toleranceMs,
    costMs,
  ]);
  const row = res.rows[0];
  if (!row) throw new Error("rate limit upsert returned no row");
  const count = Number(row.count);
  const fullMs = Number(row.full_ms);
  const nowMs = Number(row.now_ms);
  if (![count, fullMs, nowMs].every(Number.isFinite)) {
    throw new Error("rate limit upsert returned an unreadable row");
  }
  const deficitMs = Math.max(0, fullMs - nowMs);
  const allowed = count >= 0;
  return {
    allowed,
    remaining: allowed
      ? count
      : Math.max(
          0,
          Math.floor((toleranceMs - deficitMs) / refillEveryMs + 1e-6),
        ),
    // A refused request left the bucket untouched, so fullMs is the old state.
    retryAfterMs: allowed
      ? 0
      : Math.max(1, Math.ceil(fullMs + costMs - toleranceMs - nowMs)),
    resetAfterMs: Math.ceil(deficitMs),
  };
}

/** Drops buckets that have been full for over an hour. Best effort; safe to run anytime. */
export async function pgRateLimitSweep(db: SqlRunner): Promise<void> {
  await db.query(
    `DELETE FROM tc_rate_limits WHERE reset_at < now() - interval '1 hour'`,
  );
}
