import {
  assertValidSpec,
  type BucketDecision,
  type BucketSpec,
} from "./token-bucket";

/**
 * Optional Upstash Redis REST helpers for multi-instance rate limits and
 * short-window idempotency. When unset, callers fall back to in-memory stores.
 */

export function isUpstashConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

async function upstashCommand(
  command: (string | number)[],
  env: Record<string, string | undefined> = process.env,
  timeoutMs = 5_000,
): Promise<unknown> {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("Upstash Redis is not configured");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstash command failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as { result?: unknown; error?: string };
  if (json.error) {
    throw new Error(`Upstash error: ${json.error}`);
  }
  return json.result;
}

/**
 * Token bucket in one atomic Lua call (same arithmetic as token-bucket.ts and
 * pg-rate-limit.ts). The key holds the moment the bucket is full again and
 * expires at that moment, so an idle bucket costs nothing and a bucket can
 * never be stuck. Redis' own clock is used, so callers' clocks do not matter.
 *
 * KEYS[1] bucket key; ARGV[1] refill ms, [2] tolerance ms (capacity x refill),
 * [3] cost ms. Returns {allowed, deficit ms after the call, redis now ms};
 * the fractions travel as strings because Redis truncates Lua numbers to
 * integers in replies.
 */
const TOKEN_BUCKET_LUA = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local tol = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local full = tonumber(redis.call('GET', KEYS[1]))
local deficit = 0
if full then deficit = math.max(full - now, 0) end
if deficit + cost <= tol + 0.5 then
  local after = deficit + cost
  redis.call('SET', KEYS[1], string.format('%.3f', now + after), 'PX', math.ceil(after))
  return {1, string.format('%.3f', after), now}
end
return {0, string.format('%.3f', deficit), now}
`;

/** Rate-limit commands sit on the request path, so they get a short leash. */
const RATE_LIMIT_TIMEOUT_MS = 1_500;

export async function upstashTokenBucket(input: {
  key: string;
  spec: BucketSpec;
  cost?: number;
  env?: Record<string, string | undefined>;
  /** Overrides the 1.5 s production leash (tests on a loaded machine). */
  timeoutMs?: number;
}): Promise<BucketDecision> {
  const env = input.env ?? process.env;
  const cost = input.cost ?? 1;
  assertValidSpec(input.spec, cost);
  const { capacity, refillEveryMs } = input.spec;
  const toleranceMs = capacity * refillEveryMs;
  const costMs = cost * refillEveryMs;
  const reply = await upstashCommand(
    [
      "EVAL",
      TOKEN_BUCKET_LUA,
      1,
      `tb:${input.key}`,
      refillEveryMs,
      toleranceMs,
      costMs,
    ],
    env,
    input.timeoutMs ?? RATE_LIMIT_TIMEOUT_MS,
  );
  if (!Array.isArray(reply) || reply.length < 3) {
    throw new Error("Upstash token bucket returned an unreadable reply");
  }
  const allowed = Number(reply[0]) === 1;
  const deficitMs = Number(reply[1]);
  if (!Number.isFinite(deficitMs)) {
    throw new Error("Upstash token bucket returned an unreadable deficit");
  }
  return {
    allowed,
    remaining: Math.max(
      0,
      Math.floor((toleranceMs - deficitMs) / refillEveryMs + 1e-6),
    ),
    retryAfterMs: allowed
      ? 0
      : Math.max(1, Math.ceil(deficitMs + costMs - toleranceMs)),
    resetAfterMs: Math.ceil(deficitMs),
  };
}

/**
 * Claim a short-lived idempotency key. Returns true if this caller owns the
 * claim (SET NX), false if the key already exists.
 */
export async function upstashClaimIdempotencyKey(input: {
  key: string;
  ttlMs: number;
  env?: Record<string, string | undefined>;
}): Promise<boolean> {
  const env = input.env ?? process.env;
  const ttlSec = Math.max(1, Math.ceil(input.ttlMs / 1000));
  const result = await upstashCommand(
    ["SET", `idemp:${input.key}`, "1", "EX", ttlSec, "NX"],
    env,
  );
  return result === "OK";
}
