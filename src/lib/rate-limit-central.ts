import { getClientIp, isCloudflareWorker } from "./rate-limit";
import { classifyApiRequest, consumePolicy } from "./rate-limit-policy";
import { tooManyRequests } from "./rate-limit-response";

/**
 * The default limit for every /api route, applied once in src/proxy.ts so a
 * new route is covered the day it is added instead of the day someone
 * remembers. It is a backstop against loops and floods, per client address;
 * the strict, per-user limits (sign-in, texts, payments, exports) are named
 * policies that routes ask for themselves.
 *
 * RATE_LIMIT_MODE
 *   enforce  (default) answer 429 when the bucket is empty
 *   monitor  log what would have been refused and let it through. The safe way
 *            to try new numbers on real traffic: watch the log, then enforce.
 *   off      switch this layer off. Route-level limits stay. Cloudflare's own
 *            protections are never touched by this setting.
 *
 * What it deliberately does not do:
 *   - Exempt routes (EXEMPT_API_PREFIXES): provider webhooks and the voice
 *     agent. They share a few server addresses, and a refusal would cut a call.
 *   - Limit clients it cannot tell apart. If no trustworthy address is
 *     available every visitor would share one bucket, and a backstop sized
 *     for one person would lock out the whole site. The strict route-level
 *     limits still apply to them.
 */

export type RateLimitMode = "enforce" | "monitor" | "off";

export function rateLimitMode(
  env: Record<string, string | undefined> = process.env,
): RateLimitMode {
  const value = env.RATE_LIMIT_MODE?.trim().toLowerCase();
  return value === "monitor" || value === "off" ? value : "enforce";
}

/**
 * A flood of refused requests must not become a flood of log lines (and log
 * bills): at most one line per policy every 10 seconds per instance, saying
 * how many refusals it stands for. Returns null when this refusal is not
 * logged, otherwise how many were skipped since the last line.
 */
const LOG_EVERY_MS = 10_000;
const logged = new Map<string, { at: number; skipped: number }>();

function logSlot(policy: string): number | null {
  const now = Date.now();
  const entry = logged.get(policy);
  if (entry && now - entry.at < LOG_EVERY_MS) {
    entry.skipped += 1;
    return null;
  }
  const skipped = entry?.skipped ?? 0;
  logged.set(policy, { at: now, skipped: 0 });
  return skipped;
}

/** Test hook. */
export function resetRateLimitLogThrottle() {
  logged.clear();
}

export async function enforceCentralLimit(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): Promise<Response | null> {
  const mode = rateLimitMode(env);
  if (mode === "off") return null;

  const { pathname } = new URL(request.url);
  const route = classifyApiRequest(request.method, pathname);
  if (route.kind !== "limited") return null;

  const ip = getClientIp(request, env);
  if (ip.startsWith("unknown")) return null;

  // On Cloudflare the proxy is bundled apart from the routes (OpenNext's
  // experimental Node-middleware bundle) without the socket support the
  // Postgres driver needs there, so every attempt would fail. Its shared store
  // is therefore Upstash (plain fetch) when configured, and otherwise this
  // isolate's memory. The strict per-route limits run in the route bundle and
  // do use Postgres. See docs/RATE_LIMITS.md.
  const result = await consumePolicy(route.policy, { ip }, env, 1, {
    postgres: !isCloudflareWorker(),
  });
  if (result.allowed) return null;

  const suppressed = logSlot(route.policy);
  if (suppressed !== null) {
    console.warn(
      JSON.stringify({
        event: "tradecatch.rate_limit.limited",
        policy: route.policy,
        mode,
        method: request.method,
        path: pathname,
        tier: result.tier,
        retryAfterMs: result.retryAfterMs,
        suppressed,
      }),
    );
  }
  return mode === "monitor" ? null : tooManyRequests(result);
}
