import { isE2eHarness } from "./config";
import { isUpstashConfigured, upstashTokenBucket } from "./upstash";
import {
  MemoryBuckets,
  RefusalMemo,
  specFromWindow,
  type BucketDecision,
  type BucketSpec,
} from "./token-bucket";

// Rate limiting: one token bucket algorithm (token-bucket.ts), three places to
// keep the buckets, and one entry point, `takeToken`.
//
// The buckets are shared by every instance, in this order: Upstash Redis when
// UPSTASH_REDIS_REST_* is set, otherwise the application's own Postgres
// (tc_rate_limits) when the durable store is on, otherwise this process's
// memory. A shared tier that errors or is slow is skipped for a short while and
// the next tier answers, so an outage degrades to per-instance limits and
// never to "no limit", and never to an error for the caller or a stalled
// request. Per-process counters on their own would multiply every limit by the
// number of Worker isolates, which is why they are the last resort.
//
// Policies (who gets how many tokens) live in rate-limit-policy.ts.

type Env = Record<string, string | undefined>;

export type RateLimitTier = "upstash" | "postgres" | "memory" | "memo";

export type RateLimitResult = BucketDecision & {
  /** The bucket capacity, for the RateLimit-Limit header. */
  limit: number;
  /** Which store made the decision. */
  tier: RateLimitTier;
};

const memoryBuckets = new MemoryBuckets();
const refusals = new RefusalMemo();

/** Longest a request waits for a shared store before the next tier answers. */
const SHARED_TIMEOUT_MS = 2_000;
/** After a shared tier fails, requests skip it this long instead of each paying the timeout. */
const TIER_COOLDOWN_MS = 15_000;
const tierDownUntil = new Map<string, number>();

const SWEEP_ONE_IN = 200;
const reportedFailures = new Set<string>();

/** Error name and a safe code only: driver messages can quote connection strings. */
function safeLabel(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[0-9A-Za-z_]{3,16}$/.test(code)
    ? `${name} ${code}`
    : name;
}

/** One log line per tier per process, so an outage does not flood the logs. */
function reportOnce(tier: string, error: unknown) {
  if (reportedFailures.has(tier)) return;
  reportedFailures.add(tier);
  console.error(
    `[rate-limit] ${tier} failed (${safeLabel(error)}); using the next tier`,
  );
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

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

async function postgresTokenBucket(
  input: { key: string; spec: BucketSpec; cost: number },
  url: string,
): Promise<BucketDecision> {
  const [{ getPgPool }, shared] = await Promise.all([
    import("../product/missed-call/postgres-store"),
    import("./pg-rate-limit"),
  ]);
  const pool = getPgPool(url);
  const result = await shared.pgTokenBucket(pool, input);
  if (Math.random() * SWEEP_ONE_IN < 1) {
    shared
      .pgRateLimitSweep(pool)
      .catch((error) => reportOnce("postgres sweep", error));
  }
  return result;
}

async function tryShared(
  tier: "upstash" | "postgres",
  run: () => Promise<BucketDecision>,
): Promise<BucketDecision | null> {
  if ((tierDownUntil.get(tier) ?? 0) > Date.now()) return null;
  try {
    return await withTimeout(run(), SHARED_TIMEOUT_MS);
  } catch (error) {
    tierDownUntil.set(tier, Date.now() + TIER_COOLDOWN_MS);
    reportOnce(tier === "upstash" ? "Upstash" : "Postgres", error);
    return null;
  }
}

/**
 * Spend `cost` tokens (one by default) from the bucket `key`. Never throws for
 * an unavailable store: the answer always comes from some tier.
 */
export async function takeToken(input: {
  key: string;
  spec: BucketSpec;
  cost?: number;
  env?: Env;
  /**
   * Set to false where the Postgres driver cannot connect (see
   * rate-limit-central.ts): the Postgres tier is skipped without an attempt.
   * Default true.
   */
  postgres?: boolean;
}): Promise<RateLimitResult> {
  const env = input.env ?? process.env;
  const cost = input.cost ?? 1;
  const limit = input.spec.capacity;
  const done = (
    decision: BucketDecision,
    tier: RateLimitTier,
  ): RateLimitResult => ({ ...decision, limit, tier });

  // A refusal from a shared store stays true until its Retry-After has passed.
  const memoKey = `${input.key}|${cost}`;
  const knownRefusalMs = refusals.remainingMs(memoKey);
  if (knownRefusalMs > 0) {
    return done(
      {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.ceil(knownRefusalMs),
        resetAfterMs: Math.ceil(knownRefusalMs),
      },
      "memo",
    );
  }

  const request = { key: input.key, spec: input.spec, cost };
  const remember = (decision: BucketDecision) => {
    if (!decision.allowed) refusals.remember(memoKey, decision.retryAfterMs);
    return decision;
  };

  if (isUpstashConfigured(env)) {
    const decision = await tryShared("upstash", () =>
      upstashTokenBucket({ ...request, env }),
    );
    if (decision) return done(remember(decision), "upstash");
  }
  const databaseUrl = input.postgres === false ? null : sharedDatabaseUrl(env);
  if (databaseUrl) {
    const decision = await tryShared("postgres", () =>
      postgresTokenBucket(request, databaseUrl),
    );
    if (decision) return done(remember(decision), "postgres");
  }
  return done(memoryBuckets.take(input.key, input.spec, cost), "memory");
}

/**
 * Per-process "N requests per window" check, kept for callers that need an
 * answer without awaiting. Prefer `takeToken`, which is shared.
 */
export function rateLimit({
  key,
  limit,
  windowMs,
}: {
  key: string;
  limit: number;
  windowMs: number;
}): { allowed: boolean; remaining: number; resetAt: number } {
  const decision = memoryBuckets.take(key, specFromWindow(limit, windowMs));
  return {
    allowed: decision.allowed,
    remaining: decision.remaining,
    resetAt:
      Date.now() +
      (decision.allowed ? decision.resetAfterMs : decision.retryAfterMs),
  };
}

/**
 * "N requests per window" as a token bucket: a burst of N, then one more
 * every window/N. `resetAt` is when the next request would be allowed if this
 * one was refused, and when the bucket is full again if it was allowed.
 */
export async function rateLimitAsync(input: {
  key: string;
  limit: number;
  windowMs: number;
  env?: Env;
}): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const result = await takeToken({
    key: input.key,
    spec: specFromWindow(input.limit, input.windowMs),
    env: input.env,
  });
  return {
    allowed: result.allowed,
    remaining: result.remaining,
    resetAt:
      Date.now() + (result.allowed ? result.resetAfterMs : result.retryAfterMs),
  };
}

/** Test hook: forget every bucket, refusal and tier failure held by this process. */
export function resetRateLimitState() {
  memoryBuckets.clear();
  refusals.clear();
  tierDownUntil.clear();
  reportedFailures.clear();
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
 * True inside a Cloudflare Worker. Code there only ever runs behind
 * Cloudflare's edge, which sets `CF-Connecting-IP` itself and replaces any
 * value the client sent, so the header can be trusted with no configuration.
 * (A server that merely sits behind Cloudflare cannot assume that: someone can
 * reach it directly and send their own header. That case still needs
 * CF_TRUSTED=1.)
 */
export function isCloudflareWorker(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.userAgent === "Cloudflare-Workers"
  );
}

/**
 * Resolve the client IP only from headers the *current* hosting platform
 * is known to sanitize.
 *
 * - Vercel (`VERCEL=1`): `x-vercel-forwarded-for`, then platform `x-real-ip`
 * - Cloudflare Worker (detected at run time) or `CF_TRUSTED=1`:
 *   `CF-Connecting-IP` alone
 * - Explicit trust (`TRUST_PROXY_HEADERS=1`): classic proxy chain
 * - Non-production: allow forwarded headers for local/dev/e2e
 * - Otherwise: never trust public forwarding headers → `"unknown"`
 *
 * In production, unidentified clients collapse to `"unknown"` (not a
 * rotatable UA/language hash) so attackers cannot bypass limits by rotating
 * headers. Callers should use a looser limit for the `unknown` bucket, since
 * every unidentified client shares it.
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
  if (
    cfIp &&
    (isCloudflareWorker() ||
      env.CF_TRUSTED === "1" ||
      env.CF_CONNECTING_IP_TRUSTED === "1")
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

function expandIpv6(ip: string): number[] | null {
  const halves = ip.split("%")[0].split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) =>
    part === ""
      ? []
      : part
          .split(":")
          .map((group) =>
            /^[0-9a-f]{1,4}$/i.test(group) ? parseInt(group, 16) : NaN,
          );
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...tail].some(Number.isNaN)) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/**
 * The part of a client address that identifies one customer for limiting.
 * An IPv6 customer is handed a whole /64 (2^64 addresses) by their provider,
 * so limiting single addresses would let one person rotate through
 * unlimited "different" clients. Everything in a /64 shares a bucket; IPv4
 * and the shared `unknown` bucket are used as they are.
 */
export function clientIpKey(ip: string): string {
  if (!ip.includes(":") || ip.startsWith("unknown")) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  const groups = expandIpv6(ip);
  if (!groups) return ip;
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}
