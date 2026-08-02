import { createMemoryStore, type TimedStore } from "./store";
import { isE2eHarness } from "./config";

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

function firstForwardedIp(headerValue: string): string | null {
  const first = headerValue.split(",")[0]?.trim();
  return first || null;
}

/** Weak per-request hint so unidentified clients do not share one bucket. */
function softClientHint(request: Request): string {
  const ua = request.headers.get("user-agent")?.trim() ?? "";
  const al = request.headers.get("accept-language")?.trim() ?? "";
  const raw = `${ua}|${al}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

/**
 * Resolve the client IP only from headers the *current* hosting platform
 * is known to sanitize.
 *
 * - Vercel (`VERCEL=1`): `x-vercel-forwarded-for`, then platform `x-real-ip`
 * - Cloudflare (`CF-Connecting-IP` present): that header alone
 * - Explicit trust (`TRUST_PROXY_HEADERS=1`): classic proxy chain
 * - Non-production: allow forwarded headers for local/dev/e2e
 * - Otherwise: never trust public forwarding headers → `"unknown"`
 *
 * In production, unidentified clients collapse to `"unknown"` (not a
 * rotatable UA/language hash) so attackers cannot bypass limits by rotating
 * headers. Callers should use a stricter limit for the `unknown` bucket.
 */
export function getClientIp(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): string {
  const onVercel = env.VERCEL === "1" || Boolean(env.VERCEL_ENV);

  if (onVercel) {
    const vercelForwarded = request.headers.get("x-vercel-forwarded-for");
    if (vercelForwarded) {
      const ip = firstForwardedIp(vercelForwarded);
      if (ip) return ip;
    }
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) return realIp;
    return "unknown";
  }

  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  // Only trust CF-Connecting-IP when the origin is explicitly Cloudflare-fronted.
  if (cfIp && (env.CF_TRUSTED === "1" || env.CF_CONNECTING_IP_TRUSTED === "1")) {
    return cfIp;
  }

  // E2E production builds set NODE_ENV=production but still inject synthetic
  // x-forwarded-for values so parallel tests do not share one rate-limit bucket.
  const trustProxy =
    env.TRUST_PROXY_HEADERS === "1" ||
    env.NODE_ENV !== "production" ||
    isE2eHarness(env);

  if (trustProxy) {
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) return realIp;
    const forwardedFor = request.headers.get("x-forwarded-for");
    if (forwardedFor) {
      const ip = firstForwardedIp(forwardedFor);
      if (ip) return ip;
    }
    // Dev/e2e only: soft hint avoids collapsing every local client together.
    if (env.NODE_ENV !== "production" || isE2eHarness(env)) {
      return `unknown:${softClientHint(request)}`;
    }
  }

  return "unknown";
}
