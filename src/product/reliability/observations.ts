import type { BucketDelta } from "./types";

/** Upper edges (ms) of the latency histogram bins; a final open bin follows. */
export const LATENCY_EDGES_MS = [100, 250, 500, 1000, 2500, 5000] as const;

/**
 * Real request outcomes (KAN-28), recorded by the Worker itself.
 *
 * Every response is counted into a per-minute bucket held in memory: one
 * increment, no I/O, no allocation worth measuring, and nothing about the
 * request is kept except which status class it ended in and which latency bin
 * it fell into (no path, user, header or body). The counters are written to the
 * database in one small batch, at most every few seconds per isolate, after the
 * response has already gone out.
 *
 * It exists to be harmless. `record` cannot throw. The buffer is bounded. A
 * database that is slow or down opens a circuit breaker so it is not hammered,
 * and the counters of a failed flush are dropped rather than retried
 * indefinitely. None of it can delay or fail a customer's request.
 *
 * This module is imported by the Worker entry point, so it must stay tiny and
 * free of database code.
 */

const MINUTE = 60_000;

export type RequestScope = BucketDelta["scope"];

const STATIC_FILE =
  /\.(?:ico|png|jpe?g|gif|svg|webp|avif|css|js|map|woff2?|ttf|otf|txt|xml|json|webmanifest|mp4|webm|pdf)$/i;

/** Which traffic a path belongs to, or null for assets that are not worth counting. */
export function scopeOf(pathname: string): RequestScope | null {
  if (typeof pathname !== "string") return null;
  if (pathname === "/api" || pathname.startsWith("/api/")) return "api";
  if (pathname.startsWith("/_next/")) return null;
  if (STATIC_FILE.test(pathname)) return null;
  return "page";
}

function binFor(durationMs: number): number {
  const ms = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  for (let index = 0; index < LATENCY_EDGES_MS.length; index += 1)
    if (ms <= LATENCY_EDGES_MS[index]) return index;
  return LATENCY_EDGES_MS.length;
}

export type ObserverOptions = {
  now?: () => number;
  /** Minimum time between flushes. */
  flushEveryMs?: number;
  /** Most per-minute buckets kept in memory; the oldest are dropped past this. */
  maxBuckets?: number;
  /** Pause after the 1st, 2nd, ... consecutive failed flush (the last value repeats). */
  breakerMs?: number[];
  /** A flush that has not answered by then counts as failed. */
  sinkTimeoutMs?: number;
};

export type FlushOutcome = "empty" | "sent" | "failed" | "skipped";

export type BucketSink = (rows: BucketDelta[]) => Promise<void>;

function emptyBucket(at: string, scope: RequestScope): BucketDelta {
  return {
    at,
    scope,
    total: 0,
    s2xx: 0,
    s3xx: 0,
    s401: 0,
    s403: 0,
    s429: 0,
    s4xxOther: 0,
    s5xx: 0,
    lat: [0, 0, 0, 0, 0, 0, 0],
  };
}

export function createObserver(options: ObserverOptions = {}) {
  const now = options.now ?? Date.now;
  const flushEveryMs = options.flushEveryMs ?? 30_000;
  const maxBuckets = options.maxBuckets ?? 30;
  const breakerMs = options.breakerMs?.length ? options.breakerMs : [60_000, 5 * MINUTE, 15 * MINUTE];
  const sinkTimeoutMs = options.sinkTimeoutMs ?? 5_000;

  let buckets = new Map<string, BucketDelta>();
  let lastFlushAt: number | undefined;
  let breakerUntil = 0;
  let failures = 0;
  let inFlight = false;

  function trim() {
    if (buckets.size <= maxBuckets) return;
    const oldest = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [key] of oldest.slice(0, buckets.size - maxBuckets)) buckets.delete(key);
  }

  const breakerOpen = () => now() < breakerUntil;

  function due(): boolean {
    if (buckets.size === 0 || inFlight || breakerOpen()) return false;
    return lastFlushAt === undefined || now() - lastFlushAt >= flushEveryMs;
  }

  return {
    /** Counts one finished request. Never throws. */
    record(input: { pathname: string; status: number; durationMs: number }): void {
      try {
        const scope = scopeOf(input.pathname);
        const status = Number(input.status);
        if (!scope || !Number.isFinite(status)) return;
        const minute = Math.floor(now() / MINUTE) * MINUTE;
        const key = `${new Date(minute).toISOString()}|${scope}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = emptyBucket(new Date(minute).toISOString(), scope);
          buckets.set(key, bucket);
          trim();
        }
        bucket.total += 1;
        if (status >= 500) bucket.s5xx += 1;
        else if (status === 429) bucket.s429 += 1;
        else if (status === 403) bucket.s403 += 1;
        else if (status === 401) bucket.s401 += 1;
        else if (status >= 400) bucket.s4xxOther += 1;
        else if (status >= 300) bucket.s3xx += 1;
        else bucket.s2xx += 1;
        bucket.lat[binFor(Number(input.durationMs))] += 1;
      } catch {
        // Monitoring must never affect the request it observes.
      }
    },

    due,
    pending: () => buckets.size,

    /**
     * Hands the buffered counters to `sink`. `force` skips the interval (the
     * breaker and the one-at-a-time rule still apply). Never throws.
     */
    async flush(sink: BucketSink, force = false): Promise<FlushOutcome> {
      if (inFlight || breakerOpen()) return "skipped";
      if (!force && !due()) return "skipped";
      if (buckets.size === 0) return "empty";
      const rows = [...buckets.values()];
      buckets = new Map();
      inFlight = true;
      lastFlushAt = now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          sink(rows),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("flush timed out")), sinkTimeoutMs);
          }),
        ]);
        failures = 0;
        return "sent";
      } catch {
        failures += 1;
        breakerUntil = now() + breakerMs[Math.min(failures - 1, breakerMs.length - 1)];
        return "failed";
      } finally {
        if (timer) clearTimeout(timer);
        inFlight = false;
      }
    },
  };
}

export type Observer = ReturnType<typeof createObserver>;
