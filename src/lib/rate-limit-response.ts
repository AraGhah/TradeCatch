import { NextResponse } from "next/server";
import { rateLimitAsync } from "./rate-limit";

/**
 * Spends one request from a shared budget and returns the 429 to send when it
 * is used up, or null when the request may proceed:
 *
 *   const limited = await enforceRateLimit({ scope: "ai-test", subject: `${orgId}:${userId}`, limit: 60, windowMs: 600_000 });
 *   if (limited) return limited;
 *
 * Key authenticated routes by user (and business), not by IP: behind a proxy
 * that is not trusted every visitor shares one "unknown" address.
 */
export async function enforceRateLimit(input: {
  scope: string;
  subject: string;
  limit: number;
  windowMs: number;
}): Promise<NextResponse | null> {
  const result = await rateLimitAsync({
    key: `${input.scope}:${input.subject}`,
    limit: input.limit,
    windowMs: input.windowMs,
  });
  if (result.allowed) return null;
  const retryAfter = Math.max(
    1,
    Math.ceil((result.resetAt - Date.now()) / 1000),
  );
  return NextResponse.json(
    { error: "Too many requests. Please wait a moment and try again." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "Cache-Control": "no-store",
      },
    },
  );
}
