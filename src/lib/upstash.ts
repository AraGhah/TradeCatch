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
    signal: AbortSignal.timeout(5_000),
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
 * Fixed-window counter. Returns whether the request is allowed under `limit`
 * within `windowMs` (rounded up to whole seconds for Redis EXPIRE).
 */
export async function upstashRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
  env?: Record<string, string | undefined>;
}): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const env = input.env ?? process.env;
  const ttlSec = Math.max(1, Math.ceil(input.windowMs / 1000));
  const redisKey = `rl:${input.key}`;
  const count = Number(await upstashCommand(["INCR", redisKey], env));
  if (count === 1) {
    await upstashCommand(["EXPIRE", redisKey, ttlSec], env);
  }
  const ttl = Number(await upstashCommand(["TTL", redisKey], env));
  const resetAt =
    Date.now() + (ttl > 0 ? ttl * 1000 : input.windowMs);
  const allowed = count <= input.limit;
  return {
    allowed,
    remaining: Math.max(0, input.limit - count),
    resetAt,
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
