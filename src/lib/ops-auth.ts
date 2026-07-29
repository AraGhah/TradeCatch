import { timingSafeEqual } from "node:crypto";

/**
 * Shared bearer auth for Module A ops endpoints (leads, escalations, sandbox).
 *
 * Accepts `MISSED_CALL_OPS_SECRET` or, as a fallback, `CRON_SECRET`
 * (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`).
 *
 * Production: deny if no secret is configured or the bearer token mismatches.
 * Development: allow unauthenticated access when no secret is set (local DX);
 * if a secret is set, it is enforced.
 */
export function getOpsSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret =
    env.MISSED_CALL_OPS_SECRET?.trim() || env.CRON_SECRET?.trim() || "";
  return secret || null;
}

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production";
}

function safeEqualString(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function authorizeOpsRequest(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const secret = getOpsSecret(env);
  if (!secret) {
    return !isProduction(env);
  }

  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return false;
  return safeEqualString(token, secret);
}

export function unauthorizedOpsResponse() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
