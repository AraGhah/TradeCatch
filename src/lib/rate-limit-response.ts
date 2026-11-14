import { NextResponse } from "next/server";
import { takeToken, type RateLimitResult } from "./rate-limit";
import {
  consumePolicy,
  type PolicyId,
  type Subject,
} from "./rate-limit-policy";
import { specFromWindow } from "./token-bucket";

/** Whole seconds to wait, never zero: "Retry-After: 0" invites an instant retry storm. */
export function retryAfterSeconds(result: { retryAfterMs: number }): number {
  return Math.max(1, Math.ceil(result.retryAfterMs / 1000));
}

/**
 * The headers every refusal carries. `Retry-After` is the standard one that
 * browsers, proxies and our own client (src/lib/client/request.ts) obey; the
 * `RateLimit-*` fields (IETF draft) say how big the bucket is.
 */
export function rateLimitHeaders(
  result: RateLimitResult,
): Record<string, string> {
  const wait = String(retryAfterSeconds(result));
  return {
    "Retry-After": wait,
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(
      Math.max(1, Math.ceil(result.resetAfterMs / 1000)),
    ),
    "Cache-Control": "no-store",
  };
}

const DEFAULT_BODY = {
  error: "Too many requests. Please wait a moment and try again.",
  code: "rate_limited",
} as const;

/**
 * The 429 to send for a refused request. The body defaults to a generic JSON
 * message; routes whose clients already look for a specific body (the sign-in
 * forms look for `{ error: "rate_limited" }`) pass their own. The headers are
 * the same either way. `retryAfterSeconds` is repeated in the body for the
 * clients that cannot read headers.
 */
export function tooManyRequests(
  result: RateLimitResult,
  body: Record<string, unknown> = DEFAULT_BODY,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { ...body, retryAfterSeconds: retryAfterSeconds(result) },
    { status: 429, headers: { ...headers, ...rateLimitHeaders(result) } },
  );
}

/**
 * Spends one token from the named policy for `who` and returns the 429 to
 * send when it is used up, or null when the request may proceed:
 *
 *   const limited = await enforcePolicy("payments.checkout", { subject: `${orgId}:${userId}` });
 *   if (limited) return limited;
 *
 * Key authenticated routes by user (and business), not by address: customers
 * share office and mobile-carrier addresses.
 */
export async function enforcePolicy(
  id: PolicyId,
  who: Subject,
  options: {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<NextResponse | null> {
  const result = await consumePolicy(id, who, options.env);
  return result.allowed
    ? null
    : tooManyRequests(result, options.body, options.headers);
}

/**
 * The same, for a limit that is not in the policy table (tests, one-offs).
 * New limits belong in rate-limit-policy.ts.
 */
export async function enforceRateLimit(input: {
  scope: string;
  subject: string;
  limit: number;
  windowMs: number;
}): Promise<NextResponse | null> {
  const result = await takeToken({
    key: `${input.scope}:${input.subject}`,
    spec: specFromWindow(input.limit, input.windowMs),
  });
  return result.allowed ? null : tooManyRequests(result);
}
