import { createMemoryStore, type TimedStore } from "./store";

// In-memory sliding-window rate limiter, keyed by IP + route.
//
// Residual risk: this state lives in a single Node process. Behind multiple
// server instances (most production deployments, including Vercel's
// serverless functions) each instance has its own counters, so the effective
// limit is (per-instance limit × instance count). Swap `buckets` for a
// Redis-backed TimedStore when that matters — see src/lib/store.ts.

type Bucket = { count: number; resetAt: number };

const bucketMeta = new Map<string, Bucket>();
const touchTimes: TimedStore = createMemoryStore();

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, bucket] of bucketMeta) {
    if (bucket.resetAt <= now) {
      bucketMeta.delete(key);
      touchTimes.delete(key);
    }
  }
}

export function rateLimit({
  key,
  limit,
  windowMs,
}: {
  key: string;
  limit: number;
  windowMs: number;
}): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  cleanup(now);

  const existing = bucketMeta.get(key);
  if (!existing || existing.resetAt <= now) {
    const bucket = { count: 1, resetAt: now + windowMs };
    bucketMeta.set(key, bucket);
    touchTimes.set(key, now);
    return { allowed: true, remaining: limit - 1, resetAt: bucket.resetAt };
  }

  existing.count += 1;
  touchTimes.set(key, now);
  const allowed = existing.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]!.trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
