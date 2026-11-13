/**
 * Token bucket, the one algorithm behind every limit in TradeCatch.
 *
 * A bucket holds up to `capacity` tokens and gains one token every
 * `refillEveryMs` while it is not full. A request spends `cost` tokens (one by
 * default) and is refused when the bucket cannot cover it. `capacity` is the
 * burst a caller may send at once; `1 / refillEveryMs` is the sustained rate.
 *
 * The state is a single number, `fullAt`: the moment the bucket will be full
 * again. A bucket holding `t` tokens has `fullAt = now + (capacity - t) *
 * refillEveryMs`, so nothing else has to be stored or kept in step. One number
 * is what lets Postgres and Redis make the whole decision in one atomic
 * statement, and what lets an idle bucket be deleted without losing anything
 * (a bucket that is full is exactly a bucket that does not exist).
 *
 * This file is pure: no clock, network or database. The shared stores
 * (pg-rate-limit.ts, upstash.ts) repeat this arithmetic in SQL and Lua, and
 * tests/unit/token-bucket.test.ts holds all three to the same answers.
 */

export type BucketSpec = {
  /** Tokens a full bucket holds: the largest burst. At least 1. */
  capacity: number;
  /** Milliseconds for one token to come back. Sustained rate = 1 / this. */
  refillEveryMs: number;
};

export type BucketDecision = {
  allowed: boolean;
  /** Whole tokens left after this request. */
  remaining: number;
  /** When refused: milliseconds until this request would be allowed. 0 when allowed. */
  retryAfterMs: number;
  /** Milliseconds until the bucket is full again. */
  resetAfterMs: number;
};

/** Slack for floating point: 7 tokens an hour is not a whole number of milliseconds. */
const EPSILON = 1e-6;

export function assertValidSpec(spec: BucketSpec, cost = 1): void {
  if (
    !Number.isFinite(spec.capacity) ||
    !Number.isFinite(spec.refillEveryMs) ||
    spec.capacity < 1 ||
    spec.refillEveryMs <= 0
  ) {
    throw new RangeError(
      `Invalid token bucket: capacity ${spec.capacity}, refillEveryMs ${spec.refillEveryMs}`,
    );
  }
  if (!Number.isFinite(cost) || cost <= 0 || cost > spec.capacity) {
    throw new RangeError(
      `A request costing ${cost} can never fit a bucket of ${spec.capacity}`,
    );
  }
}

/** The bucket a legacy "N requests per window" limit means: full window, even refill. */
export function specFromWindow(limit: number, windowMs: number): BucketSpec {
  return {
    capacity: Math.max(1, Math.floor(limit)),
    refillEveryMs: windowMs / Math.max(1, Math.floor(limit)),
  };
}

/**
 * Spend `cost` tokens at time `now` from a bucket whose state is `fullAt`
 * (null for a bucket that has never been used). Returns the decision and the
 * state to store; a refused request leaves the state unchanged.
 */
export function takeTokens(
  spec: BucketSpec,
  fullAt: number | null,
  now: number,
  cost = 1,
): { decision: BucketDecision; fullAt: number } {
  assertValidSpec(spec, cost);
  const toleranceMs = spec.capacity * spec.refillEveryMs;
  const costMs = cost * spec.refillEveryMs;
  const base = Math.max(fullAt ?? now, now);
  const next = base + costMs;
  const allowed = next - now <= toleranceMs + EPSILON;
  const stored = allowed ? next : (fullAt ?? now);
  const deficitMs = Math.max(0, stored - now);
  return {
    fullAt: stored,
    decision: {
      allowed,
      remaining: Math.max(
        0,
        Math.floor((toleranceMs - deficitMs) / spec.refillEveryMs + EPSILON),
      ),
      retryAfterMs: allowed
        ? 0
        : Math.max(1, Math.ceil(next - now - toleranceMs)),
      resetAfterMs: Math.ceil(deficitMs),
    },
  };
}

/**
 * Per-process buckets: the last tier when no shared store is reachable, and
 * the only tier in tests and local development. A Worker isolate has a 128 MiB
 * heap, and keys come from the network (addresses, e-mails), so the table is
 * bounded: when it is full, buckets that have refilled are dropped first, then
 * the least recently used.
 */
export class MemoryBuckets {
  private readonly fullAt = new Map<string, number>();

  constructor(
    private readonly maxKeys = 5_000,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  get size(): number {
    return this.fullAt.size;
  }

  take(key: string, spec: BucketSpec, cost = 1): BucketDecision {
    const now = this.clock();
    const result = takeTokens(spec, this.fullAt.get(key) ?? null, now, cost);
    // Re-insert so Map order tracks recency.
    this.fullAt.delete(key);
    this.fullAt.set(key, result.fullAt);
    if (this.fullAt.size > this.maxKeys) this.shrink(now);
    return result.decision;
  }

  private shrink(now: number) {
    for (const [key, fullAt] of this.fullAt) {
      if (fullAt <= now) this.fullAt.delete(key);
    }
    for (const key of this.fullAt.keys()) {
      if (this.fullAt.size <= this.maxKeys) break;
      this.fullAt.delete(key);
    }
  }

  clear() {
    this.fullAt.clear();
  }
}

/**
 * Remembers which keys a shared store just refused, and until when.
 *
 * Tokens only come back with time, so once a bucket refuses a request it will
 * keep refusing the same request until `retryAfterMs` has passed, whatever any
 * other instance does. Repeating that refusal from memory is therefore always
 * correct, and it stops a flood against one key from costing a database round
 * trip per request: the attacker pays for the abuse, not the database.
 */
export class RefusalMemo {
  private readonly until = new Map<string, number>();

  constructor(
    private readonly maxKeys = 2_000,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Milliseconds this key is still known to be refused; 0 when unknown. */
  remainingMs(key: string): number {
    const until = this.until.get(key);
    if (until === undefined) return 0;
    const left = until - this.clock();
    if (left > 0) return left;
    this.until.delete(key);
    return 0;
  }

  remember(key: string, retryAfterMs: number) {
    const now = this.clock();
    this.until.delete(key);
    this.until.set(key, now + retryAfterMs);
    if (this.until.size > this.maxKeys) {
      for (const [k, until] of this.until) {
        if (until <= now) this.until.delete(k);
      }
      for (const k of this.until.keys()) {
        if (this.until.size <= this.maxKeys) break;
        this.until.delete(k);
      }
    }
  }

  clear() {
    this.until.clear();
  }
}
