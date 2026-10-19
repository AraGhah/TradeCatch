import { createMemoryStore, type TimedStore } from "./store";
import { isE2eHarness } from "./config";
import { isUpstashConfigured, upstashRateLimit } from "./upstash";

// Rate limiting. `rateLimit` is an in-memory fixed window; its state lives in
// one process (one Worker isolate, one serverless function), so on its own the
// effective limit is (per-instance limit × instance count).
//
// `rateLimitAsync` is what routes should call. It shares counters across all
// instances, in this order: Upstash Redis when UPSTASH_REDIS_REST_* is set,
// otherwise the application's Postgres (tc_rate_limits) when the durable store
// is on, otherwise this process's memory. If a shared tier errors, the next tier
// answers, so an outage degrades to per-instance limits and never to "no limit".

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

type Env = Record<string, string | undefined>;

/** Same switch every Postgres-backed store uses: a URL and the durable flag. */
function sharedDatabaseUrl(env: Env): string | null {
  const url = env.DATABASE_URL?.trim();
  const durable =
    env.MISSED_CALL_DURABLE_STORE === "1" || env.SAAS_DURABLE_STORE === "1";
  return url && durable ? url : null;
}

/** True when limits are counted across instances rather than per process. */
export function sharedRateLimitConfigured(env: Env = process.env): boolean {
  return isUpstashConfigured(env) || sharedDatabaseUrl(env) !== null;
}

const SWEEP_ONE_IN = 200;
const reportedFailures = new Set<string>();

/** One log line per failure kind per process, so an outage does not flood the logs. */
function reportOnce(tier: string, error: unknown) {
  if (reportedFailures.has(tier)) return;
  reportedFailures.add(tier);
  console.error(`[rate-limit] ${tier} failed; using the next tier`, error);
}

async function postgresRateLimit(
  input: { key: string; limit: number; windowMs: number },
  url: string,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const [{ getPgPool }, shared] = await Promise.all([
    import("../product/missed-call/postgres-store"),
    import("./pg-rate-limit"),
  ]);
  const pool = getPgPool(url);
  const result = await shared.pgRateLimit(pool, input);
  if (Math.random() * SWEEP_ONE_IN < 1) {
    shared
      .pgRateLimitSweep(pool)
      .catch((error) => reportOnce("postgres sweep", error));
  }
  return result;
}

export async function rateLimitAsync(input: {
  key: string;
  limit: number;
  windowMs: number;
  env?: Env;
}): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const env = input.env ?? process.env;
  if (isUpstashConfigured(env)) {
    try {
      return await upstashRateLimit({ ...input, env });
    } catch (err) {
      reportOnce("Upstash", err);
    }
  }
  const databaseUrl = sharedDatabaseUrl(env);
  if (databaseUrl) {
    try {
      return await postgresRateLimit(input, databaseUrl);
    } catch (err) {
      reportOnce("Postgres", err);
    }
  }
  return rateLimit(input);
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
 * - Cloudflare (`CF_TRUSTED=1`): `CF-Connecting-IP` alone
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
  if (
    cfIp &&
    (env.CF_TRUSTED === "1" || env.CF_CONNECTING_IP_TRUSTED === "1")
  ) {
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
